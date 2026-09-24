/**
 * Dialogue Voice Generation Handler
 *
 * Processes TTS voice generation jobs for dialogue lines.
 * Called from Voice Worker Lambda via SQS queue.
 *
 * Reuses job-tracking and r2-storage utilities from the LLM worker.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

import { z } from 'zod';

import { vendorUrl } from '@kit/shared/vendors';
import type { Database } from '@kit/supabase/database';

import { uploadToR2 } from '../llm-worker/utils/r2-storage';

const DialogueVoiceGenerationPayloadSchema = z.object({
  dialogueLineId: z.string().uuid(),
  projectId: z.string().uuid().optional(),
  episodeId: z.string().uuid(),
  accountId: z.string().uuid(),
  text: z.string(),
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
  supabase: SupabaseClient<Database>,
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
// Stage Direction Handling
// =============================================================================

// Generic filler for stage-direction-only lines (e.g. [deep breath], [suspicious])
// ElevenLabs strips brackets/parens, leaving empty text → 400 error.
// A short filler generates a brief audio clip in the character's voice.
const STAGE_DIRECTION_FILLER = 'Hmm.';

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
  payload: unknown,
  supabase: SupabaseClient<Database>,
): Promise<DialogueVoiceResult> {
  const data = DialogueVoiceGenerationPayloadSchema.parse(payload);

  console.log(
    `[Dialogue Voice Gen] Processing dialogue line ${data.dialogueLineId}`,
  );

  try {
    // 1. Check if text has speakable content after stripping stage directions
    // Stage directions like [deep breath], [suspicious], (pause) etc. get stripped
    // by ElevenLabs, resulting in a 400 error for empty text
    const textWithoutDirections = data.text
      ?.replace(/\[.*?\]/g, '') // Remove [bracketed text]
      .replace(/\(.*?\)/g, '') // Remove (parenthesized text)
      .replace(/\*.*?\*/g, '') // Remove *asterisk text*
      .trim();

    let text: string;

    if (!textWithoutDirections) {
      // Pure stage direction — use a short generic filler so ElevenLabs
      // generates a brief audio clip in the character's voice
      text = STAGE_DIRECTION_FILLER;

      console.log(
        `[Dialogue Voice Gen] Stage direction only: "${data.text}" → filler: "${text}"`,
      );
    } else {
      text = data.text.trim();
    }

    // 2. Get API key from external_api_keys
    const apiKey = await getAccountElevenLabsApiKey(supabase, data.accountId);

    // 3. Update dialogue line status to generating
    await supabase
      .from('dialogue_lines')
      .update({ status: 'generating' })
      .eq('id', data.dialogueLineId);

    // 4. Generate voice using ElevenLabs TTS API
    const response = await fetch(
      `${vendorUrl('elevenlabs')}/v1/text-to-speech/${data.voiceId}`,
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

    // 5. Get audio buffer
    const audioBuffer = Buffer.from(await response.arrayBuffer());

    // 6. Upload to R2 storage (timestamp ensures regeneration bypasses CDN cache)
    const timestamp = Date.now();
    const audioPath = `dialogue/${data.episodeId}/${data.dialogueLineId}_${timestamp}.mp3`;
    const { url: audioUrl } = await uploadToR2(
      'audio',
      audioPath,
      audioBuffer,
      'audio/mpeg',
    );

    // 7. Calculate duration estimate (rough: ~150 words per minute)
    const wordCount = data.text.split(/\s+/).length;
    const estimatedDuration = Math.max(1, Math.ceil((wordCount / 150) * 60));

    // 8. Prepare metadata
    const costCents = Math.ceil(data.text.length * 0.03); // ~$0.30 per 1k chars
    const metadata = {
      provider: 'elevenlabs',
      voiceId: data.voiceId,
      settings: data.voiceSettings,
      costCents,
      durationSeconds: estimatedDuration,
      generatedAt: new Date().toISOString(),
      characterCount: data.text.length,
    };

    // 9. Update dialogue line with audio URL and completed status
    await supabase
      .from('dialogue_lines')
      .update({
        audio_url: audioUrl,
        status: 'completed',
        generation_metadata: metadata,
      })
      .eq('id', data.dialogueLineId);

    // 10. Count the spend against the account's monthly usage (KB-83). The
    // payload's account was authorised when the job was queued (KB-46/47).
    // A failed count is logged; the line is already generated and paid for.
    const { error: usageError } = await supabase.rpc(
      'increment_account_usage',
      { p_account_id: data.accountId, p_amount_cents: costCents },
    );

    if (usageError) {
      console.error(
        `[Dialogue Voice Gen] Failed to record spend for ${data.dialogueLineId}:`,
        usageError.message,
      );
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

    console.error(
      `[Dialogue Voice Gen] Failed dialogue line ${data.dialogueLineId}:`,
      error,
    );

    throw error;
  }
}
