/**
 * SFX Core
 *
 * Core SFX generation logic without server action wrapper.
 * Used by LLM Worker Lambda for async processing.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

import { getLogger } from '@kit/shared/logger';
import { generatedAudioPath } from '@kit/storage/upload-paths';

import { ElevenLabsSfxProvider } from '../../providers/elevenlabs-sfx';
import {
  findOrCreateAudioAssetCore,
  updateAudioAssetCore,
} from './audio-asset-core';

// =============================================================================
// Types
// =============================================================================

/** Upload function type for dependency injection */
export type UploadFn = (
  bucket: string,
  path: string,
  data: Buffer,
  contentType: string,
) => Promise<{ url: string; path: string }>;

export interface GenerateSfxCoreInput {
  supabase: SupabaseClient;
  projectId: string;
  episodeId?: string;
  prompt: string;
  name?: string;
  durationSeconds?: number;
  timelineStartSeconds?: number;
  /** ElevenLabs API key (decrypted) - passed from handler to avoid server-only import */
  apiKey: string;
  /**
   * Writes the file. The worker passes its R2 upload, which checks the key
   * against the job's authorised target (KB-57); there is no user session
   * here for `writeProjectObject` to check.
   */
  uploadFn: UploadFn;
}

export interface GenerateSfxCoreResult {
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

async function uploadAudioToStorage(
  projectId: string,
  assetId: string,
  audioBuffer: Buffer,
  uploadFn: UploadFn,
): Promise<{ url: string; path: string }> {
  return uploadFn(
    'audio',
    generatedAudioPath(projectId, 'sfx', assetId),
    audioBuffer,
    'audio/mpeg',
  );
}

// =============================================================================
// Core Function
// =============================================================================

/**
 * Generate SFX using ElevenLabs (core logic)
 * Called directly from LLM Worker Lambda without server action wrapper
 */
export async function generateSfxCore(
  input: GenerateSfxCoreInput,
): Promise<GenerateSfxCoreResult> {
  const logger = await getLogger();
  const ctx = {
    name: 'sfx.generateCore',
    projectId: input.projectId,
    prompt: input.prompt.substring(0, 50),
  };

  logger.info(ctx, 'Starting SFX generation (core)');

  // 1. Check if asset exists (deduplication)
  const { asset, isNew } = await findOrCreateAudioAssetCore({
    supabase: input.supabase,
    projectId: input.projectId,
    audioType: 'sfx',
    prompt: input.prompt,
    name: input.name,
    provider: 'elevenlabs',
    metadata: {
      durationSeconds: input.durationSeconds,
      timelineStartSeconds: input.timelineStartSeconds,
      episodeId: input.episodeId,
    },
  });

  // If asset already exists and is completed, return it
  if (!isNew && asset.status === 'completed' && asset.fileUrl) {
    logger.info({ ...ctx, assetId: asset.id }, 'Reusing existing SFX asset');

    return {
      assetId: asset.id,
      prompt: input.prompt,
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
    await updateAudioAssetCore({
      supabase: input.supabase,
      assetId: asset.id,
      status: 'processing',
    });

    // Use API key passed from handler
    const provider = new ElevenLabsSfxProvider({ apiKey: input.apiKey });

    // Generate SFX
    const result = await provider.generateSfx({
      text: input.prompt,
      durationSeconds: input.durationSeconds,
    });

    if (result.status === 'failed' || !result.audioBuffer) {
      await updateAudioAssetCore({
        supabase: input.supabase,
        assetId: asset.id,
        status: 'failed',
        metadata: { error: result.error },
      });

      return {
        assetId: asset.id,
        prompt: input.prompt,
        status: 'failed',
        error: result.error,
        wasReused: false,
      };
    }

    // 3. Upload to storage
    const { url, path } = await uploadAudioToStorage(
      input.projectId,
      asset.id,
      result.audioBuffer,
      input.uploadFn,
    );

    // 4. Update asset with completed status
    await updateAudioAssetCore({
      supabase: input.supabase,
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
      'SFX generation completed (core)',
    );

    // 5. If episodeId provided, create audio_track entry
    if (input.episodeId && input.timelineStartSeconds !== undefined) {
      await input.supabase.from('audio_tracks').insert({
        episode_id: input.episodeId,
        type: 'sfx',
        name: input.name ?? input.prompt.substring(0, 50),
        file_url: url,
        duration_seconds: result.duration,
        timeline_start_seconds: input.timelineStartSeconds,
        volume: 1.0,
        metadata: {
          audio_asset_id: asset.id,
          prompt: input.prompt,
        },
      });
    }

    return {
      assetId: asset.id,
      prompt: input.prompt,
      status: 'completed',
      fileUrl: url,
      duration: result.duration,
      wasReused: false,
    };
  } catch (error) {
    logger.error({ ...ctx, error }, 'SFX generation failed (core)');

    await updateAudioAssetCore({
      supabase: input.supabase,
      assetId: asset.id,
      status: 'failed',
      metadata: {
        error: error instanceof Error ? error.message : 'Unknown error',
      },
    });

    return {
      assetId: asset.id,
      prompt: input.prompt,
      status: 'failed',
      error: error instanceof Error ? error.message : 'Unknown error',
      wasReused: false,
    };
  }
}
