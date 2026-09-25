/**
 * Audio Cue Generation Handler
 *
 * Dedicated pipeline for generating coherent audio cues from visual shots.
 * Uses the Audio Cue Orchestrator for quality-gated cue generation:
 *   generateAudioCues → evaluateAudioCues (coverage/gaps/overlaps) → revise (max 1 cycle)
 *
 * Runs AFTER shot generation to ensure music/SFX flow across shot boundaries.
 * WRITES TO DATABASE: Inserts audio_cues rows
 */
import type { SupabaseClient } from '@supabase/supabase-js';

import { parseLlmJobPayload } from '@kit/prompt-engine/llm-job-payloads';
import type { Database } from '@kit/supabase/database';

import {
  markJobCompleted,
  markJobFailed,
  markJobProcessing,
} from '../utils/job-tracking';

/** The part of `shots.generation_metadata` (jsonb) this pipeline reads. */
interface ShotGenerationMetadata {
  veoPrompt?: {
    audio?: string;
  };
  action?: string;
}

export async function processAudioCueGeneration(
  payload: Record<string, unknown>,
  supabase: SupabaseClient<Database>,
): Promise<{ success: boolean; cuesCreated: number }> {
  const data = parseLlmJobPayload('audio-cue-generation', payload);
  const { episodeId } = data;

  console.log(
    `[Audio Generation] Starting AGENTIC pipeline for episode ${episodeId}`,
  );
  await markJobProcessing(supabase, episodeId, 'audio_cue_generation');

  try {
    // 1. Fetch all shots for the episode
    const { data: shots, error: shotsError } = await supabase
      .from('shots')
      .select(
        'sequence_number, scene_number, duration_seconds, scene_description, prompt, generation_metadata',
      )
      .eq('episode_id', episodeId)
      .is('deleted_at', null)
      .order('sequence_number', { ascending: true });

    if (shotsError || !shots || shots.length === 0) {
      throw new Error(
        `Failed to fetch shots for episode: ${shotsError?.message || 'No shots found'}`,
      );
    }

    // 2. Prepare shot data for orchestrator
    const shotsJson = shots.map((s) => ({
      seq: s.sequence_number,
      duration: s.duration_seconds,
      audioDesc:
        (s.generation_metadata as ShotGenerationMetadata | null)?.veoPrompt
          ?.audio || 'No audio description',
      action:
        (s.generation_metadata as ShotGenerationMetadata | null)?.action ||
        s.scene_description,
    }));

    // Calculate total episode duration
    const totalDurationSeconds = shots.reduce(
      (sum, s) => sum + s.duration_seconds,
      0,
    );

    // 3. Run the Audio Cue Orchestrator
    // For large episodes (>50 shots), batch by scene to avoid token budget exhaustion.
    // The orchestrator's 40K token budget can't handle 70+ shots in a single pass.
    const { runAudioCueOrchestrator } = await import(
      '@kit/episodes/agent/audio-cue-orchestrator'
    );

    interface GeneratedCue {
      type: 'music' | 'sfx' | 'ambient';
      prompt: string;
      startShotSequence: number;
      startOffsetInShot: number;
      durationSeconds: number;
      reasoning?: string;
    }

    let generatedCues: GeneratedCue[];
    let totalOrchestratorSteps = 0;
    let overallCoveragePercent: number | undefined;

    const BATCH_THRESHOLD = 50;

    if (shots.length <= BATCH_THRESHOLD) {
      // Small episode: single pass (original behavior)
      console.log(
        `[Audio Generation] Single-pass mode: ${shots.length} shots, ${totalDurationSeconds}s`,
      );

      const orchestratorResult = await runAudioCueOrchestrator({
        episodeId,
        accountId: data.accountId,
        shotsJson: JSON.stringify(shotsJson),
        totalDurationSeconds,
      });

      if (!orchestratorResult.success) {
        throw new Error(
          `Audio Cue Orchestrator failed: ${orchestratorResult.error ?? 'Unknown error'}`,
        );
      }

      generatedCues = orchestratorResult.cues;
      totalOrchestratorSteps = orchestratorResult.orchestratorSteps;
      overallCoveragePercent = orchestratorResult.coveragePercent;
    } else {
      // Large episode: batch by scene to stay within token budget
      // Group shots by scene_number, then process each scene independently
      const shotToSceneMap = new Map<number, number | null>(
        shots.map((s) => [s.sequence_number, s.scene_number]),
      );

      const sceneGroups = new Map<number, typeof shotsJson>();
      for (const shot of shotsJson) {
        const sceneNum = shotToSceneMap.get(shot.seq) ?? 0;
        if (!sceneGroups.has(sceneNum)) {
          sceneGroups.set(sceneNum, []);
        }
        sceneGroups.get(sceneNum)!.push(shot);
      }

      console.log(
        `[Audio Generation] Scene-batch mode: ${shots.length} shots across ${sceneGroups.size} scenes, ${totalDurationSeconds}s total`,
      );

      generatedCues = [];
      let totalWeightedCoverage = 0;
      let totalEvaluatedDuration = 0;

      for (const [sceneNum, sceneShots] of sceneGroups) {
        const sceneDuration = sceneShots.reduce(
          (sum: number, s: { duration: number }) => sum + s.duration,
          0,
        );

        console.log(
          `[Audio Generation] Processing scene ${sceneNum}: ${sceneShots.length} shots, ${sceneDuration}s`,
        );

        const sceneResult = await runAudioCueOrchestrator({
          episodeId,
          accountId: data.accountId,
          shotsJson: JSON.stringify(sceneShots),
          totalDurationSeconds: sceneDuration,
        });

        totalOrchestratorSteps += sceneResult.orchestratorSteps;

        if (!sceneResult.success) {
          console.warn(
            `[Audio Generation] Scene ${sceneNum} failed: ${sceneResult.error}. Continuing with remaining scenes.`,
          );
          continue;
        }

        if (sceneResult.coveragePercent !== undefined) {
          totalWeightedCoverage += sceneResult.coveragePercent * sceneDuration;
          totalEvaluatedDuration += sceneDuration;
        }

        console.log(
          `[Audio Generation] Scene ${sceneNum}: ${sceneResult.cues.length} cues generated`,
        );
        generatedCues.push(...sceneResult.cues);
      }

      overallCoveragePercent =
        totalEvaluatedDuration > 0
          ? Math.round(totalWeightedCoverage / totalEvaluatedDuration)
          : 0;

      if (generatedCues.length === 0) {
        throw new Error(
          `Audio Cue Orchestrator produced 0 cues across all ${sceneGroups.size} scenes`,
        );
      }
    }

    console.log(
      `[Audio Generation] Orchestrator complete. Steps: ${totalOrchestratorSteps}, ` +
        `Cues: ${generatedCues.length}, Coverage: ${overallCoveragePercent ?? 'N/A'}%`,
    );

    // 4. Transform to DB inserts
    // Build a map of Shot Sequence → Start Time
    const shotStartTimes = new Map<number, number>();
    let currentTime = 0;
    for (const shot of shots) {
      shotStartTimes.set(shot.sequence_number, currentTime);
      currentTime += shot.duration_seconds;
    }

    // Create scene map from initial shots fetch
    const sceneMap = new Map<number, number | null>(
      shots.map((s) => [s.sequence_number, s.scene_number]),
    );

    const finalInserts = generatedCues
      .map((cue) => {
        const shotStartTime = shotStartTimes.get(cue.startShotSequence);
        if (shotStartTime === undefined) {
          console.warn(
            `[Audio Generation] Cue references unknown shot sequence: ${cue.startShotSequence}`,
          );
          return null;
        }

        const sceneNum = sceneMap.get(cue.startShotSequence);

        if (sceneNum === undefined) {
          console.warn(
            `[Audio Generation] Could not find scene number for shot sequence: ${cue.startShotSequence}`,
          );
          return null;
        }

        return {
          episode_id: episodeId,
          scene_number: sceneNum,
          cue_type: cue.type,
          prompt: cue.prompt,
          start_offset_seconds: Math.max(
            0,
            shotStartTime + (cue.startOffsetInShot || 0),
          ),
          duration_seconds: cue.durationSeconds,
          is_loopable: cue.type === 'ambient',
          status: 'pending',
        };
      })
      .filter((c): c is NonNullable<typeof c> => c !== null);

    // 5. Bulk Insert
    if (finalInserts.length > 0) {
      const { error: insertError } = await supabase
        .from('audio_cues')
        .insert(finalInserts);

      if (insertError) {
        throw new Error(`Failed to insert audio cues: ${insertError.message}`);
      }
    }

    await markJobCompleted(supabase, episodeId, 'audio_cue_generation', {
      cuesCreated: finalInserts.length,
      mode: 'agentic',
      orchestratorSteps: totalOrchestratorSteps,
      coveragePercent: overallCoveragePercent,
      batchedByScene: shots.length > BATCH_THRESHOLD,
    });

    return { success: true, cuesCreated: finalInserts.length };
  } catch (error) {
    console.error('[Audio Generation] Failed:', error);
    await markJobFailed(
      supabase,
      episodeId,
      'audio_cue_generation',
      error instanceof Error ? error.message : 'Unknown error',
    );
    throw error;
  }
}
