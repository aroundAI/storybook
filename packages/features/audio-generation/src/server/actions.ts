'use server';

import 'server-only';

import { revalidatePath } from 'next/cache';

import { v4 as uuidv4 } from 'uuid';

import { enhanceAction } from '@kit/next/actions';
import { getLogger } from '@kit/shared/logger';
import { requireUser } from '@kit/supabase/require-user';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

import type {
  CancelMusicGenerationSchemaType,
  GenerateMusicSchemaType,
  GetMusicJobStatusSchemaType,
} from '../lib/schemas';
import {
  CancelMusicGenerationSchema,
  GenerateMusicSchema,
  GetMusicJobStatusSchema,
} from '../lib/schemas';
import { SunoProvider } from '../providers/suno';

// Note: These actions use type assertions because the internal type definitions
// differ from the generated database types. The database schema will be aligned
// in a future update. RLS policies enforce project-level authorization.

/**
 * Generate music for an episode using Suno API
 *
 * This action:
 * 1. Validates the request
 * 2. Creates a generation_jobs record
 * 3. Calls the Suno provider to start generation
 * 4. Returns the job ID for status polling
 */
export const generateMusicAction = enhanceAction(
  async (data: GenerateMusicSchemaType) => {
    const logger = await getLogger();
    const ctx = {
      name: 'music.generate',
      episodeId: data.episodeId,
      provider: data.provider ?? 'suno',
    };

    logger.info(ctx, 'Starting music generation');

    const client = getSupabaseServerClient();
    const { data: user, error: authError } = await requireUser(client);

    if (authError || !user) {
      logger.warn(ctx, 'Unauthorized music generation attempt');
      throw new Error('Authentication required');
    }

    // Fetch episode to get project and account context
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: episode, error: episodeError } = await (client as any)
      .from('episodes')
      .select('id, project_id, projects(account_id)')
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

    // Get API key from environment (BYOK support can be added later)
    const providerName = data.provider ?? 'suno';
    const apiKey = process.env[`${providerName.toUpperCase()}_API_KEY`];

    if (!apiKey) {
      logger.error({ ...ctx, provider: providerName }, 'Missing API key');
      throw new Error(
        `Missing API key for provider: ${providerName}. Please configure ${providerName.toUpperCase()}_API_KEY.`,
      );
    }

    // Create generation job record
    const idempotencyKey = `music-${data.episodeId}-${uuidv4()}`;
    const estimatedCost = 50; // Suno: $0.50 per generation

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: job, error: createError } = await (client as any)
      .from('generation_jobs')
      .insert({
        account_id: accountId,
        project_id: projectId,
        job_type: 'music',
        reference_type: 'episode',
        reference_id: data.episodeId,
        provider: providerName,
        status: 'pending',
        input_data: {
          prompt: data.request.prompt,
          duration: data.request.duration,
          genre: data.request.genre,
          mood: data.request.mood,
          tempo: data.request.tempo,
          instrumentalOnly: data.request.instrumentalOnly,
          tags: data.request.tags,
        },
        estimated_cost_cents: estimatedCost,
        idempotency_key: idempotencyKey,
        max_retries: 3,
        timeout_seconds: 600, // 10 minute timeout
      })
      .select()
      .single();

    if (createError) {
      logger.error(
        { ...ctx, error: createError },
        'Failed to create generation job',
      );
      throw createError;
    }

    try {
      // Create provider and generate music
      const provider = new SunoProvider({
        apiKey,
        timeout: 60000, // 60s timeout for API calls
        maxRetries: 3,
      });

      const response = await provider.generateMusic({
        prompt: data.request.prompt,
        duration: data.request.duration,
        genre: data.request.genre,
        mood: data.request.mood,
        tempo: data.request.tempo,
        instrumentalOnly: data.request.instrumentalOnly,
        tags: data.request.tags,
      });

      // Update job with provider job ID
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (client as any)
        .from('generation_jobs')
        .update({
          provider_job_id: response.jobId,
          status: response.status,
          started_at: new Date().toISOString(),
        })
        .eq('id', job.id);

      logger.info(
        { ...ctx, jobId: job.id, providerJobId: response.jobId },
        'Music generation started',
      );

      revalidatePath('/home/[account]/studio/[projectId]/episodes', 'page');

      return {
        success: true,
        jobId: job.id,
        providerJobId: response.jobId,
        status: response.status,
        estimatedCost,
      };
    } catch (error) {
      // Update job with error
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (client as any)
        .from('generation_jobs')
        .update({
          status: 'failed',
          error_message:
            error instanceof Error ? error.message : 'Unknown error',
          error_code: 'GENERATION_FAILED',
        })
        .eq('id', job.id);

      logger.error({ ...ctx, error }, 'Music generation failed');
      throw error;
    }
  },
  {
    schema: GenerateMusicSchema,
  },
);

/**
 * Get the status of a music generation job
 *
 * This action polls the Suno provider for the current status
 * and updates the database accordingly.
 */
export const getMusicJobStatusAction = enhanceAction(
  async (data: GetMusicJobStatusSchemaType) => {
    const logger = await getLogger();
    const ctx = { name: 'music.status', jobId: data.jobId };

    logger.info(ctx, 'Polling music generation status');

    const client = getSupabaseServerClient();
    const { data: user, error: authError } = await requireUser(client);

    if (authError || !user) {
      logger.warn(ctx, 'Unauthorized music status poll attempt');
      throw new Error('Authentication required');
    }

    // Fetch the job with account info for authorization
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: job, error: fetchError } = await (client as any)
      .from('generation_jobs')
      .select('*, accounts!inner(primary_owner_user_id)')
      .eq('id', data.jobId)
      .single();

    if (fetchError || !job) {
      logger.error({ ...ctx, error: fetchError }, 'Job not found');
      throw new Error('Job not found');
    }

    // Verify user has access to this job's account
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: membership } = await (client as any)
      .from('accounts_memberships')
      .select('account_id')
      .eq('account_id', job.account_id)
      .eq('user_id', user.id)
      .single();

    const isOwner = job.accounts?.primary_owner_user_id === user.id;

    if (!membership && !isOwner) {
      logger.warn(
        { ...ctx, accountId: job.account_id },
        'User not authorized to access this job',
      );
      throw new Error('Not authorized to access this job');
    }

    // Check if already in terminal state
    if (
      job.status === 'completed' ||
      job.status === 'failed' ||
      job.status === 'cancelled'
    ) {
      logger.info(
        { ...ctx, status: job.status },
        'Job already in terminal state',
      );

      return {
        success: true,
        jobId: job.id,
        status: job.status,
        audioUrl: job.output_data?.audioUrl ?? null,
        duration: job.output_data?.duration ?? null,
        cost: job.cost_cents ?? job.estimated_cost_cents ?? 0,
        error: job.error_message ?? null,
        progress: job.status === 'completed' ? 100 : 0,
      };
    }

    // Ensure provider_job_id exists
    if (!job.provider_job_id) {
      logger.error(ctx, 'Job has no provider job ID');
      throw new Error('Job has no provider job ID - cannot poll status');
    }

    // Ensure provider exists
    if (!job.provider) {
      logger.error(ctx, 'Job has no provider');
      throw new Error('Job has no provider - cannot poll status');
    }

    const apiKey = process.env[`${job.provider.toUpperCase()}_API_KEY`];
    if (!apiKey) {
      logger.error({ ...ctx, provider: job.provider }, 'Missing API key');
      throw new Error(`Missing API key for provider: ${job.provider}`);
    }

    // Poll provider for status
    const provider = new SunoProvider({
      apiKey,
      timeout: 30000,
      maxRetries: 2,
    });

    const status = await provider.getStatus(job.provider_job_id);

    // Prepare update data
    const updateData: Record<string, unknown> = {
      status: status.status,
    };

    if (status.audioUrl) {
      updateData.output_data = {
        ...(job.output_data ?? {}),
        audioUrl: status.audioUrl,
      };
    }

    if (status.error) {
      updateData.error_message = status.error;
      updateData.error_code = 'PROVIDER_ERROR';
    }

    if (status.status === 'completed') {
      updateData.completed_at = new Date().toISOString();
      updateData.cost_cents = job.estimated_cost_cents ?? 50;
    }

    // Update job in database
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (client as any)
      .from('generation_jobs')
      .update(updateData)
      .eq('id', data.jobId);

    logger.info({ ...ctx, status: status.status }, 'Music status updated');

    if (status.status === 'completed') {
      revalidatePath('/home/[account]/studio/[projectId]/episodes', 'page');
    }

    // Calculate progress
    let progress = 0;
    if (status.status === 'pending') progress = 0;
    if (status.status === 'processing') progress = status.progress ?? 50;
    if (status.status === 'completed') progress = 100;
    if (status.status === 'failed') progress = 0;

    return {
      success: true,
      jobId: job.id,
      status: status.status,
      audioUrl: status.audioUrl ?? null,
      duration: null, // Duration populated after completion
      cost: job.estimated_cost_cents ?? 50,
      error: status.error ?? null,
      progress,
    };
  },
  {
    schema: GetMusicJobStatusSchema,
  },
);

/**
 * Cancel a music generation job
 *
 * This marks the job as cancelled in the database.
 * Note: Suno API may not support cancellation, so the generation
 * might complete on their end but we won't process the result.
 */
export const cancelMusicGenerationAction = enhanceAction(
  async (data: CancelMusicGenerationSchemaType) => {
    const logger = await getLogger();
    const ctx = { name: 'music.cancel', jobId: data.jobId };

    logger.info(ctx, 'Cancelling music generation job');

    const client = getSupabaseServerClient();
    const { data: user, error: authError } = await requireUser(client);

    if (authError || !user) {
      logger.warn(ctx, 'Unauthorized music cancellation attempt');
      throw new Error('Authentication required');
    }

    // Fetch the job with account info for authorization
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: job, error: fetchError } = await (client as any)
      .from('generation_jobs')
      .select('id, status, account_id, accounts!inner(primary_owner_user_id)')
      .eq('id', data.jobId)
      .single();

    if (fetchError || !job) {
      logger.error({ ...ctx, error: fetchError }, 'Job not found');
      throw new Error('Job not found');
    }

    // Verify user has access to this job's account
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: membership } = await (client as any)
      .from('accounts_memberships')
      .select('account_id')
      .eq('account_id', job.account_id)
      .eq('user_id', user.id)
      .single();

    const isOwner = job.accounts?.primary_owner_user_id === user.id;

    if (!membership && !isOwner) {
      logger.warn(
        { ...ctx, accountId: job.account_id },
        'User not authorized to cancel this job',
      );
      throw new Error('Not authorized to cancel this job');
    }

    // Check if already in terminal state
    if (
      job.status === 'completed' ||
      job.status === 'failed' ||
      job.status === 'cancelled'
    ) {
      logger.info(
        { ...ctx, status: job.status },
        'Job already in terminal state',
      );
      return { success: true, jobId: job.id };
    }

    // Mark job as cancelled
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (client as any)
      .from('generation_jobs')
      .update({
        status: 'cancelled',
        error_message: 'Cancelled by user',
        error_code: 'USER_CANCELLED',
        completed_at: new Date().toISOString(),
      })
      .eq('id', data.jobId);

    logger.info(ctx, 'Music generation job cancelled');
    revalidatePath('/home/[account]/studio/[projectId]/episodes', 'page');

    return { success: true, jobId: job.id };
  },
  {
    schema: CancelMusicGenerationSchema,
  },
);
