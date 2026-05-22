/**
 * Audio File Generation Handler
 *
 * Processes audio generation jobs for cues (music, SFX, ambient).
 * Called from LLM Worker Lambda via SQS queue.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

import { z } from 'zod';

import {
  markJobCompleted,
  markJobFailed,
  markJobProcessing,
} from '../utils/job-tracking';
import { uploadToR2 } from '../utils/r2-storage';

const AudioFileGenerationPayloadSchema = z.object({
  cueId: z.string().uuid(),
  projectId: z.string().uuid(),
  episodeId: z.string().uuid(),
  cueType: z.enum(['sfx', 'ambient', 'music']),
  prompt: z.string(),
  durationSeconds: z.number(),
  startOffsetSeconds: z.number(),
});

// =============================================================================
// Inline Decryption (Lambda-safe, no server-only import)
// =============================================================================

const ALGORITHM = 'AES-GCM';
const KEY_LENGTH = 256;
const IV_LENGTH = 12;
const TAG_LENGTH = 128;

async function getEncryptionKey(): Promise<CryptoKey> {
  const keyBase64 = process.env.ENCRYPTION_KEY;

  if (!keyBase64) {
    throw new Error('ENCRYPTION_KEY environment variable is required.');
  }

  const keyBuffer = Buffer.from(keyBase64, 'base64');

  if (keyBuffer.length !== 32) {
    throw new Error(
      'ENCRYPTION_KEY must be exactly 32 bytes (256 bits) when decoded',
    );
  }

  return crypto.subtle.importKey(
    'raw',
    keyBuffer,
    { name: ALGORITHM, length: KEY_LENGTH },
    false,
    ['encrypt', 'decrypt'],
  );
}

async function decrypt(encryptedBase64: string): Promise<string> {
  const key = await getEncryptionKey();
  const combined = Buffer.from(encryptedBase64, 'base64');

  if (combined.length < IV_LENGTH + TAG_LENGTH / 8) {
    throw new Error('Invalid encrypted data: too short');
  }

  const iv = combined.subarray(0, IV_LENGTH);
  const ciphertext = combined.subarray(IV_LENGTH);

  const decrypted = await crypto.subtle.decrypt(
    {
      name: ALGORITHM,
      iv,
      tagLength: TAG_LENGTH,
    },
    key,
    ciphertext,
  );

  const decoder = new TextDecoder();
  return decoder.decode(decrypted);
}

// =============================================================================
// API Key Fetching (using correct source: external_api_keys table)
// =============================================================================

/**
 * Get the account ID for a given project
 */
async function getProjectAccountId(
  supabase: SupabaseClient,
  projectId: string,
): Promise<string> {
  const { data, error } = await supabase
    .from('projects')
    .select('account_id')
    .eq('id', projectId)
    .single();

  if (error || !data?.account_id) {
    throw new Error(`Could not find project ${projectId}`);
  }

  return data.account_id;
}

/**
 * Get ElevenLabs API key for an account from external_api_keys table
 */
async function getAccountElevenLabsApiKey(
  supabase: SupabaseClient,
  accountId: string,
): Promise<string> {
  const { data: storedKey, error } = await supabase
    .from('external_api_keys')
    .select('encrypted_key, is_active')
    .eq('account_id', accountId)
    .eq('provider', 'elevenlabs')
    .eq('is_active', true)
    .single();

  if (error || !storedKey?.encrypted_key) {
    throw new Error(
      'ElevenLabs API key not configured. Please add your API key in Settings → API Keys.',
    );
  }

  return decrypt(storedKey.encrypted_key);
}

/**
 * Get ElevenLabs API key for a project (looks up accountId first)
 */
async function getProjectElevenLabsApiKey(
  supabase: SupabaseClient,
  projectId: string,
): Promise<string> {
  const accountId = await getProjectAccountId(supabase, projectId);
  return getAccountElevenLabsApiKey(supabase, accountId);
}

// =============================================================================
// Handler
// =============================================================================

export async function processAudioFileGeneration(
  payload: Record<string, unknown>,
  supabase: SupabaseClient,
): Promise<{ success: boolean; assetId?: string; cueId: string }> {
  const data = AudioFileGenerationPayloadSchema.parse(payload);

  console.log(
    `[Audio File Gen] Processing cue ${data.cueId} (${data.cueType})`,
  );
  await markJobProcessing(supabase, data.cueId, 'audio_file_generation');

  try {
    // Fetch API key from external_api_keys via project → account lookup
    const apiKey = await getProjectElevenLabsApiKey(supabase, data.projectId);

    let result: {
      assetId: string;
      status: string;
      fileUrl?: string;
      error?: string;
    };

    if (data.cueType === 'music') {
      // Import and call ElevenLabs music generation
      const { generateMusicElevenLabsCore } = await import(
        '@kit/audio-generation/server-core'
      );

      const coreResult = await generateMusicElevenLabsCore({
        supabase,
        projectId: data.projectId,
        episodeId: data.episodeId,
        prompt: data.prompt,
        durationSeconds: Math.min(data.durationSeconds, 300),
        timelineStartSeconds: data.startOffsetSeconds,
        apiKey,
        uploadFn: uploadToR2,
      });

      result = {
        assetId: coreResult.assetId,
        status: coreResult.status,
        fileUrl: coreResult.fileUrl,
        error: coreResult.error,
      };
    } else {
      // SFX/Ambient generation
      const { generateSfxCore } = await import(
        '@kit/audio-generation/server-core'
      );

      const coreResult = await generateSfxCore({
        supabase,
        projectId: data.projectId,
        episodeId: data.episodeId,
        prompt: data.prompt,
        durationSeconds: Math.min(data.durationSeconds, 22),
        timelineStartSeconds: data.startOffsetSeconds,
        apiKey,
        uploadFn: uploadToR2,
      });

      result = {
        assetId: coreResult.assetId,
        status: coreResult.status,
        fileUrl: coreResult.fileUrl,
        error: coreResult.error,
      };
    }

    if (result.status === 'completed' || result.status === 'reused') {
      // Update cue with asset reference
      await supabase
        .from('audio_cues')
        .update({ audio_asset_id: result.assetId, status: 'placed' })
        .eq('id', data.cueId);

      await markJobCompleted(supabase, data.cueId, 'audio_file_generation', {
        assetId: result.assetId,
        fileUrl: result.fileUrl,
      });

      console.log(
        `[Audio File Gen] Cue ${data.cueId} completed with asset ${result.assetId}`,
      );

      return { success: true, assetId: result.assetId, cueId: data.cueId };
    } else {
      await supabase
        .from('audio_cues')
        .update({ status: 'failed' })
        .eq('id', data.cueId);

      await markJobFailed(
        supabase,
        data.cueId,
        'audio_file_generation',
        result.error ?? 'Generation failed',
      );

      console.error(
        `[Audio File Gen] Cue ${data.cueId} failed: ${result.error}`,
      );

      return { success: false, cueId: data.cueId };
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';

    await supabase
      .from('audio_cues')
      .update({ status: 'failed' })
      .eq('id', data.cueId);

    await markJobFailed(
      supabase,
      data.cueId,
      'audio_file_generation',
      errorMsg,
    );

    console.error(`[Audio File Gen] Cue ${data.cueId} error:`, error);

    throw error;
  }
}
