'use server';

import 'server-only';

import { revalidatePath } from 'next/cache';

import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';

import { enhanceAction } from '@kit/next/actions';
import { getLogger } from '@kit/shared/logger';
import { getStorageAdapter } from '@kit/storage';
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
import {
  checkAccountBudget,
  getVoiceIdForCharacter,
  getVoiceSettings,
  incrementAccountUsage,
} from './voice-queries';

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

interface EpisodeResponse {
  id: string;
  project_id: string;
  projects: {
    account_id: string;
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

    // Type-safe access to nested response data
    const dialogueData = dialogueLine as DialogueLineResponse;
    const accountId = dialogueData.episodes?.projects?.account_id;
    const projectId = dialogueData.episodes?.project_id;
    const episodeId = dialogueData.episode_id;

    if (!accountId || !projectId) {
      logger.error(ctx, 'Could not determine account for dialogue line');
      throw new Error('Could not determine account for dialogue line');
    }

    // 2. Check if already generated (unless overwrite requested)
    const overwriteExisting = data.overwriteExisting ?? false;
    if (dialogueData.audio_url && !overwriteExisting) {
      throw new Error(
        'Audio already generated. Set overwriteExisting=true to regenerate.',
      );
    }

    // 3. Get voice ID from params or character's voice profile
    const voiceId =
      data.voiceId ??
      (await getVoiceIdForCharacter(client, dialogueData.character_asset_id));

    if (!voiceId) {
      throw new Error(
        'No voice ID provided and character has no voice profile configured',
      );
    }

    // 4. Get voice settings from profile or use defaults
    const voiceSettings =
      data.settings ??
      (await getVoiceSettings(client, dialogueData.character_asset_id));

    // 5. Estimate cost
    const estimatedCost = estimateVoiceCost(dialogueData.text.length);

    // 6. Check account budget
    const hasBudget = await checkAccountBudget(
      client,
      accountId,
      estimatedCost,
    );
    if (!hasBudget) {
      logger.warn({ ...ctx, estimatedCost, accountId }, 'Account over budget');
      throw new Error(
        'Monthly budget exceeded. Please upgrade your plan or wait until next month.',
      );
    }

    // 8. Get API key from stored external_api_keys
    const apiKey = await getAccountElevenLabsApiKey(accountId);

    // 9. Update status to 'generating'
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: statusError } = await (client as any)
      .from('dialogue_lines')
      .update({ status: 'generating' })
      .eq('id', data.dialogueLineId);

    if (statusError) {
      logger.error(
        { ...ctx, error: statusError },
        'Failed to update dialogue status',
      );
      throw new Error('Failed to update dialogue status');
    }

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

      // 12. Upload to storage (timestamp ensures regeneration bypasses CDN cache)
      const timestamp = Date.now();
      const audioPath = `dialogue/${episodeId}/${data.dialogueLineId}_${timestamp}.mp3`;
      const storage = getStorageAdapter(adminClient);

      const { url: audioUrl } = await storage.upload(
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

      // 17. Increment account usage for cost tracking
      await incrementAccountUsage(client, accountId, actualCost);

      logger.info(
        { ...ctx, audioUrl, duration: result.duration },
        'Dialogue voice generation completed',
      );

      revalidatePath('/home/[account]/studio/[projectId]/episodes', 'page');

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

/**
 * Generate voice audio for a dialogue line (ASYNC)
 *
 * Enqueues a job for background processing via LLM Worker Lambda.
 * Results are delivered via WebSocket when complete.
 *
 * This is the preferred method for production use as it avoids
 * API Gateway timeout issues with long TTS generation.
 */
export const generateDialogueVoiceAsyncAction = enhanceAction(
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
    const accountId = dialogueData.episodes?.projects?.account_id;
    const projectId = dialogueData.episodes?.project_id;
    const episodeId = dialogueData.episode_id;

    if (!accountId || !projectId) {
      return {
        success: false,
        status: 'failed',
        error: 'Could not determine account for dialogue line',
      };
    }

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
      await (client as any)
        .from('dialogue_lines')
        .update({ status: 'generating' })
        .eq('id', data.dialogueLineId);

      // 6. Enqueue LLM job for background processing
      const { queueLlmJob } = await import('@kit/prompt-engine/server');

      await queueLlmJob({
        jobType: 'dialogue-voice-generation',
        userId: user.id,
        payload: {
          dialogueLineId: data.dialogueLineId,
          projectId,
          episodeId,
          accountId,
          text: dialogueText,
          voiceId,
          ttsModel,
          voiceSettings: {
            stability: voiceSettings.stability,
            similarityBoost: voiceSettings.similarityBoost,
            style: voiceSettings.style,
            speed: voiceSettings.speed,
          },
          overwriteExisting: data.overwriteExisting ?? false,
          characterAssetId: dialogueData.character_asset_id,
        },
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

    // Type-safe access to nested response data
    const episodeData = episode as EpisodeResponse;
    const accountId = episodeData.projects?.account_id;
    const projectId = episodeData.project_id;

    if (!accountId) {
      logger.error(ctx, 'Could not determine account for episode');
      throw new Error('Could not determine account for episode');
    }

    // 2. Get API key from stored external_api_keys
    const apiKey = await getAccountElevenLabsApiKey(accountId);

    // 3. Estimate cost
    const estimatedCost = estimateVoiceCost(data.text.length);

    // 4. Check account budget
    const hasBudget = await checkAccountBudget(
      client,
      accountId,
      estimatedCost,
    );
    if (!hasBudget) {
      logger.warn({ ...ctx, estimatedCost, accountId }, 'Account over budget');
      throw new Error(
        'Monthly budget exceeded. Please upgrade your plan or wait until next month.',
      );
    }

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
      const tempPath = `temp/${user.id}/${Date.now()}.mp3`;
      const storage = getStorageAdapter(adminClient);

      const { url: audioUrl } = await storage.upload(
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

      // 11. Increment account usage for cost tracking
      await incrementAccountUsage(client, accountId, actualCost);

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

/**
 * Update the text of a dialogue line
 *
 * This action allows users to edit dialogue text (e.g., fix translations).
 * If the dialogue has existing audio, it will be marked as needing regeneration.
 */
export const updateDialogueTextAction = enhanceAction(
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
      throw new Error('Dialogue line not found');
    }

    // Update the dialogue text
    // If there was existing audio, mark as needing regeneration
    const updatePayload: Record<string, unknown> = {
      text: data.text,
    };

    // If audio exists, set status to 'text_modified' to indicate regeneration needed
    if (dialogueLine.audio_url) {
      updatePayload.status = 'text_modified';
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: updateError } = await (client as any)
      .from('dialogue_lines')
      .update(updatePayload)
      .eq('id', data.dialogueLineId);

    if (updateError) {
      logger.error({ ...ctx, error: updateError }, 'Failed to update dialogue');
      throw new Error('Failed to update dialogue text');
    }

    logger.info(ctx, 'Dialogue text updated successfully');

    revalidatePath('/home/[account]/studio/[projectId]/episodes', 'page');

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
/**
 * Update the timing of a dialogue line (timeline position and duration)
 */
export const updateDialogueTimingAction = enhanceAction(
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
    const { error: updateError } = await (client as any)
      .from('dialogue_lines')
      .update(updatePayload)
      .eq('id', data.dialogueLineId);

    if (updateError) {
      logger.error(
        { ...ctx, error: updateError },
        'Failed to update dialogue timing',
      );
      throw new Error('Failed to update dialogue timing');
    }

    revalidatePath('/home/[account]/studio/[projectId]/episodes', 'page');
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
