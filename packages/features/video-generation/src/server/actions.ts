'use server';

import 'server-only';

import { revalidatePath } from 'next/cache';

import { enhanceAction } from '@kit/next/actions';
import { getLogger } from '@kit/shared/logger';
import { requireUser } from '@kit/supabase/require-user';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

import {
  CancelVideoJobSchema,
  GenerateVideoSchema,
  PollVideoStatusSchema,
} from '../lib/schemas';
import { createVideoProvider } from '../providers/factory';

// Note: These actions assume the generation_jobs table exists in the database.
// The table will be created as part of the database migration in FILM-101.
// RLS policies will enforce project-level authorization.

export const generateVideoAction = enhanceAction(
  async (data) => {
    const logger = await getLogger();
    const ctx = {
      name: 'video.generate',
      shotId: data.shotId,
      provider: data.provider,
    };

    logger.info(ctx, 'Starting video generation');

    const client = getSupabaseServerClient();
    const { data: user, error: authError } = await requireUser(client);

    if (authError || !user) {
      logger.warn(ctx, 'Unauthorized video generation attempt');
      throw new Error('Authentication required');
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: job, error: createError } = await (client as any)
      .from('generation_jobs')
      .insert({
        shot_id: data.shotId,
        provider: data.provider,
        status: 'pending',
        request: data.request,
        started_at: new Date().toISOString(),
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

    const apiKey = process.env[`${data.provider.toUpperCase()}_API_KEY`];
    if (!apiKey) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (client as any)
        .from('generation_jobs')
        .update({
          status: 'failed',
          error: `Missing API key for provider: ${data.provider}`,
        })
        .eq('id', job.id);

      logger.error(ctx, 'Missing API key for provider');
      throw new Error(`Missing API key for provider: ${data.provider}`);
    }

    try {
      const provider = createVideoProvider(data.provider, { apiKey });
      const response = await provider.generateVideo(data.request);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (client as any)
        .from('generation_jobs')
        .update({
          provider_job_id: response.jobId,
          status: response.status,
        })
        .eq('id', job.id);

      logger.info(
        { ...ctx, jobId: job.id, providerJobId: response.jobId },
        'Video generation started',
      );
      revalidatePath('/home/[account]/projects/[id]', 'page');

      return { success: true, job: { ...job, providerJobId: response.jobId } };
    } catch (error) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (client as any)
        .from('generation_jobs')
        .update({
          status: 'failed',
          error: error instanceof Error ? error.message : 'Unknown error',
        })
        .eq('id', job.id);

      logger.error({ ...ctx, error }, 'Video generation failed');
      throw error;
    }
  },
  {
    schema: GenerateVideoSchema,
  },
);

export const pollVideoStatusAction = enhanceAction(
  async (data) => {
    const logger = await getLogger();
    const ctx = { name: 'video.poll', jobId: data.jobId };

    logger.info(ctx, 'Polling video generation status');

    const client = getSupabaseServerClient();
    const { data: user, error: authError } = await requireUser(client);

    if (authError || !user) {
      logger.warn(ctx, 'Unauthorized video status poll attempt');
      throw new Error('Authentication required');
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: job, error: fetchError } = await (client as any)
      .from('generation_jobs')
      .select('*')
      .eq('id', data.jobId)
      .single();

    if (fetchError || !job) {
      logger.error({ ...ctx, error: fetchError }, 'Job not found');
      throw new Error('Job not found');
    }

    if (job.status === 'completed' || job.status === 'failed') {
      logger.info(
        { ...ctx, status: job.status },
        'Job already in terminal state',
      );
      return { success: true, status: job };
    }

    const apiKey = process.env[`${job.provider.toUpperCase()}_API_KEY`];
    if (!apiKey) {
      logger.error({ ...ctx, provider: job.provider }, 'Missing API key');
      throw new Error(`Missing API key for provider: ${job.provider}`);
    }

    const provider = createVideoProvider(job.provider, { apiKey });
    const status = await provider.getStatus(job.provider_job_id);

    const updateData: Record<string, unknown> = {
      status: status.status,
    };

    if (status.videoUrl) {
      updateData.video_url = status.videoUrl;
    }
    if (status.thumbnailUrl) {
      updateData.thumbnail_url = status.thumbnailUrl;
    }
    if (status.error) {
      updateData.error = status.error;
    }
    if (status.completedAt || status.status === 'completed') {
      updateData.completed_at = status.completedAt ?? new Date().toISOString();
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (client as any)
      .from('generation_jobs')
      .update(updateData)
      .eq('id', data.jobId);

    logger.info({ ...ctx, status: status.status }, 'Video status updated');

    if (status.status === 'completed') {
      revalidatePath('/home/[account]/projects/[id]', 'page');
    }

    return { success: true, status: { ...job, ...updateData } };
  },
  {
    schema: PollVideoStatusSchema,
  },
);

export const cancelVideoJobAction = enhanceAction(
  async (data) => {
    const logger = await getLogger();
    const ctx = { name: 'video.cancel', jobId: data.jobId };

    logger.info(ctx, 'Cancelling video generation job');

    const client = getSupabaseServerClient();
    const { data: user, error: authError } = await requireUser(client);

    if (authError || !user) {
      logger.warn(ctx, 'Unauthorized video cancellation attempt');
      throw new Error('Authentication required');
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: job, error: fetchError } = await (client as any)
      .from('generation_jobs')
      .select('*')
      .eq('id', data.jobId)
      .single();

    if (fetchError || !job) {
      logger.error({ ...ctx, error: fetchError }, 'Job not found');
      throw new Error('Job not found');
    }

    if (job.status === 'completed' || job.status === 'cancelled') {
      logger.info(
        { ...ctx, status: job.status },
        'Job already in terminal state',
      );
      return { success: true };
    }

    const apiKey = process.env[`${job.provider.toUpperCase()}_API_KEY`];
    if (!apiKey) {
      logger.error({ ...ctx, provider: job.provider }, 'Missing API key');
      throw new Error(`Missing API key for provider: ${job.provider}`);
    }

    const provider = createVideoProvider(job.provider, { apiKey });
    await provider.cancelJob(job.provider_job_id);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (client as any)
      .from('generation_jobs')
      .update({ status: 'cancelled' })
      .eq('id', data.jobId);

    logger.info(ctx, 'Video generation job cancelled');
    revalidatePath('/home/[account]/projects/[id]', 'page');

    return { success: true };
  },
  {
    schema: CancelVideoJobSchema,
  },
);
