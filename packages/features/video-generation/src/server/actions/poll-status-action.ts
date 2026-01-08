'use server';

import 'server-only';

import { revalidatePath } from 'next/cache';

import { enhanceAction } from '@kit/next/actions';
import { getLogger } from '@kit/shared/logger';
import { requireUser } from '@kit/supabase/require-user';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

import {
  type PollVideoStatusResponse,
  PollVideoStatusSchema,
} from '../../lib/schemas';
import { createVideoProvider } from '../../providers/factory';

// Caching thresholds (in milliseconds)
const CACHE_FRESH_THRESHOLD = 60 * 1000; // 1 minute
const CACHE_STALE_THRESHOLD = 5 * 60 * 1000; // 5 minutes
const POLL_COOLDOWN = 60 * 1000; // 1 minute per job

// In-memory poll tracking (for rate limiting)
const lastPollTime = new Map<string, number>();

/**
 * Poll video generation status.
 *
 * Implements smart caching strategy per FILM-408 spec:
 * - If updated <1 min ago: Return cached status (no provider call)
 * - If updated 1-5 min ago: Poll provider API
 * - If updated >5 min ago: Poll provider + log webhook failure warning
 *
 * Rate limited to max 1 poll per job per minute.
 */
export const pollVideoStatusAction = enhanceAction(
  async (data): Promise<PollVideoStatusResponse> => {
    const logger = await getLogger();
    const ctx = { name: 'video.poll', jobId: data.generationJobId };

    logger.info(ctx, 'Polling video generation status');

    const client = getSupabaseServerClient();
    const { data: user, error: authError } = await requireUser(client);

    if (authError || !user) {
      logger.warn(ctx, 'Unauthorized video status poll attempt');
      throw new Error('Authentication required');
    }

    // Fetch job from database
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: job, error: fetchError } = await (client as any)
      .from('generation_jobs')
      .select(`
        id, status, provider, provider_job_id, reference_type, reference_id,
        output_data, error_message, updated_at
      `)
      .eq('id', data.generationJobId)
      .single();

    if (fetchError || !job) {
      logger.error({ ...ctx, error: fetchError }, 'Job not found');
      throw new Error('Generation job not found');
    }

    // Check if already in terminal state - return immediately
    if (
      job.status === 'completed' ||
      job.status === 'failed' ||
      job.status === 'cancelled'
    ) {
      logger.info(
        { ...ctx, status: job.status },
        'Job already in terminal state',
      );
      return buildResponse(job);
    }

    // Smart caching logic based on last update time
    const lastUpdate = new Date(job.updated_at).getTime();
    const now = Date.now();
    const timeSinceUpdate = now - lastUpdate;

    // If updated <1 min ago: Return cached status (no provider call)
    if (timeSinceUpdate < CACHE_FRESH_THRESHOLD) {
      logger.info(
        { ...ctx, ageMs: timeSinceUpdate },
        'Returning cached status (fresh)',
      );
      return buildResponse(job);
    }

    // Rate limit: Max 1 poll per job per minute
    const lastPoll = lastPollTime.get(data.generationJobId) ?? 0;
    if (now - lastPoll < POLL_COOLDOWN) {
      logger.info(
        { ...ctx, cooldownRemainingMs: POLL_COOLDOWN - (now - lastPoll) },
        'Rate limited, returning cached status',
      );
      return buildResponse(job);
    }

    // If updated >5 min ago: Log webhook failure warning
    if (timeSinceUpdate > CACHE_STALE_THRESHOLD) {
      logger.warn(
        { ...ctx, ageMs: timeSinceUpdate, thresholdMs: CACHE_STALE_THRESHOLD },
        'Webhook appears to have failed - status not updated for >5 minutes',
      );
    }

    // Ensure we have required fields for polling
    if (!job.provider_job_id) {
      logger.info(ctx, 'Job has no provider job ID yet - returning queued');
      return buildResponse(job);
    }

    if (!job.provider) {
      logger.error(ctx, 'Job has no provider');
      throw new Error('Job has no provider - cannot poll status');
    }

    // Poll provider API
    try {
      // Mark poll time before making request
      lastPollTime.set(data.generationJobId, now);

      const apiKey = process.env[`${job.provider.toUpperCase()}_API_KEY`];
      if (!apiKey) {
        logger.error({ ...ctx, provider: job.provider }, 'Missing API key');
        throw new Error(`Missing API key for provider: ${job.provider}`);
      }

      const provider = createVideoProvider(job.provider, { apiKey });
      const providerStatus = await provider.getStatus(job.provider_job_id);

      // Build update data for generation_jobs
      const updateData: Record<string, unknown> = {
        status: providerStatus.status,
        updated_at: new Date().toISOString(),
      };

      if (providerStatus.videoUrl || providerStatus.thumbnailUrl) {
        updateData.output_data = {
          ...job.output_data,
          videoUrl: providerStatus.videoUrl,
          thumbnailUrl: providerStatus.thumbnailUrl,
          progress: providerStatus.progress,
        };
      } else if (providerStatus.progress !== undefined) {
        updateData.output_data = {
          ...job.output_data,
          progress: providerStatus.progress,
        };
      }

      if (providerStatus.error) {
        updateData.error_message = providerStatus.error;
      }

      if (providerStatus.status === 'completed') {
        updateData.completed_at =
          providerStatus.completedAt ?? new Date().toISOString();
      }

      if (providerStatus.status === 'failed') {
        updateData.completed_at = new Date().toISOString();
      }

      // Update generation_jobs table
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (client as any)
        .from('generation_jobs')
        .update(updateData)
        .eq('id', data.generationJobId);

      // Update shots table for terminal states
      if (
        providerStatus.status === 'completed' &&
        job.reference_type === 'shot' &&
        job.reference_id
      ) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (client as any)
          .from('shots')
          .update({
            video_url: providerStatus.videoUrl,
            status: 'completed',
            updated_at: new Date().toISOString(),
          })
          .eq('id', job.reference_id);

        logger.info(
          { ...ctx, shotId: job.reference_id },
          'Shot updated with video URL',
        );
      }

      if (
        providerStatus.status === 'failed' &&
        job.reference_type === 'shot' &&
        job.reference_id
      ) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (client as any)
          .from('shots')
          .update({
            status: 'failed',
            updated_at: new Date().toISOString(),
          })
          .eq('id', job.reference_id);

        logger.info(
          { ...ctx, shotId: job.reference_id },
          'Shot status updated to failed',
        );
      }

      logger.info(
        {
          ...ctx,
          status: providerStatus.status,
          progress: providerStatus.progress,
        },
        'Video status polled and updated',
      );

      // Revalidate if terminal state
      if (
        providerStatus.status === 'completed' ||
        providerStatus.status === 'failed'
      ) {
        revalidatePath('/home/[account]/projects/[id]', 'page');
      }

      return {
        status: providerStatus.status as PollVideoStatusResponse['status'],
        progress: providerStatus.progress,
        videoUrl: providerStatus.videoUrl,
        thumbnailUrl: providerStatus.thumbnailUrl,
        errorMessage: providerStatus.error,
        lastUpdated: new Date().toISOString(),
      };
    } catch (error) {
      logger.error(
        { ...ctx, error: error instanceof Error ? error.message : 'Unknown' },
        'Failed to poll provider status',
      );

      // Return cached status on error (fail gracefully)
      return buildResponse(job);
    }
  },
  {
    schema: PollVideoStatusSchema,
  },
);

/**
 * Helper to build response from database job record.
 */
function buildResponse(job: Record<string, unknown>): PollVideoStatusResponse {
  const status = job.status as PollVideoStatusResponse['status'];
  const outputData = job.output_data as Record<string, unknown> | undefined;

  return {
    status,
    progress: status === 'completed' ? 100 : (outputData?.progress as number),
    videoUrl: (outputData?.videoUrl as string) ?? (job.video_url as string),
    thumbnailUrl:
      (outputData?.thumbnailUrl as string) ?? (job.thumbnail_url as string),
    errorMessage: (job.error_message as string) ?? (job.error as string),
    lastUpdated: job.updated_at as string,
  };
}
