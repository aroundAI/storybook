'use server';

/**
 * ElevenLabs Music Generation Actions
 *
 * Server actions for generating music using ElevenLabs Eleven Music.
 * Includes asset library integration for reuse.
 */
import { z } from 'zod';

import { enhanceAction } from '@kit/next/actions';
import { getLogger } from '@kit/shared/logger';
import { requireUser } from '@kit/supabase/require-user';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

import { ElevenLabsMusicProvider } from '../providers/elevenlabs-music';
import {
  findOrCreateAudioAsset,
  updateAudioAssetAction,
} from './audio-asset-actions';
import { getProjectElevenLabsApiKey } from './project-audio-settings';

// =============================================================================
// Schemas
// =============================================================================

const GenerateMusicElevenLabsSchema = z.object({
  projectId: z.string().uuid(),
  episodeId: z.string().uuid().optional(),
  sceneNumber: z.number().int().positive().optional(),
  /** Music description/prompt */
  prompt: z.string().min(1).max(1000),
  /** Optional name for the track */
  name: z.string().max(100).optional(),
  /** Duration in seconds (5-300) */
  durationSeconds: z.number().min(5).max(300).default(60),
  /** Genre for prompt enhancement */
  genre: z.string().max(50).optional(),
  /** Mood for prompt enhancement */
  mood: z.string().max(50).optional(),
  /** Tempo */
  tempo: z.enum(['slow', 'medium', 'fast', 'varied']).optional(),
  /** Timeline position in seconds (for episode placement) */
  timelineStartSeconds: z.number().min(0).optional(),
});

// =============================================================================
// Types
// =============================================================================

interface GenerateMusicResult {
  assetId: string;
  prompt: string;
  status: 'completed' | 'failed' | 'reused';
  fileUrl?: string;
  duration?: number;
  error?: string;
  wasReused: boolean;
}

// =============================================================================
// Helpers
// =============================================================================

/**
 * Upload audio buffer to storage and return URL
 */
async function uploadAudioToStorage(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client: any,
  projectId: string,
  assetId: string,
  audioBuffer: Buffer,
): Promise<{ url: string; path: string }> {
  // Dynamic import to avoid circular dependency
  const { getStorageAdapter } = await import('@kit/storage');

  const fileName = `${assetId}.mp3`;
  const storagePath = `${projectId}/music/${fileName}`;
  const storage = getStorageAdapter(client);

  const { url } = await storage.upload('audio', storagePath, audioBuffer, {
    contentType: 'audio/mpeg',
    upsert: true,
  });

  return {
    url,
    path: storagePath,
  };
}

// =============================================================================
// Actions
// =============================================================================

/**
 * Generate music using ElevenLabs
 * Checks asset library first, generates if not found
 */
export const generateMusicElevenLabsAction = enhanceAction(
  async (data): Promise<GenerateMusicResult> => {
    const logger = await getLogger();
    const ctx = {
      name: 'music.generateElevenLabs',
      projectId: data.projectId,
      prompt: data.prompt.substring(0, 50),
    };

    logger.info(ctx, 'Starting music generation with ElevenLabs');

    const client = getSupabaseServerClient();
    const { data: user, error: authError } = await requireUser(client);

    if (authError || !user) {
      throw new Error('Authentication required');
    }

    // 1. Check if asset exists (deduplication)
    const { asset, isNew } = await findOrCreateAudioAsset({
      projectId: data.projectId,
      audioType: 'music',
      prompt: data.prompt,
      name: data.name,
      provider: 'elevenlabs',
      metadata: {
        durationSeconds: data.durationSeconds,
        genre: data.genre,
        mood: data.mood,
        tempo: data.tempo,
        sceneNumber: data.sceneNumber,
        episodeId: data.episodeId,
        timelineStartSeconds: data.timelineStartSeconds,
      },
    });

    // If asset already exists and is completed, return it
    if (!isNew && asset.status === 'completed' && asset.fileUrl) {
      logger.info(
        { ...ctx, assetId: asset.id },
        'Reusing existing music asset',
      );

      return {
        assetId: asset.id,
        prompt: data.prompt,
        status: 'reused',
        fileUrl: asset.fileUrl,
        duration: asset.durationSeconds ?? undefined,
        wasReused: true,
      };
    }

    // 2. Generate new music
    logger.info({ ...ctx, assetId: asset.id }, 'Generating new music');

    try {
      // Update status to processing
      await updateAudioAssetAction({
        assetId: asset.id,
        status: 'processing',
      });

      // Get API key and create provider
      const apiKey = await getProjectElevenLabsApiKey(data.projectId);
      const provider = new ElevenLabsMusicProvider({ apiKey });

      // Generate music
      const result = await provider.generateMusic({
        prompt: data.prompt,
        duration: data.durationSeconds,
        genre: data.genre,
        mood: data.mood,
        tempo: data.tempo,
      });

      // @ts-expect-error - audioBuffer is added to extended response
      const audioBuffer = result.audioBuffer as Buffer | undefined;

      if (result.status === 'failed' || !audioBuffer) {
        await updateAudioAssetAction({
          assetId: asset.id,
          status: 'failed',
          metadata: { error: 'No audio buffer returned' },
        });

        return {
          assetId: asset.id,
          prompt: data.prompt,
          status: 'failed',
          error: 'No audio buffer returned',
          wasReused: false,
        };
      }

      // 3. Upload to storage
      const { url, path } = await uploadAudioToStorage(
        client,
        data.projectId,
        asset.id,
        audioBuffer,
      );

      // 4. Update asset with completed status
      await updateAudioAssetAction({
        assetId: asset.id,
        status: 'completed',
        fileUrl: url,
        filePath: path,
        durationSeconds: data.durationSeconds,
        fileSizeBytes: audioBuffer.length,
        providerJobId: result.jobId,
      });

      logger.info(
        { ...ctx, assetId: asset.id, fileUrl: url },
        'Music generation completed',
      );

      // 5. If episodeId provided, create audio_track entry
      if (data.episodeId) {
        const timelineStart = data.timelineStartSeconds ?? 0;

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (client as any).from('audio_tracks').insert({
          episode_id: data.episodeId,
          type: 'music',
          name: data.name ?? `Music - ${data.genre ?? 'Background'}`,
          file_url: url,
          duration_seconds: data.durationSeconds,
          timeline_start_seconds: timelineStart,
          volume: 0.5, // Default music volume lower than dialogue
          metadata: {
            audio_asset_id: asset.id,
            prompt: data.prompt,
            genre: data.genre,
            mood: data.mood,
            sceneNumber: data.sceneNumber,
          },
        });
      }

      return {
        assetId: asset.id,
        prompt: data.prompt,
        status: 'completed',
        fileUrl: url,
        duration: data.durationSeconds,
        wasReused: false,
      };
    } catch (error) {
      logger.error({ ...ctx, error }, 'Music generation failed');

      await updateAudioAssetAction({
        assetId: asset.id,
        status: 'failed',
        metadata: {
          error: error instanceof Error ? error.message : 'Unknown error',
        },
      });

      return {
        assetId: asset.id,
        prompt: data.prompt,
        status: 'failed',
        error: error instanceof Error ? error.message : 'Unknown error',
        wasReused: false,
      };
    }
  },
  { schema: GenerateMusicElevenLabsSchema },
);
