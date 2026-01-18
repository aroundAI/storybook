'use server';

import 'server-only';

import { revalidatePath } from 'next/cache';

import { z } from 'zod';

import { enhanceAction } from '@kit/next/actions';
import { getLogger } from '@kit/shared/logger';
import { requireUser } from '@kit/supabase/require-user';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

import {
  type GenerateMusicCueInput,
  GenerateMusicCueSchema,
  type GenerateSceneMusicInput,
  GenerateSceneMusicSchema,
  type PollMusicStatusInput,
  PollMusicStatusSchema,
} from '../lib/schemas/music.schema';
import { SunoProvider } from '../providers/suno';

/**
 * Music Generation Actions
 *
 * Server actions for generating music using Suno provider.
 * Supports both scene-based automatic generation and manual cue placement.
 */

// =============================================================================
// Types
// =============================================================================

interface ScreenplayScene {
  number: number;
  heading: string;
  location: string;
  timeOfDay: string;
  description: string;
  estimatedDuration: number;
}

interface AudioTrackRow {
  id: string;
  episode_id: string;
  type: string;
  name: string | null;
  file_url: string | null;
  duration_seconds: number | null;
  timeline_start_seconds: number;
  volume: number;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

interface GenerateMusicResult {
  success: boolean;
  trackId: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  jobId?: string;
  error?: string;
}

interface PollMusicResult {
  trackId: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  audioUrl?: string;
  progress?: number;
  error?: string;
}

// =============================================================================
// Helpers
// =============================================================================

/**
 * Get Suno provider instance
 */
function getSunoProvider(): SunoProvider {
  const apiKey = process.env.SUNO_API_KEY;
  if (!apiKey) {
    throw new Error('SUNO_API_KEY not configured');
  }
  return new SunoProvider({ apiKey });
}

/**
 * Build music prompt from scene data
 */
function buildSceneMusicPrompt(
  scene: ScreenplayScene,
  options: { genre?: string; mood?: string },
): string {
  const parts: string[] = [];

  // Add mood/atmosphere from options or scene
  if (options.mood) {
    parts.push(`${options.mood} mood`);
  }

  // Add genre if specified
  if (options.genre) {
    parts.push(`${options.genre} style`);
  }

  // Add scene context
  parts.push(`music for ${scene.location.toLowerCase()}`);

  // Add time of day atmosphere
  if (scene.timeOfDay) {
    const timeAtmosphere: Record<string, string> = {
      day: 'daytime ambiance',
      night: 'nighttime atmosphere',
      dawn: 'early morning feel',
      dusk: 'evening twilight mood',
    };
    const atmosphere = timeAtmosphere[scene.timeOfDay.toLowerCase()];
    if (atmosphere) {
      parts.push(atmosphere);
    }
  }

  // Add scene description for context
  if (scene.description && scene.description.length < 100) {
    parts.push(`scene: ${scene.description.toLowerCase()}`);
  }

  return parts.join(', ');
}

/**
 * Calculate scene start time from previous scenes
 */
function calculateSceneStartTime(
  scenes: ScreenplayScene[],
  targetSceneNumber: number,
): number {
  let startTime = 0;
  for (const scene of scenes) {
    if (scene.number >= targetSceneNumber) break;
    startTime += scene.estimatedDuration;
  }
  return startTime;
}

// =============================================================================
// Actions
// =============================================================================

/**
 * Generate music for a specific scene
 *
 * Automatically extracts mood and description from screenplay data
 * to generate contextually appropriate music.
 *
 * @example
 * const result = await generateSceneMusicAction({
 *   episodeId: 'uuid',
 *   sceneNumber: 1,
 *   genre: 'cinematic',
 *   instrumentalOnly: true,
 * });
 */
export const generateSceneMusicAction = enhanceAction(
  async (data: GenerateSceneMusicInput): Promise<GenerateMusicResult> => {
    const logger = await getLogger();
    const ctx = {
      name: 'music.generateScene',
      episodeId: data.episodeId,
      sceneNumber: data.sceneNumber,
    };

    logger.info(ctx, 'Generating music for scene');

    const client = getSupabaseServerClient();
    const { data: user, error: authError } = await requireUser(client);

    if (authError || !user) {
      logger.warn(ctx, 'Unauthorized music generation attempt');
      throw new Error('Authentication required');
    }

    // 1. Fetch episode with screenplay data
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: episode, error: episodeError } = await (client as any)
      .from('episodes')
      .select('id, screenplay_data')
      .eq('id', data.episodeId)
      .single();

    if (episodeError || !episode) {
      logger.error({ ...ctx, error: episodeError }, 'Failed to fetch episode');
      throw new Error('Episode not found');
    }

    const screenplayData = episode.screenplay_data as {
      scenes?: ScreenplayScene[];
    } | null;
    const scenes = screenplayData?.scenes ?? [];

    // 2. Find the target scene
    const targetScene = scenes.find((s) => s.number === data.sceneNumber);
    if (!targetScene) {
      throw new Error(`Scene ${data.sceneNumber} not found in screenplay`);
    }

    // 3. Build music prompt
    const prompt =
      data.prompt ??
      buildSceneMusicPrompt(targetScene, {
        genre: data.genre,
        mood: data.mood,
      });

    // 4. Calculate duration and timeline position
    const duration =
      data.duration ?? Math.min(targetScene.estimatedDuration, 240);
    const timelineStartSeconds = calculateSceneStartTime(
      scenes,
      data.sceneNumber,
    );

    // 5. Create audio_track record (status: pending)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: track, error: trackError } = await (client as any)
      .from('audio_tracks')
      .insert({
        episode_id: data.episodeId,
        type: 'music',
        name: `Scene ${data.sceneNumber} Music`,
        timeline_start_seconds: timelineStartSeconds,
        duration_seconds: duration,
        volume: 0.7, // Default background music volume
        metadata: {
          status: 'pending',
          sceneNumber: data.sceneNumber,
          prompt,
          genre: data.genre,
          mood: data.mood,
          instrumentalOnly: data.instrumentalOnly ?? true,
        },
      })
      .select('id')
      .single();

    if (trackError || !track) {
      logger.error(
        { ...ctx, error: trackError },
        'Failed to create audio track',
      );
      throw new Error('Failed to create audio track');
    }

    // 6. Submit to Suno
    try {
      const suno = getSunoProvider();
      const response = await suno.generateMusic({
        prompt,
        duration,
        genre: data.genre,
        mood: data.mood,
        tempo: data.tempo,
        instrumentalOnly: data.instrumentalOnly ?? true,
        tags: data.tags,
      });

      // Update track with job ID
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (client as any)
        .from('audio_tracks')
        .update({
          metadata: {
            status: 'processing',
            sceneNumber: data.sceneNumber,
            prompt,
            genre: data.genre,
            mood: data.mood,
            instrumentalOnly: data.instrumentalOnly ?? true,
            providerJobId: response.jobId,
            provider: 'suno',
            estimatedCostCents: response.cost,
          },
        })
        .eq('id', track.id);

      logger.info(
        { ...ctx, trackId: track.id, jobId: response.jobId },
        'Music generation submitted to Suno',
      );

      return {
        success: true,
        trackId: track.id,
        status: 'processing',
        jobId: response.jobId,
      };
    } catch (error) {
      // Update track with error status
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (client as any)
        .from('audio_tracks')
        .update({
          metadata: {
            status: 'failed',
            error: error instanceof Error ? error.message : 'Unknown error',
          },
        })
        .eq('id', track.id);

      logger.error({ ...ctx, error }, 'Failed to submit music generation');
      throw error;
    }
  },
  {
    schema: GenerateSceneMusicSchema,
  },
);

/**
 * Generate music from a manual cue
 *
 * User specifies exact timeline position, duration, and prompt.
 *
 * @example
 * const result = await generateMusicCueAction({
 *   episodeId: 'uuid',
 *   prompt: 'Dramatic orchestral tension building',
 *   duration: 30,
 *   timelineStartSeconds: 120,
 *   name: 'Climax Music',
 * });
 */
export const generateMusicCueAction = enhanceAction(
  async (data: GenerateMusicCueInput): Promise<GenerateMusicResult> => {
    const logger = await getLogger();
    const ctx = {
      name: 'music.generateCue',
      episodeId: data.episodeId,
      timelineStart: data.timelineStartSeconds,
    };

    logger.info(ctx, 'Generating music cue');

    const client = getSupabaseServerClient();
    const { data: user, error: authError } = await requireUser(client);

    if (authError || !user) {
      logger.warn(ctx, 'Unauthorized music cue generation attempt');
      throw new Error('Authentication required');
    }

    // 1. Create audio_track record
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: track, error: trackError } = await (client as any)
      .from('audio_tracks')
      .insert({
        episode_id: data.episodeId,
        type: 'music',
        name: data.name ?? 'Music Cue',
        timeline_start_seconds: data.timelineStartSeconds,
        duration_seconds: data.duration,
        volume: 0.7,
        metadata: {
          status: 'pending',
          prompt: data.prompt,
          genre: data.genre,
          mood: data.mood,
          instrumentalOnly: data.instrumentalOnly ?? true,
          isCue: true,
        },
      })
      .select('id')
      .single();

    if (trackError || !track) {
      logger.error(
        { ...ctx, error: trackError },
        'Failed to create audio track',
      );
      throw new Error('Failed to create audio track');
    }

    // 2. Submit to Suno
    try {
      const suno = getSunoProvider();
      const response = await suno.generateMusic({
        prompt: data.prompt,
        duration: data.duration,
        genre: data.genre,
        mood: data.mood,
        tempo: data.tempo,
        instrumentalOnly: data.instrumentalOnly ?? true,
        tags: data.tags,
      });

      // Update track with job ID
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (client as any)
        .from('audio_tracks')
        .update({
          metadata: {
            status: 'processing',
            prompt: data.prompt,
            genre: data.genre,
            mood: data.mood,
            instrumentalOnly: data.instrumentalOnly ?? true,
            isCue: true,
            providerJobId: response.jobId,
            provider: 'suno',
            estimatedCostCents: response.cost,
          },
        })
        .eq('id', track.id);

      logger.info(
        { ...ctx, trackId: track.id, jobId: response.jobId },
        'Music cue generation submitted to Suno',
      );

      return {
        success: true,
        trackId: track.id,
        status: 'processing',
        jobId: response.jobId,
      };
    } catch (error) {
      // Update track with error status
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (client as any)
        .from('audio_tracks')
        .update({
          metadata: {
            status: 'failed',
            error: error instanceof Error ? error.message : 'Unknown error',
          },
        })
        .eq('id', track.id);

      logger.error({ ...ctx, error }, 'Failed to submit music cue generation');
      throw error;
    }
  },
  {
    schema: GenerateMusicCueSchema,
  },
);

/**
 * Poll music generation status
 *
 * Checks the status of a music generation job and updates
 * the audio track record when complete.
 *
 * @example
 * const result = await pollMusicStatusAction({ trackId: 'uuid' });
 * if (result.status === 'completed') {
 *   console.log('Audio URL:', result.audioUrl);
 * }
 */
export const pollMusicStatusAction = enhanceAction(
  async (data: PollMusicStatusInput): Promise<PollMusicResult> => {
    const logger = await getLogger();
    const ctx = {
      name: 'music.pollStatus',
      trackId: data.trackId,
    };

    logger.info(ctx, 'Polling music generation status');

    const client = getSupabaseServerClient();
    const { data: user, error: authError } = await requireUser(client);

    if (authError || !user) {
      logger.warn(ctx, 'Unauthorized music status poll attempt');
      throw new Error('Authentication required');
    }

    // 1. Fetch the audio track
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: track, error: trackError } = await (client as any)
      .from('audio_tracks')
      .select('id, file_url, metadata')
      .eq('id', data.trackId)
      .single();

    if (trackError || !track) {
      logger.error(
        { ...ctx, error: trackError },
        'Failed to fetch audio track',
      );
      throw new Error('Audio track not found');
    }

    const trackData = track as AudioTrackRow;
    const metadata = trackData.metadata as {
      status?: string;
      providerJobId?: string;
      provider?: string;
    } | null;

    // If already completed or failed, return current status
    if (
      trackData.file_url ||
      metadata?.status === 'completed' ||
      metadata?.status === 'failed'
    ) {
      return {
        trackId: data.trackId,
        status: (metadata?.status as PollMusicResult['status']) ?? 'completed',
        audioUrl: trackData.file_url ?? undefined,
      };
    }

    // 2. Poll provider for status
    const jobId = metadata?.providerJobId;
    if (!jobId) {
      return {
        trackId: data.trackId,
        status: 'pending',
      };
    }

    try {
      const suno = getSunoProvider();
      const response = await suno.getStatus(jobId);

      // 3. Update track if completed
      if (response.status === 'completed' && response.audioUrl) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (client as any)
          .from('audio_tracks')
          .update({
            file_url: response.audioUrl,
            metadata: {
              ...metadata,
              status: 'completed',
              completedAt: new Date().toISOString(),
            },
          })
          .eq('id', data.trackId);

        logger.info(
          { ...ctx, audioUrl: response.audioUrl },
          'Music generation completed',
        );

        return {
          trackId: data.trackId,
          status: 'completed',
          audioUrl: response.audioUrl,
        };
      }

      // 4. Update track if failed
      if (response.status === 'failed') {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (client as any)
          .from('audio_tracks')
          .update({
            metadata: {
              ...metadata,
              status: 'failed',
              error: response.error,
              failedAt: new Date().toISOString(),
            },
          })
          .eq('id', data.trackId);

        logger.error(
          { ...ctx, error: response.error },
          'Music generation failed',
        );

        return {
          trackId: data.trackId,
          status: 'failed',
          error: response.error,
        };
      }

      // Still processing
      return {
        trackId: data.trackId,
        status: response.status,
        progress: response.progress,
      };
    } catch (error) {
      logger.error({ ...ctx, error }, 'Failed to poll music status');
      throw error;
    }
  },
  {
    schema: PollMusicStatusSchema,
  },
);
/**
 * Update an audio track (music/sfx) timing/metadata
 */
export const updateAudioTrackAction = enhanceAction(
  async (data: {
    trackId: string;
    timelineStartSeconds?: number;
    durationSeconds?: number;
    volume?: number;
    prompt?: string;
  }): Promise<{ success: boolean; trackId: string }> => {
    const logger = await getLogger();
    const ctx = {
      name: 'audioTrack.update',
      trackId: data.trackId,
    };

    const client = getSupabaseServerClient();
    const { data: user, error: authError } = await requireUser(client);

    if (authError || !user) {
      throw new Error('Authentication required');
    }

    const updatePayload: Record<string, unknown> = {};
    if (data.timelineStartSeconds !== undefined) {
      updatePayload.timeline_start_seconds = data.timelineStartSeconds;
    }
    if (data.durationSeconds !== undefined) {
      updatePayload.duration_seconds = data.durationSeconds;
    }
    if (data.volume !== undefined) {
      updatePayload.volume = data.volume;
    }

    if (data.prompt !== undefined) {
      // Fetch existing metadata first to merge
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: track } = await (client as any)
        .from('audio_tracks')
        .select('metadata')
        .eq('id', data.trackId)
        .single();

      updatePayload.metadata = {
        ...(track?.metadata || {}),
        prompt: data.prompt,
      };
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: updateError } = await (client as any)
      .from('audio_tracks')
      .update(updatePayload)
      .eq('id', data.trackId);

    if (updateError) {
      logger.error(
        { ...ctx, error: updateError },
        'Failed to update audio track',
      );
      throw new Error('Failed to update audio track');
    }

    revalidatePath('/home/[account]/studio/[projectId]/episodes', 'page');
    return { success: true, trackId: data.trackId };
  },
  {
    schema: z.object({
      trackId: z.string().uuid(),
      timelineStartSeconds: z.number().min(0).optional(),
      durationSeconds: z.number().positive().optional(),
      volume: z.number().min(0).max(1).optional(),
      prompt: z.string().min(1).optional(),
    }),
  },
);
