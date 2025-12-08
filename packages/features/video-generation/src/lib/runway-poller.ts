'use server';

import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import { getLogger } from '@kit/shared/logger';

import type {
  InternalJobStatus,
  RunwayStatusResponse,
} from './provider-status';
import { RUNWAY_STATUS_MAP } from './provider-status';

export interface RunwayPollerConfig {
  /** Runway API key */
  apiKey: string;
  /** Base URL for Runway API (defaults to https://api.runwayml.com) */
  baseUrl?: string;
}

export interface PollResult {
  jobId: string;
  providerJobId: string;
  status: InternalJobStatus;
  updated: boolean;
  error?: string;
}

interface GenerationJob {
  id: string;
  provider_job_id: string;
  reference_id: string | null;
  reference_type: string | null;
  account_id: string;
  estimated_cost_cents: number | null;
}

/**
 * Polls Runway API for active job statuses and updates the database.
 *
 * Should be called by a scheduled job (cron/SQS) every 30 seconds.
 *
 * @param client Supabase client with admin privileges
 * @param config Runway API configuration
 * @returns Array of poll results for each job
 */
export async function pollRunwayJobs(
  client: SupabaseClient,
  config?: Partial<RunwayPollerConfig>,
): Promise<PollResult[]> {
  const logger = await getLogger();
  const ctx = { name: 'runway-poller' };

  const apiKey = config?.apiKey || process.env.RUNWAY_API_KEY;
  const baseUrl = config?.baseUrl || 'https://api.runwayml.com';

  if (!apiKey) {
    logger.warn(ctx, 'RUNWAY_API_KEY not configured, skipping poll');
    return [];
  }

  // Find active Runway jobs
  const { data: activeJobs, error } = await client
    .from('generation_jobs')
    .select(
      'id, provider_job_id, reference_id, reference_type, account_id, estimated_cost_cents',
    )
    .eq('provider', 'runway')
    .in('status', ['queued', 'processing']);

  if (error) {
    logger.error({ ...ctx, error }, 'Failed to fetch active Runway jobs');
    throw error;
  }

  if (!activeJobs?.length) {
    logger.debug(ctx, 'No active Runway jobs to poll');
    return [];
  }

  logger.info({ ...ctx, jobCount: activeJobs.length }, 'Polling Runway jobs');

  const results: PollResult[] = [];

  for (const job of activeJobs) {
    try {
      const result = await pollSingleRunwayJob(client, job, {
        apiKey,
        baseUrl,
      });
      results.push(result);
    } catch (err) {
      logger.error(
        { ...ctx, jobId: job.id, error: err },
        'Failed to poll Runway job',
      );
      results.push({
        jobId: job.id,
        providerJobId: job.provider_job_id,
        status: 'processing',
        updated: false,
        error: err instanceof Error ? err.message : 'Unknown error',
      });
    }
  }

  return results;
}

async function pollSingleRunwayJob(
  client: SupabaseClient,
  job: GenerationJob,
  config: RunwayPollerConfig,
): Promise<PollResult> {
  const logger = await getLogger();
  const ctx = {
    name: 'runway-poller',
    jobId: job.id,
    providerJobId: job.provider_job_id,
  };

  // Call Runway API
  const response = await fetch(
    `${config.baseUrl}/v1/tasks/${job.provider_job_id}`,
    {
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
      },
    },
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Runway API error ${response.status}: ${errorText}`);
  }

  const statusResponse: RunwayStatusResponse = await response.json();
  const internalStatus = RUNWAY_STATUS_MAP[statusResponse.status] || 'failed';

  // Check if status changed
  const isTerminal =
    internalStatus === 'completed' ||
    internalStatus === 'failed' ||
    internalStatus === 'cancelled';

  if (!isTerminal) {
    // Status hasn't changed to terminal, no update needed
    logger.debug(
      { ...ctx, providerStatus: statusResponse.status },
      'Runway job still processing',
    );
    return {
      jobId: job.id,
      providerJobId: job.provider_job_id,
      status: internalStatus,
      updated: false,
    };
  }

  // Prepare job updates
  const jobUpdates: Record<string, unknown> = {
    status: internalStatus,
  };

  // Handle completion
  if (internalStatus === 'completed' && statusResponse.output?.[0]) {
    const video = statusResponse.output[0];
    jobUpdates.output_data = {
      videoUrl: video.url,
      duration: video.duration,
    };
    jobUpdates.completed_at = new Date().toISOString();
    jobUpdates.cost_cents = job.estimated_cost_cents;

    // Update shot with video URL
    if (job.reference_type === 'shot' && job.reference_id) {
      const { error: shotError } = await client
        .from('shots')
        .update({
          video_url: video.url,
          status: 'completed',
        })
        .eq('id', job.reference_id);

      if (shotError) {
        logger.error(
          { ...ctx, shotId: job.reference_id, error: shotError },
          'Failed to update shot',
        );
      } else {
        logger.info(
          { ...ctx, shotId: job.reference_id },
          'Shot updated with video URL',
        );
      }
    }
  }

  // Handle failure
  if (internalStatus === 'failed' || internalStatus === 'cancelled') {
    jobUpdates.error_message = statusResponse.failure || 'Job failed';
    jobUpdates.error_code = statusResponse.failureCode || 'PROVIDER_ERROR';
    jobUpdates.completed_at = new Date().toISOString();

    // Update shot status to failed
    if (job.reference_type === 'shot' && job.reference_id) {
      const { error: shotError } = await client
        .from('shots')
        .update({ status: 'failed' })
        .eq('id', job.reference_id);

      if (shotError) {
        logger.error(
          { ...ctx, shotId: job.reference_id, error: shotError },
          'Failed to update shot status',
        );
      }
    }
  }

  // Update generation job
  const { error: updateError } = await client
    .from('generation_jobs')
    .update(jobUpdates)
    .eq('id', job.id);

  if (updateError) {
    logger.error(
      { ...ctx, error: updateError },
      'Failed to update generation job',
    );
    throw updateError;
  }

  logger.info({ ...ctx, status: internalStatus }, 'Runway job updated');

  return {
    jobId: job.id,
    providerJobId: job.provider_job_id,
    status: internalStatus,
    updated: true,
  };
}
