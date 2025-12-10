'use server';

import 'server-only';

import { revalidatePath } from 'next/cache';

import { enhanceAction } from '@kit/next/actions';
import { getLogger } from '@kit/shared/logger';
import { requireUser } from '@kit/supabase/require-user';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

import { CancelVideoJobSchema } from '../../lib/schemas';
import { createVideoProvider } from '../../providers/factory';

// Note: These actions use type assertions because the internal type definitions
// differ from the generated database types. The database schema will be aligned
// in a future update. RLS policies enforce project-level authorization.

/**
 * Cancel a video generation job.
 *
 * If the job hasn't been submitted to the provider yet (no provider_job_id),
 * it will simply be marked as cancelled in the database.
 *
 * If the job has been submitted, it will attempt to cancel with the provider
 * before marking as cancelled in the database.
 */
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

    // Check all terminal states
    if (
      job.status === 'completed' ||
      job.status === 'failed' ||
      job.status === 'cancelled'
    ) {
      logger.info(
        { ...ctx, status: job.status },
        'Job already in terminal state',
      );
      return { success: true };
    }

    // Ensure provider_job_id exists before cancelling
    if (!job.provider_job_id) {
      // Job never started with provider, just mark as cancelled
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (client as any)
        .from('generation_jobs')
        .update({ status: 'cancelled', updated_at: new Date().toISOString() })
        .eq('id', data.jobId);

      logger.info(ctx, 'Job cancelled (no provider job to cancel)');
      revalidatePath('/home/[account]/projects/[id]', 'page');
      return { success: true };
    }

    // Ensure provider exists
    if (!job.provider) {
      logger.error(ctx, 'Job has no provider');
      throw new Error('Job has no provider - cannot cancel');
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
      .update({ status: 'cancelled', updated_at: new Date().toISOString() })
      .eq('id', data.jobId);

    logger.info(ctx, 'Video generation job cancelled');
    revalidatePath('/home/[account]/projects/[id]', 'page');

    return { success: true };
  },
  {
    schema: CancelVideoJobSchema,
  },
);
