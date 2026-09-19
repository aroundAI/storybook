'use server';

/**
 * Episode Audio Generation Actions
 *
 * Generates music and SFX for an episode based on shot/scene data.
 * Integrates with screenplay and shot-list data to extract audio requirements.
 */
import { z } from 'zod';

import { enhanceAction } from '@kit/next/actions';
import { getLogger } from '@kit/shared/logger';
import { requireUser } from '@kit/supabase/require-user';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

import { generateMusicElevenLabsAction } from './elevenlabs-music-actions';
import { generateSfxAction } from './sfx-actions';

// =============================================================================
// Schemas
// =============================================================================

const GenerateEpisodeAudioSchema = z.object({
  episodeId: z.string().uuid(),
  /** Options for what to generate */
  options: z
    .object({
      generateSfx: z.boolean().default(true),
      generateMusic: z.boolean().default(true),
      /** Skip already generated (reuse assets) */
      skipExisting: z.boolean().default(true),
    })
    .optional(),
});

const _GenerateShotSfxSchema = z.object({
  episodeId: z.string().uuid(),
  shotId: z.string().uuid(),
  /** Audio description from shot data */
  audioDescription: z.string(),
  /** Timeline position */
  timelineStartSeconds: z.number().min(0),
});

// =============================================================================
// Types
// =============================================================================

interface _ShotAudioData {
  shotId: string;
  sequenceNumber: number;
  audio?: string;
  sceneNumber: number;
  timelineStart: number;
  duration: number;
}

interface GenerateEpisodeAudioResult {
  sfxGenerated: number;
  sfxReused: number;
  sfxFailed: number;
  musicGenerated: number;
  musicReused: number;
  musicFailed: number;
  errors: string[];
}

// =============================================================================
// Helpers
// =============================================================================

/**
 * Parse SFX prompts from audio description
 * Splits comma-separated descriptions into individual SFX
 */
function parseSfxFromAudioDescription(audioDescription: string): string[] {
  if (!audioDescription || audioDescription.trim().length === 0) {
    return [];
  }

  // Split by comma or "and"
  const parts = audioDescription
    .split(/,|(?:\s+and\s+)/i)
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && s.length < 200);

  return parts;
}

/**
 * Calculate timeline start time for a shot based on previous shots
 */
function calculateShotTimelineStart(
  shots: Array<{ sequenceNumber: number; duration: number }>,
  targetSequence: number,
): number {
  let time = 0;
  for (const shot of shots.sort(
    (a, b) => a.sequenceNumber - b.sequenceNumber,
  )) {
    if (shot.sequenceNumber >= targetSequence) break;
    time += shot.duration;
  }
  return time;
}

// =============================================================================
// Actions
// =============================================================================

/**
 * Generate all audio (SFX + music) for an episode
 * Extracts audio requirements from shot_list_data and creates audio tracks
 */
export const generateEpisodeAudioAction = enhanceAction(
  async (data): Promise<GenerateEpisodeAudioResult> => {
    const logger = await getLogger();
    const ctx = { name: 'episode.generateAudio', episodeId: data.episodeId };

    logger.info(ctx, 'Starting episode audio generation');

    const client = getSupabaseServerClient();
    const { data: user, error: authError } = await requireUser(client);

    if (authError || !user) {
      throw new Error('Authentication required');
    }

    const options = data.options ?? {
      generateSfx: true,
      generateMusic: true,
      skipExisting: true,
    };

    // 1. Get episode with shot_list_data
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: episode, error: episodeError } = await (client as any)
      .from('episodes')
      .select('id, project_id, shot_list_data, screenplay_data')
      .eq('id', data.episodeId)
      .is('deleted_at', null)
      .single();

    if (episodeError || !episode) {
      throw new Error('Episode not found');
    }

    const shotListData = episode.shot_list_data as {
      shots?: Array<{
        id?: string;
        sequenceNumber: number;
        sceneNumber: number;
        audio?: string;
        duration?: number;
      }>;
    } | null;

    if (!shotListData?.shots || shotListData.shots.length === 0) {
      logger.warn(ctx, 'Episode has no shot list data');
      return {
        sfxGenerated: 0,
        sfxReused: 0,
        sfxFailed: 0,
        musicGenerated: 0,
        musicReused: 0,
        musicFailed: 0,
        errors: ['No shot list data found'],
      };
    }

    const result: GenerateEpisodeAudioResult = {
      sfxGenerated: 0,
      sfxReused: 0,
      sfxFailed: 0,
      musicGenerated: 0,
      musicReused: 0,
      musicFailed: 0,
      errors: [],
    };

    // 2. Extract SFX from shots and generate
    if (options.generateSfx) {
      logger.info(ctx, 'Generating SFX from shot audio descriptions');

      for (const shot of shotListData.shots) {
        if (!shot.audio) continue;

        const sfxPrompts = parseSfxFromAudioDescription(shot.audio);
        const timelineStart = calculateShotTimelineStart(
          shotListData.shots.map((s) => ({
            sequenceNumber: s.sequenceNumber,
            duration: s.duration ?? 5,
          })),
          shot.sequenceNumber,
        );

        for (const prompt of sfxPrompts) {
          try {
            const sfxResult = await generateSfxAction({
              projectId: episode.project_id,
              episodeId: data.episodeId,
              prompt,
              timelineStartSeconds: timelineStart,
              durationSeconds: 5, // Default SFX duration
            });

            if (sfxResult.wasReused) {
              result.sfxReused++;
            } else if (sfxResult.status === 'completed') {
              result.sfxGenerated++;
            } else {
              result.sfxFailed++;
              result.errors.push(`SFX failed: ${prompt} - ${sfxResult.error}`);
            }
          } catch (error) {
            result.sfxFailed++;
            result.errors.push(
              `SFX error: ${prompt} - ${error instanceof Error ? error.message : 'Unknown'}`,
            );
          }
        }
      }
    }

    // 3. Generate scene music
    if (options.generateMusic) {
      logger.info(ctx, 'Generating music for scenes');

      // Get unique scenes from shots
      const scenes = new Map<
        number,
        { startTime: number; description: string }
      >();
      let currentTime = 0;

      for (const shot of shotListData.shots.sort(
        (a, b) => a.sequenceNumber - b.sequenceNumber,
      )) {
        if (!scenes.has(shot.sceneNumber)) {
          scenes.set(shot.sceneNumber, {
            startTime: currentTime,
            description: `Background music for scene ${shot.sceneNumber}`,
          });
        }
        currentTime += shot.duration ?? 5;
      }

      // Generate music per scene
      for (const [sceneNumber, sceneData] of scenes) {
        try {
          // Calculate scene duration
          const sceneShots = shotListData.shots.filter(
            (s) => s.sceneNumber === sceneNumber,
          );
          const sceneDuration = Math.max(
            30, // Minimum 30 seconds
            sceneShots.reduce((sum, s) => sum + (s.duration ?? 5), 0),
          );

          const musicResult = await generateMusicElevenLabsAction({
            projectId: episode.project_id,
            episodeId: data.episodeId,
            sceneNumber,
            prompt: `Cinematic background music for a scene. ${sceneData.description}`,
            durationSeconds: Math.min(sceneDuration, 120), // Max 2 minutes
            genre: 'cinematic',
            mood: 'atmospheric',
            timelineStartSeconds: sceneData.startTime,
          });

          if (musicResult.wasReused) {
            result.musicReused++;
          } else if (musicResult.status === 'completed') {
            result.musicGenerated++;
          } else {
            result.musicFailed++;
            result.errors.push(
              `Music failed for scene ${sceneNumber}: ${musicResult.error}`,
            );
          }
        } catch (error) {
          result.musicFailed++;
          result.errors.push(
            `Music error scene ${sceneNumber}: ${error instanceof Error ? error.message : 'Unknown'}`,
          );
        }
      }
    }

    logger.info(
      {
        ...ctx,
        sfxGenerated: result.sfxGenerated,
        sfxReused: result.sfxReused,
        musicGenerated: result.musicGenerated,
        musicReused: result.musicReused,
      },
      'Episode audio generation completed',
    );

    return result;
  },
  { schema: GenerateEpisodeAudioSchema },
);
