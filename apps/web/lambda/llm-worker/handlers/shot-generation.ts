/**
 * Shot Generation Handler — Stage 3
 *
 * Stage 3 of the 3-stage agentic content pipeline.
 * Runs the Shot Orchestrator: Reel Scout → Shot Director.
 * WRITES TO DATABASE:
 * - Inserts rows into shots table
 * - Updates episode.shot_list
 */
import type { SupabaseClient } from '@supabase/supabase-js';

import type { ReelSceneAnalysis } from '@kit/episodes/agent/shot-orchestrator';

import {
  markJobCompleted,
  markJobFailed,
  markJobProcessing,
} from '../utils/job-tracking';

interface ShotGenerationPayload {
  episodeId: string;
  version: number;
  accountId: string;
  userId: string;
  projectId: string;
}

interface ScreenplayScene {
  number: number;
  heading: string;
  location: string;
  timeOfDay: string;
  description: string;
  action: string[];
  estimatedDuration?: number;
  // Stored screenplays carry the line as `text` (orchestrator output) or, in
  // older rows, `dialogue`.
  dialogue: Array<{
    character: string;
    text?: string;
    dialogue?: string;
    parenthetical?: string;
  }>;
}

interface ShotGenerationResult {
  success: boolean;
  data: {
    totalShots: number;
    shotsCreated: number;
    metadata: {
      totalDuration: number;
      shotTypes: { wide: number; medium: number; closeUp: number };
      scenesProcessed: number;
    };
  };
}

export async function processShotGeneration(
  payload: Record<string, unknown>,
  supabase: SupabaseClient,
): Promise<ShotGenerationResult> {
  // SQS payload: cast, not validated (KB-33).
  const data = payload as unknown as ShotGenerationPayload;

  console.log(`[Shot Generation] Processing for episode ${data.episodeId}`);

  // Mark job as processing
  await markJobProcessing(supabase, data.episodeId, 'shot_list');

  try {
    // 1. Fetch episode with screenplay
    const { data: episode, error: episodeError } = await supabase
      .from('episodes')
      .select(
        `
            id, title, version, screenplay_data, story_data,
            project:projects(id, account_id, metadata)
        `,
      )
      .eq('id', data.episodeId)
      .single();

    if (episodeError || !episode) {
      throw new Error(`Episode not found: ${episodeError?.message}`);
    }

    const screenplayData = episode.screenplay_data as {
      scenes: ScreenplayScene[];
    } | null;
    if (!screenplayData?.scenes?.length) {
      throw new Error('Episode must have screenplay generated first');
    }

    const scenes = screenplayData.scenes;

    // 2. Build episode context using episode.metadata.character_ids/location_ids
    // This ensures we use the episode-specific characters/locations, not all project assets
    const {
      buildEpisodeContext,
      formatCharactersForVeoPrompt,
      formatLocationsForVeoPrompt,
      formatRecurringElementsForPrompt,
    } = await import('../utils/context-builder');

    const episodeContext = await buildEpisodeContext(data.episodeId, supabase);
    const characters = episodeContext.characters;
    const locations = episodeContext.locations;

    console.log(
      `[Shot Generation] Episode context: ${characters.length} characters, ${locations.length} locations`,
    );

    // Format using VEO 3.1 optimized formatters
    const charactersFormatted =
      formatCharactersForVeoPrompt(characters) || 'No characters defined.';
    const locationsFormatted =
      formatLocationsForVeoPrompt(locations) || 'No locations defined.';
    const recurringElementsFormatted = formatRecurringElementsForPrompt(
      episodeContext.recurringElements,
    );

    // 3. Run the Stage 3 Shot Orchestrator (Reel Scout + Shot Director)
    const { runShotOrchestrator } = await import(
      '@kit/episodes/agent/shot-orchestrator'
    );

    console.log(
      `[Shot Generation] Starting Shot Orchestrator — ` +
        `${scenes.length} scenes, ${characters.length} characters, ${locations.length} locations`,
    );

    // Diagnostic: inspect raw scene shape from DB so CloudWatch shows data issues immediately
    console.log(
      `[Shot Generation] Raw scene[0] keys: ${Object.keys(scenes[0] as unknown as Record<string, unknown>).join(', ')}`,
    );
    console.log(
      `[Shot Generation] Scene action fields: ${scenes
        .map((s, i) => {
          const raw = s as unknown as Record<string, unknown>;
          return `scene${i + 1}=${Array.isArray(raw['action']) ? 'array(' + (raw['action'] as unknown[]).length + ')' : typeof raw['action']}`;
        })
        .join(', ')}`,
    );

    const orchestratorResult = await runShotOrchestrator({
      episodeId: data.episodeId,
      episodeTitle: episode.title,
      genre: episodeContext.genre ?? 'general',
      targetAudience: episodeContext.targetAudience ?? 'general',
      visualStyle: episodeContext.visualStyle ?? 'cinematic',
      accountId: data.accountId,
      // Map screenplay scenes — screenplay_data stores action lines in `description` (string),
      // not in a separate `action` array. Derive action from description when absent.
      scenes: scenes.map((s, idx) => {
        const raw = s as unknown as Record<string, unknown>;
        const hasStoredAction =
          Array.isArray(raw['action']) &&
          (raw['action'] as unknown[]).length > 0;
        const action = hasStoredAction
          ? (raw['action'] as string[])
          : (s.description ?? '')
              .split('\n')
              .map((l: string) => l.trim())
              .filter(Boolean);

        console.log(
          `[Shot Generation] Scene ${idx + 1}/${scenes.length} — ` +
            `actionSource=${hasStoredAction ? 'stored-array' : 'description-split'}, ` +
            `actionLines=${action.length}, dialogueLines=${(s.dialogue ?? []).length}`,
        );

        return {
          number: s.number,
          heading: s.heading,
          location: s.location,
          timeOfDay: s.timeOfDay,
          description: s.description,
          action,
          dialogue: (s.dialogue ?? []).map((d) => ({
            character: d.character,
            text: d.text ?? d.dialogue ?? '',
            parenthetical: d.parenthetical,
          })),
          estimatedDuration: s.estimatedDuration,
        };
      }),
      charactersVeoContext: charactersFormatted,
      locationsVeoContext: locationsFormatted,
      recurringElementsContext: recurringElementsFormatted,
    });

    console.log(
      `[Shot Generation] Orchestrator completed — ` +
        `success: ${orchestratorResult.success}, ` +
        `shots: ${orchestratorResult.shots.length}, ` +
        `reel candidates: ${orchestratorResult.reelCandidateScenes.join(', ') || 'none'}, ` +
        `steps: ${orchestratorResult.orchestratorSteps}`,
    );

    if (!orchestratorResult.success) {
      throw new Error(
        `Shot Orchestrator failed: ${orchestratorResult.error ?? 'Unknown error'}`,
      );
    }

    if (orchestratorResult.shots.length === 0) {
      throw new Error(
        'Shot Director returned 0 shots. All scene-shot-generation LLM calls failed. ' +
          'Check CloudWatch for [Shot Director] error logs and verify scene-shot-generation prompt config.',
      );
    }

    // Validate shot count is reasonable for the number of scenes
    const expectedMin = scenes.length * 2;
    const expectedMax = scenes.length * 10;
    const totalShots = orchestratorResult.shots.length;

    if (totalShots < expectedMin) {
      console.warn(
        `[Shot Generation] LOW SHOT COUNT WARNING: Only ${totalShots} shots for ${scenes.length} scenes ` +
          `(expected at least ${expectedMin}). Some scenes may have failed silently. ` +
          `Episode: ${data.episodeId}`,
      );
    } else if (totalShots > expectedMax) {
      console.warn(
        `[Shot Generation] HIGH SHOT COUNT WARNING: ${totalShots} shots for ${scenes.length} scenes ` +
          `(expected at most ${expectedMax}). May indicate duplicate generation. ` +
          `Episode: ${data.episodeId}`,
      );
    }

    const reelCandidateSet = new Set(orchestratorResult.reelCandidateScenes);

    // Build lookup: sceneNumber → full Reel Scout analysis (viralScore, hookType, etc.)
    const sceneAnalysisMap = new Map<number, ReelSceneAnalysis>(
      orchestratorResult.sceneAnalyses.map((a) => [a.sceneNumber, a]),
    );
    console.log(
      `[Shot Generation] sceneAnalysisMap: ${sceneAnalysisMap.size} entries from Reel Scout. ` +
        `Reel candidates: ${orchestratorResult.reelCandidateScenes.join(', ') || 'none'}`,
    );
    console.log(
      `[Shot Generation] Per-scene viral scores: ${
        [...sceneAnalysisMap.entries()]
          .map(
            ([sceneNum, a]) =>
              `scene${sceneNum}=${a.viralScore}(${a.isReelCandidate ? 'candidate' : 'non-candidate'})`,
          )
          .join(', ') || 'no data'
      }`,
    );

    // 4. Query existing shots for correct sequence number base
    const { data: existingShots } = await supabase
      .from('shots')
      .select('sequence_number')
      .eq('episode_id', data.episodeId)
      .is('deleted_at', null)
      .order('sequence_number', { ascending: false })
      .limit(1);

    let sequenceNumber = (existingShots?.[0]?.sequence_number ?? 0) + 1;
    console.log(
      `[Shot Generation] Starting sequence number: ${sequenceNumber}`,
    );

    // 5. Build shots table rows from flat orchestrator output
    const allShots: Array<{
      episode_id: string;
      scene_number: number;
      shot_number: number;
      sequence_number: number;
      scene_description: string;
      prompt: string;
      duration_seconds: number;
      camera_direction: string | null;
      status: string;
      shorts_candidate: boolean;
      shorts_metadata: Record<string, unknown> | null;
      generation_metadata: Record<string, unknown>;
      // OpenClaw Shot Intelligence
      transition_type: string | null;
      frame_strategy: string | null;
      primary_subject: Record<string, unknown> | null;
      first_frame_description: string | null;
      last_frame_description: string | null;
      location_area: string | null;
      location_environment_description: string | null;
    }> = [];

    const shotTypes = { wide: 0, medium: 0, closeUp: 0 };
    let totalDuration = 0;

    for (const shot of orchestratorResult.shots) {
      const sceneIsCandidate = reelCandidateSet.has(shot.sceneNumber);
      const sceneAnalysis = sceneAnalysisMap.get(shot.sceneNumber);

      // Log every shot so we can trace the data flow in CloudWatch
      console.log(
        `[Shot Generation] Shot ${shot.sceneNumber}.${shot.shotNumber} — ` +
          `candidate=${sceneIsCandidate}, ` +
          `viralScore=${sceneAnalysis?.viralScore ?? 'N/A'}, ` +
          `hookType=${sceneAnalysis?.hookType ?? shot.metadata.hookType ?? 'none'}`,
      );

      // Build shorts_metadata for ALL shots (not just candidates) so the sidebar
      // can show viral intelligence and "not a candidate" reasoning for every scene.
      const shortsMetadata: Record<string, unknown> | null = sceneAnalysis
        ? {
            viralScore: sceneAnalysis.viralScore,
            hookType: sceneAnalysis.hookType ?? shot.metadata.hookType,
            estimatedDurationSeconds:
              sceneAnalysis.estimatedDurationSeconds ?? shot.duration,
            isReelCandidate: sceneAnalysis.isReelCandidate,
            whyThisWorksAsReel: sceneAnalysis.whyThisWorksAsReel ?? null,
            whyItDoesntWork: sceneAnalysis.whyItDoesntWork ?? null,
            keyMoment: sceneAnalysis.keyMoment ?? null,
            sceneEmotionalArc: sceneAnalysis.sceneEmotionalArc ?? null,
            improvementSuggestion: sceneAnalysis.improvementSuggestion ?? null,
          }
        : sceneIsCandidate
          ? {
              hookType: shot.metadata.hookType,
              estimatedDurationSeconds: shot.duration,
              isReelCandidate: true,
            }
          : null;

      // OpenClaw Shot Intelligence (typed via SceneShotOutputSchema)
      allShots.push({
        episode_id: data.episodeId,
        scene_number: shot.sceneNumber,
        shot_number: shot.shotNumber,
        sequence_number: sequenceNumber++,
        scene_description: shot.description,
        prompt: shot.veoPrompt?.fullPrompt || shot.description,
        duration_seconds: shot.duration,
        camera_direction: shot.cameraDirection ?? null,
        status: 'pending',
        shorts_candidate: sceneIsCandidate,
        shorts_metadata: shortsMetadata,
        generation_metadata: {
          shotType: shot.shotType,
          location: shot.metadata.location,
          timeOfDay: shot.metadata.timeOfDay,
          mood: shot.metadata.mood,
          characters: shot.characters ?? [],
          veoPrompt: shot.veoPrompt,
          isReelCandidate: sceneIsCandidate,
        },
        transition_type: shot.transitionType ?? null,
        frame_strategy: shot.frameStrategy ?? null,
        primary_subject: shot.primarySubject ?? null,
        first_frame_description: shot.firstFrameDescription ?? null,
        last_frame_description: shot.lastFrameDescription ?? null,
        location_area: shot.locationArea ?? null,
        location_environment_description:
          shot.locationEnvironmentDescription ?? null,
      });

      if (shot.shotType === 'wide') shotTypes.wide++;
      else if (shot.shotType === 'medium') shotTypes.medium++;
      else if (shot.shotType?.includes('close')) shotTypes.closeUp++;
      totalDuration += shot.duration;
    }

    if (allShots.length === 0) {
      throw new Error('No shots were generated');
    }

    // 5. CLEAR existing data then INSERT new shots (idempotent)
    // Without this, re-running generation stacks duplicate shots.
    const { error: clearAudioCuesErr } = await supabase
      .from('audio_cues')
      .delete()
      .eq('episode_id', data.episodeId);

    if (clearAudioCuesErr) {
      console.warn(
        `[Shot Generation] Failed to clear existing audio cues: ${clearAudioCuesErr.message}`,
      );
    }

    const { error: clearAudioTracksErr } = await supabase
      .from('audio_tracks')
      .delete()
      .eq('episode_id', data.episodeId);

    if (clearAudioTracksErr) {
      console.warn(
        `[Shot Generation] Failed to clear existing audio tracks: ${clearAudioTracksErr.message}`,
      );
    }

    const { error: clearShotsErr } = await supabase
      .from('shots')
      .delete()
      .eq('episode_id', data.episodeId);

    if (clearShotsErr) {
      console.warn(
        `[Shot Generation] Failed to clear existing shots: ${clearShotsErr.message}`,
      );
    }

    console.log(
      `[Shot Generation] Cleared existing data for episode ${data.episodeId}. Inserting ${allShots.length} new shots.`,
    );

    const { error: insertError } = await supabase
      .from('shots')
      .insert(allShots);

    if (insertError) {
      throw new Error(`Failed to insert shots: ${insertError.message}`);
    }

    // 6. UPDATE episode with shot_list metadata
    const shotListData = {
      generatedAt: new Date().toISOString(),
      totalShots: allShots.length,
      totalDuration,
      shotTypes,
      scenesProcessed: scenes.length,
      processingMethod: 'shot-orchestrator',
    };

    // 6. Guard: Skip write if episode was deleted during processing
    const { data: currentEpisode } = await supabase
      .from('episodes')
      .select('status, deleted_at')
      .eq('id', data.episodeId)
      .single();

    if (!currentEpisode || currentEpisode.deleted_at) {
      console.warn(
        '[Shot Generation] Episode was deleted during generation. Skipping write.',
      );
      await markJobCompleted(supabase, data.episodeId, 'shot_list', {
        skipped: true,
        reason: 'episode-deleted',
      });
    } else {
      const { error: updateError } = await supabase
        .from('episodes')
        .update({
          shot_list: shotListData,
          updated_at: new Date().toISOString(),
        })
        .eq('id', data.episodeId)
        // NOTE: No .eq('version', ...) — version may drift during orchestrator mid-run writes
        .is('deleted_at', null);

      if (updateError) {
        console.error(
          '[Shot Generation] Failed to update episode:',
          updateError,
        );
      }
    }

    console.log(
      `[Shot Generation] Stage 3 complete. ${allShots.length} shots across ${scenes.length} scenes. Reel candidates: ${orchestratorResult.reelCandidateScenes.join(', ') || 'none'}`,
    );

    // 7. Queue Audio Refinement Job (The Dedicated Audio Pass)
    // We decouple audio generation to ensure coherence across shots (merging music, coherent SFX)
    console.log('[Shot Generation] Queuing audio refinement job');
    const { queueLlmJob } = await import('@kit/prompt-engine/server');

    // Create generation job entry for tracking audio cue generation
    const audioJobData = {
      reference_type: 'episode',
      reference_id: data.episodeId,
      job_type: 'audio_cue_generation',
      status: 'queued',
      account_id: data.accountId,
      project_id: data.projectId,
      idempotency_key: `audio-cues-${data.episodeId}-${Date.now()}`,
      input_data: { episodeId: data.episodeId },
    };

    const { error: audioJobError } = await supabase
      .from('generation_jobs')
      .insert(audioJobData);

    if (audioJobError) {
      console.error(
        '[Shot Generation] Failed to create audio cue job:',
        audioJobError,
      );
    }

    await queueLlmJob({
      jobType: 'audio-cue-generation',
      userId: data.userId,
      payload: {
        episodeId: data.episodeId,
        projectId: data.projectId,
        accountId: data.accountId,
        version: data.version,
      },
    });

    // Mark job as completed
    await markJobCompleted(supabase, data.episodeId, 'shot_list', {
      totalShots: allShots.length,
      scenesProcessed: scenes.length,
      totalDuration,
    });

    return {
      success: true,
      data: {
        totalShots: allShots.length,
        shotsCreated: allShots.length,
        metadata: {
          totalDuration,
          shotTypes,
          scenesProcessed: scenes.length,
        },
      },
    };
  } catch (error) {
    // Mark job as failed
    await markJobFailed(
      supabase,
      data.episodeId,
      'shot_list',
      error instanceof Error ? error.message : 'Unknown error',
    );
    throw error;
  }
}
