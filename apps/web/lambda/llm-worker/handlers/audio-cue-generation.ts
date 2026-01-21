/**
 * Audio Cue Generation Handler
 *
 * Dedicated pipeline for generating coherent audio cues from visual shots.
 * Runs AFTER shot generation to ensure music/SFX flow across shot boundaries.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

import { z } from 'zod';

import {
  markJobCompleted,
  markJobFailed,
  markJobProcessing,
} from '../utils/job-tracking';

const AudioCueGenerationPayloadSchema = z.object({
  episodeId: z.string(),
  projectId: z.string(),
  accountId: z.string(),
});

interface ShotData {
  sequence_number: number;
  scene_number: number;
  duration_seconds: number;
  scene_description: string;
  prompt: string;
  generation_metadata: {
    veoPrompt?: {
      audio?: string;
    };
    action?: string;
  };
}

interface GeneratedAudioCue {
  type: 'music' | 'sfx' | 'ambient';
  prompt: string;
  startShotSequence: number;
  startOffsetInShot: number;
  durationSeconds: number;
  reasoning?: string;
}

export async function processAudioCueGeneration(
  payload: Record<string, unknown>,
  supabase: SupabaseClient,
): Promise<{ success: boolean; cuesCreated: number }> {
  const data = AudioCueGenerationPayloadSchema.parse(payload);
  const { episodeId } = data;

  console.log(`[Audio Generation] Processing for episode ${episodeId}`);
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

    // 2. Prepare context for LLM
    // We group shots into scenes based on discontinuities or just process the whole batch if small enough.
    // For now, let's process the whole episode flow to ensure maximum coherence,
    // but typically we should split by scene (if scene_number was reliable in shots table).
    // The prompt template expects a JSON array of shots.

    const shotsJson = shots.map((s: ShotData) => ({
      seq: s.sequence_number,
      duration: s.duration_seconds,
      audioDesc:
        s.generation_metadata?.veoPrompt?.audio || 'No audio description',
      action: s.generation_metadata?.action || s.scene_description,
    }));

    // 3. Execute LLM
    const { executeLLM } = await import('@kit/prompt-engine/server');

    console.log(`[Audio Generation] Generating cues for ${shots.length} shots`);

    // We might need to chunk this if the episode is very long.
    // Assuming standard episode < 50 shots for now.
    if (shots.length > 50) {
      console.warn(
        `[Audio Generation] Episode has ${shots.length} shots. Context window limit may be reached. Consider implementing chunking.`,
      );
    }

    const result = await executeLLM<{ cues: GeneratedAudioCue[] }>({
      templateSlug: 'scene-audio-refinement',
      variables: {
        scene_heading: 'Full Episode Sequence', // or derive from first shot
        shots_json: JSON.stringify(shotsJson),
      },
      context: {
        name: `audio-refinement-${episodeId}`,
        accountId: data.accountId,
        userId: 'system',
      },
      temperature: 0.2, // Low temp for strict logic
      supabaseClient: supabase,
    });

    const generatedCues = result.data.cues;
    console.log(`[Audio Generation] Generated ${generatedCues.length} cues`);

    // 4. Transform to DB inserts
    // We need to map (startShotSequence + offset) -> absolute start_offset_seconds in the timeline

    // Build a map of Shot Sequence -> Start Time
    const shotStartTimes = new Map<number, number>();
    let currentTime = 0;
    for (const shot of shots) {
      shotStartTimes.set(shot.sequence_number, currentTime);
      currentTime += shot.duration_seconds;
    }

    // Create scene map from initial shots fetch
    const sceneMap = new Map(
      shots.map((s) => [s.sequence_number, s.scene_number]),
    );

    // Correct mapping loop
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
