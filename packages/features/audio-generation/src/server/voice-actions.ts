'use server';

import 'server-only';

import { revalidatePath } from 'next/cache';

import { v4 as uuidv4 } from 'uuid';

import { enhanceAction } from '@kit/next/actions';
import { getLogger } from '@kit/shared/logger';
import { requireUser } from '@kit/supabase/require-user';
import { getSupabaseServerAdminClient } from '@kit/supabase/server-admin-client';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

import type {
  GenerateDialogueVoiceResult,
  GenerateDialogueVoiceSchemaType,
  GenerateVoiceFromTextResult,
  GenerateVoiceFromTextSchemaType,
  VoiceGenerationMetadata,
} from '../lib/schemas/voice-action.schema';
import {
  GenerateDialogueVoiceSchema,
  GenerateVoiceFromTextSchema,
} from '../lib/schemas/voice-action.schema';
import { ElevenLabsProvider } from '../providers/elevenlabs';
import {
  estimateVoiceCost,
  getVoiceIdForCharacter,
  getVoiceSettings,
} from './voice-queries';

/**
 * Generate voice audio for a dialogue line
 *
 * This action:
 * 1. Validates the dialogue line exists and user has access
 * 2. Gets voice ID from params or character's voice profile
 * 3. Generates audio using ElevenLabs
 * 4. Uploads to Supabase Storage
 * 5. Updates the dialogue_lines record with audio URL and metadata
 * 6. Creates a generation_jobs record for cost tracking
 */
export const generateDialogueVoiceAction = enhanceAction(
  async (
    data: GenerateDialogueVoiceSchemaType,
  ): Promise<GenerateDialogueVoiceResult> => {
    const logger = await getLogger();
    const ctx = {
      name: 'voice.generateDialogue',
      dialogueLineId: data.dialogueLineId,
      provider: data.provider ?? 'elevenlabs',
    };

    logger.info(ctx, 'Starting dialogue voice generation');

    const client = getSupabaseServerClient();
    const adminClient = getSupabaseServerAdminClient();
    const { data: user, error: authError } = await requireUser(client);

    if (authError || !user) {
      logger.warn(ctx, 'Unauthorized voice generation attempt');
      throw new Error('Authentication required');
    }

    // 1. Fetch dialogue line with episode and account context
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: dialogueLine, error: fetchError } = await (client as any)
      .from('dialogue_lines')
      .select(
        `
        id,
        episode_id,
        text,
        character_asset_id,
        audio_url,
        status,
        episodes!inner(
          id,
          project_id,
          projects!inner(
            id,
            account_id
          )
        )
      `,
      )
      .eq('id', data.dialogueLineId)
      .single();

    if (fetchError || !dialogueLine) {
      logger.error({ ...ctx, error: fetchError }, 'Dialogue line not found');
      throw new Error('Dialogue line not found');
    }

    const accountId = dialogueLine.episodes?.projects?.account_id;
    const projectId = dialogueLine.episodes?.project_id;
    const episodeId = dialogueLine.episode_id;

    if (!accountId || !projectId) {
      logger.error(ctx, 'Could not determine account for dialogue line');
      throw new Error('Could not determine account for dialogue line');
    }

    // 2. Check if already generated (unless overwrite requested)
    const overwriteExisting = data.overwriteExisting ?? false;
    if (dialogueLine.audio_url && !overwriteExisting) {
      throw new Error(
        'Audio already generated. Set overwriteExisting=true to regenerate.',
      );
    }

    // 3. Get voice ID from params or character's voice profile
    const voiceId =
      data.voiceId ??
      (await getVoiceIdForCharacter(client, dialogueLine.character_asset_id));

    if (!voiceId) {
      throw new Error(
        'No voice ID provided and character has no voice profile configured',
      );
    }

    // 4. Get voice settings from profile or use defaults
    const voiceSettings =
      data.settings ??
      (await getVoiceSettings(client, dialogueLine.character_asset_id));

    // 5. Estimate cost
    const estimatedCost = estimateVoiceCost(dialogueLine.text.length);

    // 6. Get API key from environment
    const apiKey = process.env.ELEVENLABS_API_KEY;
    if (!apiKey) {
      logger.error(ctx, 'Missing ELEVENLABS_API_KEY');
      throw new Error(
        'Voice generation service not configured. Please configure ELEVENLABS_API_KEY.',
      );
    }

    // 7. Update status to 'generating'
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (client as any)
      .from('dialogue_lines')
      .update({ status: 'generating' })
      .eq('id', data.dialogueLineId);

    // Create generation job record
    const idempotencyKey = `voice-${data.dialogueLineId}-${uuidv4()}`;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: job, error: jobError } = await (client as any)
      .from('generation_jobs')
      .insert({
        account_id: accountId,
        project_id: projectId,
        job_type: 'voice',
        reference_type: 'dialogue_line',
        reference_id: data.dialogueLineId,
        provider: 'elevenlabs',
        status: 'processing',
        input_data: {
          text: dialogueLine.text,
          voiceId,
          settings: voiceSettings,
        },
        estimated_cost_cents: estimatedCost,
        idempotency_key: idempotencyKey,
        max_retries: 3,
        timeout_seconds: 60,
        started_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (jobError) {
      logger.error({ ...ctx, error: jobError }, 'Failed to create job record');
    }

    try {
      // 8. Create provider and generate audio
      const provider = new ElevenLabsProvider({
        apiKey,
        timeout: 60000,
        maxRetries: 3,
      });

      const result = await provider.generateVoice({
        text: dialogueLine.text,
        voiceId,
        settings: voiceSettings,
        outputFormat: 'mp3',
      });

      // 9. Upload to Supabase Storage
      const audioPath = `dialogue/${episodeId}/${data.dialogueLineId}.mp3`;

      const { error: uploadError } = await adminClient.storage
        .from('audio')
        .upload(audioPath, result.audioBuffer!, {
          contentType: 'audio/mpeg',
          upsert: overwriteExisting,
        });

      if (uploadError) {
        throw new Error(`Failed to upload audio: ${uploadError.message}`);
      }

      // 10. Get public URL
      const { data: urlData } = adminClient.storage
        .from('audio')
        .getPublicUrl(audioPath);

      // 11. Prepare metadata
      const metadata: VoiceGenerationMetadata = {
        provider: 'elevenlabs',
        voiceId,
        settings: {
          stability: voiceSettings.stability,
          similarityBoost: voiceSettings.similarityBoost,
          style: voiceSettings.style,
          speed: voiceSettings.speed,
        },
        costCents: result.cost ?? estimatedCost,
        durationSeconds: result.duration,
        generatedAt: new Date().toISOString(),
        characterCount: dialogueLine.text.length,
      };

      // 12. Update dialogue line with audio URL and metadata
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error: updateError } = await (client as any)
        .from('dialogue_lines')
        .update({
          audio_url: urlData.publicUrl,
          status: 'completed',
          generation_metadata: metadata,
        })
        .eq('id', data.dialogueLineId);

      if (updateError) {
        throw updateError;
      }

      // 13. Update generation job as completed
      if (job) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (client as any)
          .from('generation_jobs')
          .update({
            status: 'completed',
            cost_cents: result.cost ?? estimatedCost,
            output_data: {
              audioUrl: urlData.publicUrl,
              duration: result.duration,
            },
            completed_at: new Date().toISOString(),
          })
          .eq('id', job.id);
      }

      logger.info(
        { ...ctx, audioUrl: urlData.publicUrl, duration: result.duration },
        'Dialogue voice generation completed',
      );

      revalidatePath('/home/[account]/studio/[projectId]/episodes', 'page');

      return {
        dialogueLineId: data.dialogueLineId,
        audioUrl: urlData.publicUrl,
        duration: result.duration,
        cost: result.cost ?? estimatedCost,
        status: 'completed',
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';

      // Update dialogue line status to failed
      const failedMetadata: VoiceGenerationMetadata = {
        provider: 'elevenlabs',
        voiceId,
        settings: {
          stability: voiceSettings.stability,
          similarityBoost: voiceSettings.similarityBoost,
          style: voiceSettings.style,
          speed: voiceSettings.speed,
        },
        costCents: 0,
        durationSeconds: 0,
        generatedAt: new Date().toISOString(),
        characterCount: dialogueLine.text.length,
        error: errorMessage,
      };

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (client as any)
        .from('dialogue_lines')
        .update({
          status: 'failed',
          generation_metadata: failedMetadata,
        })
        .eq('id', data.dialogueLineId);

      // Update generation job as failed
      if (job) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (client as any)
          .from('generation_jobs')
          .update({
            status: 'failed',
            error_message: errorMessage,
            error_code: 'GENERATION_FAILED',
            completed_at: new Date().toISOString(),
          })
          .eq('id', job.id);
      }

      logger.error({ ...ctx, error }, 'Dialogue voice generation failed');

      return {
        dialogueLineId: data.dialogueLineId,
        audioUrl: '',
        duration: 0,
        cost: 0,
        status: 'failed',
        error: errorMessage,
      };
    }
  },
  {
    schema: GenerateDialogueVoiceSchema,
  },
);

/**
 * Generate voice audio from raw text (for previews)
 *
 * This action generates voice audio from provided text without
 * linking to a dialogue line. Useful for voice previews and testing.
 * Audio is stored in a temporary location.
 */
export const generateVoiceFromTextAction = enhanceAction(
  async (
    data: GenerateVoiceFromTextSchemaType,
  ): Promise<GenerateVoiceFromTextResult> => {
    const logger = await getLogger();
    const ctx = {
      name: 'voice.generateFromText',
      episodeId: data.episodeId,
      provider: data.provider ?? 'elevenlabs',
    };

    logger.info(ctx, 'Starting text-to-voice generation');

    const client = getSupabaseServerClient();
    const adminClient = getSupabaseServerAdminClient();
    const { data: user, error: authError } = await requireUser(client);

    if (authError || !user) {
      logger.warn(ctx, 'Unauthorized voice generation attempt');
      throw new Error('Authentication required');
    }

    // 1. Fetch episode to get account context
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: episode, error: episodeError } = await (client as any)
      .from('episodes')
      .select('id, project_id, projects!inner(account_id)')
      .eq('id', data.episodeId)
      .single();

    if (episodeError || !episode) {
      logger.error({ ...ctx, error: episodeError }, 'Episode not found');
      throw new Error('Episode not found');
    }

    const accountId = episode.projects?.account_id;
    const projectId = episode.project_id;

    if (!accountId) {
      logger.error(ctx, 'Could not determine account for episode');
      throw new Error('Could not determine account for episode');
    }

    // 2. Get API key
    const apiKey = process.env.ELEVENLABS_API_KEY;
    if (!apiKey) {
      logger.error(ctx, 'Missing ELEVENLABS_API_KEY');
      throw new Error(
        'Voice generation service not configured. Please configure ELEVENLABS_API_KEY.',
      );
    }

    // 3. Estimate cost
    const estimatedCost = estimateVoiceCost(data.text.length);

    // 4. Create generation job record for tracking
    const idempotencyKey = `voice-text-${user.id}-${Date.now()}`;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: job } = await (client as any)
      .from('generation_jobs')
      .insert({
        account_id: accountId,
        project_id: projectId,
        job_type: 'voice',
        reference_type: 'preview',
        reference_id: null,
        provider: 'elevenlabs',
        status: 'processing',
        input_data: {
          text: data.text,
          voiceId: data.voiceId,
          settings: data.settings,
        },
        estimated_cost_cents: estimatedCost,
        idempotency_key: idempotencyKey,
        max_retries: 3,
        timeout_seconds: 60,
        started_at: new Date().toISOString(),
      })
      .select()
      .single();

    try {
      // 5. Create provider and generate audio
      const provider = new ElevenLabsProvider({
        apiKey,
        timeout: 60000,
        maxRetries: 3,
      });

      const result = await provider.generateVoice({
        text: data.text,
        voiceId: data.voiceId,
        settings: data.settings,
        outputFormat: 'mp3',
      });

      // 6. Upload to temporary storage location
      const tempPath = `temp/${user.id}/${Date.now()}.mp3`;

      const { error: uploadError } = await adminClient.storage
        .from('audio')
        .upload(tempPath, result.audioBuffer!, {
          contentType: 'audio/mpeg',
        });

      if (uploadError) {
        throw new Error(`Failed to upload audio: ${uploadError.message}`);
      }

      // 7. Get public URL
      const { data: urlData } = adminClient.storage
        .from('audio')
        .getPublicUrl(tempPath);

      // 8. Update generation job as completed
      if (job) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (client as any)
          .from('generation_jobs')
          .update({
            status: 'completed',
            cost_cents: result.cost ?? estimatedCost,
            output_data: {
              audioUrl: urlData.publicUrl,
              duration: result.duration,
            },
            completed_at: new Date().toISOString(),
          })
          .eq('id', job.id);
      }

      logger.info(
        { ...ctx, audioUrl: urlData.publicUrl, duration: result.duration },
        'Text-to-voice generation completed',
      );

      return {
        audioUrl: urlData.publicUrl,
        duration: result.duration,
        cost: result.cost ?? estimatedCost,
        format: result.format,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';

      // Update generation job as failed
      if (job) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (client as any)
          .from('generation_jobs')
          .update({
            status: 'failed',
            error_message: errorMessage,
            error_code: 'GENERATION_FAILED',
            completed_at: new Date().toISOString(),
          })
          .eq('id', job.id);
      }

      logger.error({ ...ctx, error }, 'Text-to-voice generation failed');
      throw error;
    }
  },
  {
    schema: GenerateVoiceFromTextSchema,
  },
);
