/**
 * Audio Cue Generation Handler
 *
 * Dedicated pipeline for generating coherent audio cues from visual shots.
 * Runs AFTER shot generation to ensure music/SFX flow across shot boundaries.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

import {
  markJobCompleted,
  markJobFailed,
  markJobProcessing,
} from '../utils/job-tracking';

interface AudioCueGenerationPayload {
  episodeId: string;
  projectId: string;
  accountId: string;
}

interface ShotData {
  sequence_number: number;
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
  const data = payload as AudioCueGenerationPayload;
  const { episodeId } = data;

  console.log(`[Audio Generation] Processing for episode ${episodeId}`);
  await markJobProcessing(supabase, episodeId, 'audio_cue_generation');

  try {
    // 1. Fetch all shots for the episode
    const { data: shots, error: shotsError } = await supabase
      .from('shots')
      .select(
        'sequence_number, duration_seconds, scene_description, prompt, generation_metadata',
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

    const result = await executeLLM<{ cues: GeneratedAudioCue[] }>({
      templateSlug: 'audio-generation/scene-audio-refinement',
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

    const audioCueInserts = generatedCues
      .map((cue) => {
        const shotStartTime = shotStartTimes.get(cue.startShotSequence);

        if (shotStartTime === undefined) {
          console.warn(
            `[Audio Generation] Cue references unknown shot sequence: ${cue.startShotSequence}`,
          );
          return null;
        }

        const absoluteStart = shotStartTime + (cue.startOffsetInShot || 0);

        // Verify bounds (optional, but good practice)
        // If absoluteStart < 0, clamp to 0.
        const validStart = Math.max(0, absoluteStart);

        return {
          episode_id: episodeId,
          // We don't have scene_number in the cue output, we should infer it from the shot.
          // But we need to look up the shot by sequence number.
          // Wait, shots table doesn't have scene_number explicitly in my interface above, let me check DB schema.
          // Actually shot-generation.ts writes 'scene_number'. I should fetch it.
          scene_number: 1, // Fallback, see below
          cue_type: cue.type,
          prompt: cue.prompt,
          start_offset_seconds: validStart,
          duration_seconds: cue.durationSeconds,
          is_loopable: cue.type === 'ambient',
          status: 'pending',
        };
      })
      .filter(Boolean);

    // Re-fetch shots WITH scene_number to populate it correctly
    // (Optimized: could have fetched it in Step 1)
    const { data: shotsWithScene } = await supabase
      .from('shots')
      .select('sequence_number, scene_number')
      .eq('episode_id', episodeId);

    const sceneMap = new Map(
      shotsWithScene?.map((s) => [s.sequence_number, s.scene_number]),
    );

    // Update scene numbers in inserts
    for (const insert of audioCueInserts) {
      // Find the shot that contains this time?
      // Or simpler: use the startShotSequence from the generated cue.
      // The LLM gave us `startShotSequence`.
      // We need to map that back to the inserted object.
      // Let's redo the map logic slightly.
    }

    // Correct mapping loop
    const finalInserts = generatedCues
      .map((cue) => {
        const shotStartTime = shotStartTimes.get(cue.startShotSequence);
        if (shotStartTime === undefined) return null;

        const sceneNum = sceneMap.get(cue.startShotSequence) ?? 1;

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
