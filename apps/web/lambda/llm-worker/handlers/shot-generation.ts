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
  dialogue: Array<{
    character: string;
    dialogue: string;
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
  const data = payload as ShotGenerationPayload;

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

    // 3. Run the Stage 3 Shot Orchestrator (Reel Scout + Shot Director)
    const { runShotOrchestrator } = await import(
      '@kit/episodes/agent/shot-orchestrator'
    );

    const orchestratorResult = await runShotOrchestrator({
      episodeId: data.episodeId,
      episodeTitle: episode.title,
      genre: episodeContext.genre ?? 'general',
      targetAudience: episodeContext.targetAudience ?? 'general',
      visualStyle: episodeContext.visualStyle ?? 'cinematic',
      accountId: data.accountId,
      // Map screenplay scenes — dialogue.text is the field name in ShotOrchestratorScene
      scenes: scenes.map((s) => ({
        number: s.number,
        heading: s.heading,
        location: s.location,
        timeOfDay: s.timeOfDay,
        description: s.description,
        action: s.action,
        dialogue: (s.dialogue ?? []).map((d) => ({
          character: d.character,
          text: (d as Record<string, unknown>).text as string ?? d.dialogue ?? '',
          parenthetical: d.parenthetical,
        })),
        estimatedDuration: (s as Record<string, unknown>).estimatedDuration as number | undefined,
      })),
      charactersVeoContext: charactersFormatted,
      locationsVeoContext: locationsFormatted,
    });

    if (!orchestratorResult.success || orchestratorResult.shots.length === 0) {
      throw new Error(
        `Shot Orchestrator failed: ${orchestratorResult.error ?? 'No shots generated'}`,
      );
    }

    const reelCandidateSet = new Set(orchestratorResult.reelCandidateScenes);

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
    }> = [];

    const shotTypes = { wide: 0, medium: 0, closeUp: 0 };
    let totalDuration = 0;

    for (const shot of orchestratorResult.shots) {
      const sceneIsCandidate = reelCandidateSet.has(shot.sceneNumber);

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
        shorts_metadata: sceneIsCandidate
          ? { hookType: shot.metadata.hookType, estimatedDurationSeconds: shot.duration }
          : null,
        generation_metadata: {
          shotType: shot.shotType,
          location: shot.metadata.location,
          timeOfDay: shot.metadata.timeOfDay,
          mood: shot.metadata.mood,
          characters: shot.characters ?? [],
          veoPrompt: shot.veoPrompt,
          isReelCandidate: sceneIsCandidate,
        },
      });

      if (shot.shotType === 'wide') shotTypes.wide++;
      else if (shot.shotType === 'medium') shotTypes.medium++;
      else if (shot.shotType?.includes('close')) shotTypes.closeUp++;
      totalDuration += shot.duration;
    }

    if (allShots.length === 0) {
      throw new Error('No shots were generated');
    }

    // 5. INSERT shots
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

    const { error: updateError } = await supabase
      .from('episodes')
      .update({
        shot_list: shotListData,
        updated_at: new Date().toISOString(),
      })
      .eq('id', data.episodeId)
      .eq('version', data.version);

    if (updateError) {
      console.error('[Shot Generation] Failed to update episode:', updateError);
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
