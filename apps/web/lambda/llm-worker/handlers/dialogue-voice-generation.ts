/**
 * Dialogue Voice Generation Handler
 *
 * Processes TTS voice generation jobs for dialogue lines.
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

const DialogueVoiceGenerationPayloadSchema = z.object({
  dialogueLineId: z.string().uuid(),
  projectId: z.string().uuid(),
  episodeId: z.string().uuid(),
  accountId: z.string().uuid(),
  text: z.string().min(1),
  voiceId: z.string(),
  ttsModel: z.string(),
  voiceSettings: z.object({
    stability: z.number().min(0).max(1).default(0.5),
    similarityBoost: z.number().min(0).max(1).default(0.75),
    style: z.number().min(0).max(1).optional(),
    speed: z.number().min(0.25).max(4).optional(),
  }),
  overwriteExisting: z.boolean().default(false),
  characterAssetId: z.string().uuid().optional(),
  batchJobId: z.string().uuid().optional(),
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
// API Key Fetching
// =============================================================================

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

// =============================================================================
// Handler
// =============================================================================

interface DialogueVoiceResult {
  success: boolean;
  dialogueLineId: string;
  audioUrl?: string;
  duration?: number;
  error?: string;
}

export async function processDialogueVoiceGeneration(
  payload: Record<string, unknown>,
  supabase: SupabaseClient,
): Promise<DialogueVoiceResult> {
  const data = DialogueVoiceGenerationPayloadSchema.parse(payload);

  console.log(
    `[Dialogue Voice Gen] Processing dialogue line ${data.dialogueLineId}`,
  );
  await markJobProcessing(
    supabase,
    data.dialogueLineId,
    'dialogue_voice_generation',
  );

  try {
    // 1. Validate text is not empty (safety check - validation also done in action)
    const text = data.text?.trim();
    if (!text) {
      throw new Error('Dialogue text is empty or whitespace-only');
    }

    // 2. Get API key from external_api_keys
    const apiKey = await getAccountElevenLabsApiKey(supabase, data.accountId);

    // 3. Update dialogue line status to generating
    await supabase
      .from('dialogue_lines')
      .update({ status: 'generating' })
      .eq('id', data.dialogueLineId);

    // 3. Generate voice using ElevenLabs TTS API
    const response = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${data.voiceId}`,
      {
        method: 'POST',
        headers: {
          'xi-api-key': apiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          text: text, // Use validated, trimmed text
          model_id: data.ttsModel,
          voice_settings: {
            stability: data.voiceSettings.stability,
            similarity_boost: data.voiceSettings.similarityBoost,
            style: data.voiceSettings.style ?? 0,
            use_speaker_boost: true,
          },
        }),
      },
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `ElevenLabs TTS API error: ${response.status} - ${errorText}`,
      );
    }

    // 4. Get audio buffer
    const audioBuffer = Buffer.from(await response.arrayBuffer());

    // 5. Upload to R2 storage
    const audioPath = `dialogue/${data.episodeId}/${data.dialogueLineId}.mp3`;
    const { url: audioUrl } = await uploadToR2(
      'audio',
      audioPath,
      audioBuffer,
      'audio/mpeg',
    );

    // 6. Calculate duration estimate (rough: ~150 words per minute)
    const wordCount = data.text.split(/\s+/).length;
    const estimatedDuration = Math.max(1, Math.ceil((wordCount / 150) * 60));

    // 7. Prepare metadata
    const metadata = {
      provider: 'elevenlabs',
      voiceId: data.voiceId,
      settings: data.voiceSettings,
      costCents: Math.ceil(data.text.length * 0.03), // ~$0.30 per 1k chars
      durationSeconds: estimatedDuration,
      generatedAt: new Date().toISOString(),
      characterCount: data.text.length,
    };

    // 8. Update dialogue line with audio URL and completed status
    await supabase
      .from('dialogue_lines')
      .update({
        audio_url: audioUrl,
        status: 'completed',
        generation_metadata: metadata,
      })
      .eq('id', data.dialogueLineId);

    await markJobCompleted(
      supabase,
      data.dialogueLineId,
      'dialogue_voice_generation',
      {
        audioUrl,
        duration: estimatedDuration,
      },
    );

    if (data.batchJobId) {
      const { data: job } = await supabase
        .from('batch_generation_jobs')
        .select('completed_lines, actual_cost, total_lines, failed_lines')
        .eq('id', data.batchJobId)
        .single();

      if (job) {
        const newCompleted = (job.completed_lines || 0) + 1;
        const newCost = (job.actual_cost || 0) + metadata.costCents;
        const isFinished =
          newCompleted + (job.failed_lines || 0) >= job.total_lines;

        await supabase
          .from('batch_generation_jobs')
          .update({
            completed_lines: newCompleted,
            actual_cost: newCost,
            status: isFinished ? 'completed' : 'processing',
            completed_at: isFinished ? new Date().toISOString() : undefined,
          })
          .eq('id', data.batchJobId);
      }
    }

    console.log(
      `[Dialogue Voice Gen] Completed dialogue line ${data.dialogueLineId}, audio: ${audioUrl}`,
    );

    return {
      success: true,
      dialogueLineId: data.dialogueLineId,
      audioUrl,
      duration: estimatedDuration,
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';

    // Update dialogue line status to failed
    await supabase
      .from('dialogue_lines')
      .update({
        status: 'failed',
        generation_metadata: {
          error: errorMsg,
          failedAt: new Date().toISOString(),
        },
      })
      .eq('id', data.dialogueLineId);

    await markJobFailed(
      supabase,
      data.dialogueLineId,
      'dialogue_voice_generation',
      errorMsg,
    );

    console.error(
      `[Dialogue Voice Gen] Failed dialogue line ${data.dialogueLineId}:`,
      error,
    );

    if (data.batchJobId) {
      const { data: job } = await supabase
        .from('batch_generation_jobs')
        .select('failed_lines, completed_lines, total_lines')
        .eq('id', data.batchJobId)
        .single();

      if (job) {
        const newFailed = (job.failed_lines || 0) + 1;
        const isFinished =
          newFailed + (job.completed_lines || 0) >= job.total_lines;

        await supabase
          .from('batch_generation_jobs')
          .update({
            failed_lines: newFailed,
            status: isFinished ? 'failed' : 'processing',
            completed_at: isFinished ? new Date().toISOString() : undefined,
          })
          .eq('id', data.batchJobId);
      }
    }

    throw error;
  }
}
