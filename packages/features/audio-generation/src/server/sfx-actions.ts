'use server';

/**
 * SFX Generation Actions
 *
 * Server actions for generating sound effects using ElevenLabs.
 * Includes asset library integration for reuse.
 */
import { z } from 'zod';

import { checkRateLimit, enhanceAction } from '@kit/next/actions';
import { authorizeProjectTarget } from '@kit/prompt-engine/llm-job-target';
import { getLogger } from '@kit/shared/logger';
import { requireUser } from '@kit/supabase/require-user';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

import { ElevenLabsSfxProvider } from '../providers/elevenlabs-sfx';
import { updateAudioAssetAction } from './audio-asset-actions';
import { findOrCreateAudioAsset } from './audio-asset-library';
import { getProjectElevenLabsApiKey } from './project-audio-settings';

// =============================================================================
// Schemas
// =============================================================================

const GenerateSfxSchema = z.object({
  projectId: z.string().uuid(),
  episodeId: z.string().uuid().optional(),
  /** Text description of the sound effect */
  prompt: z.string().min(1).max(500),
  /** Optional name for the SFX */
  name: z.string().max(100).optional(),
  /** Duration hint in seconds */
  durationSeconds: z.number().min(1).max(22).optional(),
  /** Timeline position in seconds (for episode placement) */
  timelineStartSeconds: z.number().min(0).optional(),
});

const GenerateSfxBatchSchema = z.object({
  projectId: z.string().uuid(),
  episodeId: z.string().uuid().optional(),
  /** Array of SFX prompts to generate */
  prompts: z
    .array(
      z.object({
        prompt: z.string().min(1).max(500),
        name: z.string().max(100).optional(),
        durationSeconds: z.number().min(1).max(22).optional(),
        timelineStartSeconds: z.number().min(0).optional(),
      }),
    )
    .min(1)
    .max(20),
});

// =============================================================================
// Types
// =============================================================================

interface GenerateSfxResult {
  assetId: string;
  prompt: string;
  status: 'completed' | 'failed' | 'reused';
  fileUrl?: string;
  duration?: number;
  error?: string;
  wasReused: boolean;
}

/**
 * Upload audio buffer to storage and return URL
 */
async function uploadAudioToStorage(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client: any,
  projectId: string,
  assetId: string,
  audioBuffer: Buffer,
  audioType: 'music' | 'sfx',
): Promise<{ url: string; path: string }> {
  // Dynamic import to avoid circular dependency
  const { getStorageAdapter } = await import('@kit/storage');

  const fileName = `${assetId}.mp3`;
  const storagePath = `${projectId}/${audioType}/${fileName}`;
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
 * Generate a single sound effect
 * Checks asset library first, generates if not found
 */
export const generateSfxAction = enhanceAction(
  async (data): Promise<GenerateSfxResult> => {
    const logger = await getLogger();
    const ctx = {
      name: 'sfx.generate',
      projectId: data.projectId,
      prompt: data.prompt.substring(0, 50),
    };

    logger.info(ctx, 'Starting SFX generation');

    const client = getSupabaseServerClient();
    const { data: user, error: authError } = await requireUser(client);

    if (authError || !user) {
      throw new Error('Authentication required');
    }

    checkRateLimit(user.id, 'generateSfx', {
      maxRequests: 10,
      windowMs: 60_000,
    });

    // Spending the project's key needs write access: a teammate who can only
    // read the project can read the key row too (KB-46)
    if (!(await authorizeProjectTarget(client, data.projectId))) {
      logger.warn(
        { ...ctx, userId: user.id, reason: 'not_writable' },
        'SFX generation refused',
      );
      return {
        assetId: '',
        prompt: data.prompt,
        status: 'failed',
        error: 'Project not found',
        wasReused: false,
      };
    }

    // 1. Check if asset exists (deduplication)
    const { asset, isNew } = await findOrCreateAudioAsset({
      projectId: data.projectId,
      audioType: 'sfx',
      prompt: data.prompt,
      name: data.name,
      provider: 'elevenlabs',
      metadata: {
        durationSeconds: data.durationSeconds,
        timelineStartSeconds: data.timelineStartSeconds,
        episodeId: data.episodeId,
      },
    });

    // If asset already exists and is completed, return it
    if (!isNew && asset.status === 'completed' && asset.fileUrl) {
      logger.info({ ...ctx, assetId: asset.id }, 'Reusing existing SFX asset');

      return {
        assetId: asset.id,
        prompt: data.prompt,
        status: 'reused',
        fileUrl: asset.fileUrl,
        duration: asset.durationSeconds ?? undefined,
        wasReused: true,
      };
    }

    // 2. Generate new SFX
    logger.info({ ...ctx, assetId: asset.id }, 'Generating new SFX');

    try {
      // Update status to processing
      await updateAudioAssetAction({
        assetId: asset.id,
        status: 'processing',
      });

      // Get API key and create provider
      const apiKey = await getProjectElevenLabsApiKey(data.projectId);
      const provider = new ElevenLabsSfxProvider({ apiKey });

      // Generate SFX
      const result = await provider.generateSfx({
        text: data.prompt,
        durationSeconds: data.durationSeconds,
      });

      if (result.status === 'failed' || !result.audioBuffer) {
        await updateAudioAssetAction({
          assetId: asset.id,
          status: 'failed',
          metadata: { error: result.error },
        });

        return {
          assetId: asset.id,
          prompt: data.prompt,
          status: 'failed',
          error: result.error,
          wasReused: false,
        };
      }

      // 3. Upload to storage
      const { url, path } = await uploadAudioToStorage(
        client,
        data.projectId,
        asset.id,
        result.audioBuffer,
        'sfx',
      );

      // 4. Update asset with completed status
      await updateAudioAssetAction({
        assetId: asset.id,
        status: 'completed',
        fileUrl: url,
        filePath: path,
        durationSeconds: result.duration,
        fileSizeBytes: result.audioBuffer.length,
        providerJobId: result.jobId,
      });

      logger.info(
        { ...ctx, assetId: asset.id, fileUrl: url },
        'SFX generation completed',
      );

      // 5. If episodeId provided, create audio_track entry
      if (data.episodeId && data.timelineStartSeconds !== undefined) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (client as any).from('audio_tracks').insert({
          episode_id: data.episodeId,
          type: 'sfx',
          name: data.name ?? data.prompt.substring(0, 50),
          file_url: url,
          duration_seconds: result.duration,
          timeline_start_seconds: data.timelineStartSeconds,
          volume: 1.0,
          metadata: {
            audio_asset_id: asset.id,
            prompt: data.prompt,
          },
        });
      }

      return {
        assetId: asset.id,
        prompt: data.prompt,
        status: 'completed',
        fileUrl: url,
        duration: result.duration,
        wasReused: false,
      };
    } catch (error) {
      logger.error({ ...ctx, error }, 'SFX generation failed');

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
  { schema: GenerateSfxSchema },
);

/**
 * Generate multiple sound effects in batch
 * Useful for generating all SFX from shot data
 */
export const generateSfxBatchAction = enhanceAction(
  async (data): Promise<{ results: GenerateSfxResult[] }> => {
    const client = getSupabaseServerClient();
    const { data: batchUser, error: batchAuthError } =
      await requireUser(client);

    if (batchAuthError || !batchUser) {
      throw new Error('Authentication required');
    }

    checkRateLimit(batchUser.id, 'generateSfxBatch', {
      maxRequests: 3,
      windowMs: 60_000,
    });

    const logger = await getLogger();
    const ctx = {
      name: 'sfx.generateBatch',
      projectId: data.projectId,
      count: data.prompts.length,
    };

    logger.info(ctx, 'Starting batch SFX generation');

    const results: GenerateSfxResult[] = [];

    // Process sequentially to avoid rate limiting
    for (const item of data.prompts) {
      try {
        const result = await generateSfxAction({
          projectId: data.projectId,
          episodeId: data.episodeId,
          prompt: item.prompt,
          name: item.name,
          durationSeconds: item.durationSeconds,
          timelineStartSeconds: item.timelineStartSeconds,
        });

        results.push(result);
      } catch (error) {
        results.push({
          assetId: '',
          prompt: item.prompt,
          status: 'failed',
          error: error instanceof Error ? error.message : 'Unknown error',
          wasReused: false,
        });
      }
    }

    const stats = {
      completed: results.filter((r) => r.status === 'completed').length,
      reused: results.filter((r) => r.status === 'reused').length,
      failed: results.filter((r) => r.status === 'failed').length,
    };

    logger.info({ ...ctx, ...stats }, 'Batch SFX generation completed');

    return { results };
  },
  { schema: GenerateSfxBatchSchema },
);
