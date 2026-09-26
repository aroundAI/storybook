'use server';

import 'server-only';

import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';

import { ActionRefusal } from '@kit/next/action-result';
import { enhanceAction } from '@kit/next/actions';
import { requireAffectedRows, returnRefusals } from '@kit/next/refusals';
import { authorizeEpisodeTarget } from '@kit/prompt-engine/llm-job-target';
import { getLogger } from '@kit/shared/logger';
import { getStorageAdapter, writeProjectObject } from '@kit/storage';
import { dialogueAudioPath, voicePreviewPath } from '@kit/storage/upload-paths';
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
import { estimateVoiceCost } from '../lib/voice-utils';
import { ElevenLabsProvider } from '../providers/elevenlabs';
import {
  getAccountElevenLabsApiKey,
  getProjectTTSModel,
} from './project-audio-settings';
import { getVoiceIdForCharacter, getVoiceSettings } from './voice-queries';

// Note: These actions use type assertions because the film studio tables
// (dialogue_lines, episodes, generation_jobs) are not yet in the generated
// database types. The database schema will be aligned in a future update.
// RLS policies enforce project-level authorization.
// See: packages/features/audio-generation/src/server/actions.ts for similar pattern.

/**
 * Film studio database response types for type-safe access to nested data
 */
interface DialogueLineResponse {
  id: string;
  episode_id: string;
  text: string;
  character_asset_id: string | null;
  audio_url: string | null;
  status: string;
  episodes: {
    id: string;
    project_id: string;
    projects: {
      id: string;
      account_id: string;
    };
  };
}

interface GenerationJobResponse {
  id: string;
  account_id: string;
  project_id: string;
  status: string;
}

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
const generateDialogueVoice = enhanceAction(
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
      throw new ActionRefusal('Dialogue line not found');
    }

    // Type-safe access to nested response data
    const dialogueData = dialogueLine as DialogueLineResponse;
    const episodeId = dialogueData.episode_id;

    // Reading the line is not writing it: a project viewer can read it (KB-46)
    const target = await authorizeEpisodeTarget(client, episodeId);

    if (!target?.projectId) {
      logger.warn(
        { ...ctx, userId: user.id, reason: 'not_writable' },
        'Voice generation refused',
      );
      throw new ActionRefusal('Dialogue line not found');
    }

    const { accountId, projectId } = target;

    // 2. Check if already generated (unless overwrite requested)
    const overwriteExisting = data.overwriteExisting ?? false;
    if (dialogueData.audio_url && !overwriteExisting) {
      throw new ActionRefusal('This line already has audio.');
    }

    // 3. Get voice ID from params or character's voice profile
    const voiceId =
      data.voiceId ??
      (await getVoiceIdForCharacter(client, dialogueData.character_asset_id));

    if (!voiceId) {
      throw new ActionRefusal(
        'This character has no voice yet. Assign a voice first.',
      );
    }

    // 4. Get voice settings from profile or use defaults
    const voiceSettings =
      data.settings ??
      (await getVoiceSettings(client, dialogueData.character_asset_id));

    // 5. Estimate cost
    const estimatedCost = estimateVoiceCost(dialogueData.text.length);

    // 8. Get API key from stored external_api_keys
    const apiKey = await getAccountElevenLabsApiKey(accountId);

    // 9. Update status to 'generating'
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: generating, error: statusError } = await (client as any)
      .from('dialogue_lines')
      .update({ status: 'generating' })
      .eq('id', data.dialogueLineId)
      .select('id');

    if (statusError) {
      logger.error(
        { ...ctx, error: statusError },
        'Failed to update dialogue status',
      );
      throw new Error('Failed to update dialogue status');
    }

    requireAffectedRows(
      generating,
      "You can't generate audio for this dialogue line.",
    );

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
          text: dialogueData.text,
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

    // If job creation fails, revert status and throw
    if (jobError) {
      logger.error({ ...ctx, error: jobError }, 'Failed to create job record');

      // Revert status to pending since job creation failed
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (client as any)
        .from('dialogue_lines')
        .update({ status: 'pending' })
        .eq('id', data.dialogueLineId);

      throw new Error('Failed to create generation job record');
    }

    const jobData = job as GenerationJobResponse;

    try {
      // 10. Create provider and generate audio - use project TTS model
      const ttsModel = await getProjectTTSModel(projectId);

      logger.info(
        {
          ...ctx,
          voiceId,
          textLength: dialogueData.text.length,
          modelId: ttsModel,
          characterAssetId: dialogueData.character_asset_id,
        },
        'Generating voice with resolved settings',
      );

      const provider = new ElevenLabsProvider({
        apiKey,
        timeout: 60000,
        maxRetries: 3,
      });

      const result = await provider.generateVoice({
        text: dialogueData.text,
        voiceId,
        settings: voiceSettings,
        modelId: ttsModel,
        outputFormat: 'mp3',
      });

      // 11. Validate audioBuffer exists before upload
      if (!result.audioBuffer) {
        throw new Error('Voice generation did not return audio data');
      }

      // 12. Upload to storage, under the episode the line was authorised on
      const audioPath = dialogueAudioPath(episodeId, data.dialogueLineId);
      const storage = getStorageAdapter(adminClient);

      const { url: audioUrl } = await writeProjectObject(
        client,
        storage,
        'audio',
        audioPath,
        result.audioBuffer,
        {
          contentType: 'audio/mpeg',
          upsert: overwriteExisting,
        },
      );

      // 14. Prepare metadata
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
        characterCount: dialogueData.text.length,
      };

      // 15. Update dialogue line with audio URL and metadata
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error: updateError } = await (client as any)
        .from('dialogue_lines')
        .update({
          audio_url: audioUrl,
          status: 'completed',
          generation_metadata: metadata,
        })
        .eq('id', data.dialogueLineId);

      if (updateError) {
        throw updateError;
      }

      // 16. Update generation job as completed
      const actualCost = result.cost ?? estimatedCost;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (client as any)
        .from('generation_jobs')
        .update({
          status: 'completed',
          cost_cents: actualCost,
          output_data: {
            audioUrl: audioUrl,
            duration: result.duration,
          },
          completed_at: new Date().toISOString(),
        })
        .eq('id', jobData.id);

      logger.info(
        { ...ctx, audioUrl, duration: result.duration },
        'Dialogue voice generation completed',
      );

      return {
        dialogueLineId: data.dialogueLineId,
        audioUrl: audioUrl,
        duration: result.duration,
        cost: actualCost,
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
        characterCount: dialogueData.text.length,
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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (client as any)
        .from('generation_jobs')
        .update({
          status: 'failed',
          error_message: errorMessage,
          error_code: 'GENERATION_FAILED',
          completed_at: new Date().toISOString(),
        })
        .eq('id', jobData.id);

      logger.error({ ...ctx, error }, 'Dialogue voice generation failed');

      // Return failure result instead of throwing for consistent error handling
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

export const generateDialogueVoiceAction = returnRefusals(
  generateDialogueVoice,
);

/**
 * Generate voice audio for a dialogue line (ASYNC)
 *
 * Enqueues a job for background processing via LLM Worker Lambda.
 * Results are delivered via WebSocket when complete.
 *
 * This is the preferred method for production use as it avoids
 * API Gateway timeout issues with long TTS generation.
 */
const generateDialogueVoiceAsync = enhanceAction(
  async (
    data: GenerateDialogueVoiceSchemaType,
  ): Promise<{
    success: boolean;
    status: 'queued' | 'failed';
    error?: string;
  }> => {
    const logger = await getLogger();
    const ctx = {
      name: 'voice.generateDialogueAsync',
      dialogueLineId: data.dialogueLineId,
    };

    logger.info(ctx, 'Queueing dialogue voice generation');

    const client = getSupabaseServerClient();
    const { data: user, error: authError } = await requireUser(client);

    if (authError || !user) {
      return {
        success: false,
        status: 'failed',
        error: 'Authentication required',
      };
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
      return {
        success: false,
        status: 'failed',
        error: 'Dialogue line not found',
      };
    }

    const dialogueData = dialogueLine as DialogueLineResponse;
    const episodeId = dialogueData.episode_id;

    // The voice worker spends the target account's key and writes the line
    // with the service role, so a reader must not queue it (KB-46, KB-47)
    const target = await authorizeEpisodeTarget(client, episodeId);

    if (!target?.projectId) {
      logger.warn(
        { ...ctx, userId: user.id, reason: 'not_writable' },
        'Voice generation refused',
      );
      return {
        success: false,
        status: 'failed',
        error: 'Dialogue line not found',
      };
    }

    const projectId = target.projectId;

    // Validate text is not empty
    const dialogueText = dialogueData.text?.trim();
    if (!dialogueText) {
      return {
        success: false,
        status: 'failed',
        error: 'Dialogue text is empty',
      };
    }

    // 2. Get voice ID from params or character's voice profile
    const voiceId =
      data.voiceId ??
      (await getVoiceIdForCharacter(client, dialogueData.character_asset_id));

    if (!voiceId) {
      return {
        success: false,
        status: 'failed',
        error:
          'No voice ID provided and character has no voice profile configured',
      };
    }

    // 3. Get voice settings from profile or use defaults
    const voiceSettings =
      data.settings ??
      (await getVoiceSettings(client, dialogueData.character_asset_id));

    // 4. Get TTS model for project
    const ttsModel = await getProjectTTSModel(projectId);

    try {
      // 5. Update status to 'generating' (queued for background)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: generating, error: generatingError } = await (client as any)
        .from('dialogue_lines')
        .update({ status: 'generating' })
        .eq('id', data.dialogueLineId)
        .select('id');

      if (generatingError) {
        throw new Error(
          `Failed to update dialogue_lines: ${generatingError.message}`,
        );
      }

      requireAffectedRows(
        generating,
        "You can't generate audio for this dialogue line.",
      );

      // 6. Enqueue voice job for background processing via dedicated voice queue
      const { queueVoiceJob } = await import(
        '@kit/audio-generation/server/voice-queue-helper'
      );

      await queueVoiceJob(target, {
        dialogueLineId: data.dialogueLineId,
        batchJobId: null, // single-line generation, no batch tracking
        episodeId,
        voiceId,
        ttsModel,
        voiceSettings: {
          stability: voiceSettings.stability ?? 0.5,
          similarityBoost: voiceSettings.similarityBoost ?? 0.75,
          style: voiceSettings.style,
          speed: voiceSettings.speed,
        },
        text: dialogueText,
        characterAssetId: dialogueData.character_asset_id ?? undefined,
        userId: user.id,
        overwriteExisting: data.overwriteExisting ?? false,
      });

      logger.info(ctx, 'Dialogue voice generation job queued successfully');

      return { success: true, status: 'queued' };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      logger.error(
        { ...ctx, error },
        'Failed to queue dialogue voice generation',
      );

      // Revert status to pending
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (client as any)
        .from('dialogue_lines')
        .update({ status: 'pending' })
        .eq('id', data.dialogueLineId);

      return { success: false, status: 'failed', error: errorMsg };
    }
  },
  {
    schema: GenerateDialogueVoiceSchema,
  },
);

export const generateDialogueVoiceAsyncAction = returnRefusals(
  generateDialogueVoiceAsync,
);

/**
 * Generate voice audio from raw text (for previews)
 *
 * This action generates voice audio from provided text without
 * linking to a dialogue line. Useful for voice previews and testing.
 * Audio is stored in a temporary location.
 *
 * Note: Unlike generateDialogueVoiceAction, this action throws on error
 * since there's no persistent state to track failure. Callers should
 * handle errors appropriately.
 */
const generateVoiceFromText = enhanceAction(
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

    // 1. The episode, as one the caller can write to. A public or unlisted
    // episode is readable by every signed-in user; reading it must not spend
    // its owner's key (KB-46)
    const target = await authorizeEpisodeTarget(client, data.episodeId);

    if (!target?.projectId) {
      logger.warn(
        { ...ctx, userId: user.id, reason: 'not_writable' },
        'Voice preview refused',
      );
      throw new ActionRefusal('Episode not found');
    }

    const { accountId, projectId } = target;

    // 2. Get API key from stored external_api_keys
    const apiKey = await getAccountElevenLabsApiKey(accountId);

    // 3. Estimate cost
    const estimatedCost = estimateVoiceCost(data.text.length);

    // 5. Create generation job record for tracking
    const idempotencyKey = `voice-text-${user.id}-${Date.now()}`;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: job, error: jobError } = await (client as any)
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

    if (jobError) {
      logger.error({ ...ctx, error: jobError }, 'Failed to create job record');
      throw new Error('Failed to create generation job record');
    }

    const jobData = job as GenerationJobResponse;

    try {
      // 6. Create provider and generate audio - use project TTS model
      const ttsModel = await getProjectTTSModel(projectId);
      const provider = new ElevenLabsProvider({
        apiKey,
        timeout: 60000,
        maxRetries: 3,
      });

      const result = await provider.generateVoice({
        text: data.text,
        voiceId: data.voiceId,
        settings: data.settings,
        modelId: ttsModel,
        outputFormat: 'mp3',
      });

      // 7. Validate audioBuffer exists before upload
      if (!result.audioBuffer) {
        throw new Error('Voice generation did not return audio data');
      }

      // 8. Upload to temporary storage location (local or Supabase based on STORAGE_PROVIDER)
      const tempPath = voicePreviewPath(data.episodeId, user.id);
      const storage = getStorageAdapter(adminClient);

      const { url: audioUrl } = await writeProjectObject(
        client,
        storage,
        'audio',
        tempPath,
        result.audioBuffer,
        {
          contentType: 'audio/mpeg',
        },
      );

      // 10. Update generation job as completed
      const actualCost = result.cost ?? estimatedCost;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (client as any)
        .from('generation_jobs')
        .update({
          status: 'completed',
          cost_cents: actualCost,
          output_data: {
            audioUrl: audioUrl,
            duration: result.duration,
          },
          completed_at: new Date().toISOString(),
        })
        .eq('id', jobData.id);

      logger.info(
        { ...ctx, audioUrl, duration: result.duration },
        'Text-to-voice generation completed',
      );

      return {
        audioUrl: audioUrl,
        duration: result.duration,
        cost: actualCost,
        format: result.format,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';

      // Update generation job as failed
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (client as any)
        .from('generation_jobs')
        .update({
          status: 'failed',
          error_message: errorMessage,
          error_code: 'GENERATION_FAILED',
          completed_at: new Date().toISOString(),
        })
        .eq('id', jobData.id);

      logger.error({ ...ctx, error }, 'Text-to-voice generation failed');

      // Throw error for preview action - no persistent state to track
      throw error;
    }
  },
  {
    schema: GenerateVoiceFromTextSchema,
  },
);

export const generateVoiceFromTextAction = returnRefusals(
  generateVoiceFromText,
);

/**
 * Update the text of a dialogue line
 *
 * This action allows users to edit dialogue text (e.g., fix translations).
 * If the dialogue has existing audio, it will be marked as needing regeneration.
 */
const updateDialogueText = enhanceAction(
  async (data: {
    dialogueLineId: string;
    text: string;
  }): Promise<{ success: boolean; dialogueLineId: string }> => {
    const logger = await getLogger();
    const ctx = {
      name: 'dialogue.updateText',
      dialogueLineId: data.dialogueLineId,
    };

    logger.info(ctx, 'Updating dialogue text');

    const client = getSupabaseServerClient();
    const { data: user, error: authError } = await requireUser(client);

    if (authError || !user) {
      logger.warn(ctx, 'Unauthorized dialogue update attempt');
      throw new Error('Authentication required');
    }

    // Fetch dialogue line to verify access
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: dialogueLine, error: fetchError } = await (client as any)
      .from('dialogue_lines')
      .select(
        `
        id,
        episode_id,
        text,
        audio_url,
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
      throw new ActionRefusal('Dialogue line not found');
    }

    // Update the dialogue text
    // If there was existing audio, mark as needing regeneration
    const updatePayload: Record<string, unknown> = {
      text: data.text,
    };

    // If audio exists, reset status to 'pending' to indicate regeneration needed
    if (dialogueLine.audio_url) {
      updatePayload.status = 'pending';
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: updated, error: updateError } = await (client as any)
      .from('dialogue_lines')
      .update(updatePayload)
      .eq('id', data.dialogueLineId)
      .select('id');

    if (updateError) {
      logger.error({ ...ctx, error: updateError }, 'Failed to update dialogue');
      throw new Error('Failed to update dialogue text');
    }

    requireAffectedRows(updated, "You can't change this dialogue line.");

    logger.info(ctx, 'Dialogue text updated successfully');

    return {
      success: true,
      dialogueLineId: data.dialogueLineId,
    };
  },
  {
    schema: z.object({
      dialogueLineId: z.string().uuid(),
      text: z.string().min(1),
    }),
  },
);

export const updateDialogueTextAction = returnRefusals(updateDialogueText);
/**
 * Update the timing of a dialogue line (timeline position and duration)
 */
const updateDialogueTiming = enhanceAction(
  async (data: {
    dialogueLineId: string;
    timelineStartSeconds?: number;
    durationSeconds?: number;
  }): Promise<{ success: boolean; dialogueLineId: string }> => {
    const logger = await getLogger();
    const ctx = {
      name: 'dialogue.updateTiming',
      dialogueLineId: data.dialogueLineId,
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
    // Note: duration is usually determined by generation, but we might want to override or store estimated
    if (data.durationSeconds !== undefined) {
      updatePayload.estimated_duration_seconds = data.durationSeconds;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: updated, error: updateError } = await (client as any)
      .from('dialogue_lines')
      .update(updatePayload)
      .eq('id', data.dialogueLineId)
      .select('id');

    if (updateError) {
      logger.error(
        { ...ctx, error: updateError },
        'Failed to update dialogue timing',
      );
      throw new Error('Failed to update dialogue timing');
    }

    requireAffectedRows(updated, "You can't change this dialogue line.");

    return { success: true, dialogueLineId: data.dialogueLineId };
  },
  {
    schema: z.object({
      dialogueLineId: z.string().uuid(),
      timelineStartSeconds: z.number().min(0).optional(),
      durationSeconds: z.number().positive().optional(),
    }),
  },
);

export const updateDialogueTimingAction = returnRefusals(updateDialogueTiming);

/**
 * Clear all generated voices for an episode
 *
 * Resets all dialogue lines back to 'pending' status and clears audio URLs.
 * Does NOT delete the R2 storage files (orphan cleanup handled separately).
 */
export const clearAllVoicesAction = enhanceAction(
  async (data: {
    episodeId: string;
  }): Promise<{
    success: boolean;
    clearedCount: number;
    error?: string;
  }> => {
    const logger = await getLogger();
    const ctx = {
      name: 'dialogue.clearAllVoices',
      episodeId: data.episodeId,
    };

    logger.info(ctx, 'Clearing all generated voices for episode');

    const client = getSupabaseServerClient();
    const { data: user, error: authError } = await requireUser(client);

    if (authError || !user) {
      logger.warn(ctx, 'Unauthorized clear voices attempt');
      throw new Error('Authentication required');
    }

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: updated, error } = await (client as any)
        .from('dialogue_lines')
        .update({
          audio_url: null,
          status: 'pending',
          generation_metadata: null,
        })
        .eq('episode_id', data.episodeId)
        .not('audio_url', 'is', null)
        .select('id');

      if (error) {
        logger.error({ ...ctx, error }, 'Failed to clear voices');
        throw new Error(`Failed to clear voices: ${error.message}`);
      }

      const clearedCount = updated?.length ?? 0;

      logger.info(
        { ...ctx, clearedCount },
        'Cleared all generated voices for episode',
      );

      return { success: true, clearedCount };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      logger.error({ ...ctx, error: message }, 'Clear voices failed');
      return { success: false, clearedCount: 0, error: message };
    }
  },
  {
    schema: z.object({
      episodeId: z.string().uuid(),
    }),
  },
);
