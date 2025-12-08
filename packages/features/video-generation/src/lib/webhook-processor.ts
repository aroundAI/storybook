'use server';

import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import { getLogger } from '@kit/shared/logger';

import type {
  HailuoWebhookPayload,
  KlingWebhookPayload,
} from '../webhooks/types';
import type { InternalJobStatus } from './provider-status';
import { HAILUO_STATUS_MAP, KLING_STATUS_MAP } from './provider-status';

export type VideoProvider = 'kling' | 'hailuo' | 'runway';

export interface WebhookProcessorConfig {
  provider: VideoProvider;
  providerJobId: string;
}

export interface ProcessedWebhookResult {
  jobId: string | null;
  shotId: string | null;
  status: InternalJobStatus;
  isIdempotent: boolean;
  error?: string;
}

interface VideoData {
  videoUrl: string;
  thumbnailUrl?: string;
  duration?: number;
}

interface ErrorData {
  code: string;
  message: string;
}

/**
 * Processes a video generation webhook and updates the database.
 *
 * Handles:
 * - Finding the generation job by provider_job_id
 * - Status mapping from provider to internal status
 * - Idempotency (returns early if already processed)
 * - Updating generation_jobs table
 * - Updating shots table with video_url
 * - Recording cost (uses estimated_cost as actual)
 */
export async function processVideoWebhook(
  client: SupabaseClient,
  config: WebhookProcessorConfig,
  payload: KlingWebhookPayload | HailuoWebhookPayload,
): Promise<ProcessedWebhookResult> {
  const logger = await getLogger();
  const ctx = {
    name: 'webhook-processor',
    provider: config.provider,
    providerJobId: config.providerJobId,
  };

  logger.info(ctx, 'Processing video webhook');

  // 1. Find generation job by provider_job_id
  const { data: job, error: jobError } = await client
    .from('generation_jobs')
    .select(
      'id, status, reference_id, reference_type, account_id, estimated_cost_cents',
    )
    .eq('provider_job_id', config.providerJobId)
    .eq('provider', config.provider)
    .single();

  if (jobError || !job) {
    logger.error({ ...ctx, error: jobError }, 'Generation job not found');
    return {
      jobId: null,
      shotId: null,
      status: 'failed',
      isIdempotent: false,
      error: `Job not found: ${config.providerJobId}`,
    };
  }

  // 2. Check idempotency - if already completed/failed, return early
  if (job.status === 'completed' || job.status === 'failed') {
    logger.info(
      { ...ctx, jobId: job.id },
      'Job already processed, returning idempotent response',
    );
    return {
      jobId: job.id,
      shotId: job.reference_id,
      status: job.status as InternalJobStatus,
      isIdempotent: true,
    };
  }

  // 3. Map provider status to internal status
  const internalStatus = mapProviderStatus(config.provider, payload);

  // 4. Prepare job updates
  const jobUpdates: Record<string, unknown> = {
    status: internalStatus,
  };

  // 5. Handle completion
  if (internalStatus === 'completed') {
    const videoData = extractVideoData(config.provider, payload);

    if (videoData) {
      jobUpdates.output_data = videoData;
      jobUpdates.completed_at = new Date().toISOString();
      jobUpdates.cost_cents = job.estimated_cost_cents; // Use estimated as actual

      // Update shot with video URL
      if (job.reference_type === 'shot' && job.reference_id) {
        const { error: shotError } = await client
          .from('shots')
          .update({
            video_url: videoData.videoUrl,
            thumbnail_url: videoData.thumbnailUrl,
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
  }

  // 6. Handle failure
  if (internalStatus === 'failed') {
    const errorData = extractErrorData(config.provider, payload);
    jobUpdates.error_message = errorData.message;
    jobUpdates.error_code = errorData.code;
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

  // 7. Update generation job
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

  logger.info(
    { ...ctx, jobId: job.id, status: internalStatus },
    'Generation job updated',
  );

  return {
    jobId: job.id,
    shotId: job.reference_id,
    status: internalStatus,
    isIdempotent: false,
  };
}

function mapProviderStatus(
  provider: VideoProvider,
  payload: KlingWebhookPayload | HailuoWebhookPayload,
): InternalJobStatus {
  if (provider === 'kling') {
    const klingPayload = payload as KlingWebhookPayload;
    return KLING_STATUS_MAP[klingPayload.task_status] || 'failed';
  } else if (provider === 'hailuo') {
    const hailuoPayload = payload as HailuoWebhookPayload;
    return HAILUO_STATUS_MAP[hailuoPayload.status] || 'failed';
  }
  return 'failed';
}

function extractVideoData(
  provider: VideoProvider,
  payload: KlingWebhookPayload | HailuoWebhookPayload,
): VideoData | null {
  if (provider === 'kling') {
    const klingPayload = payload as KlingWebhookPayload;
    const video = klingPayload.task_result?.videos?.[0];
    if (!video) return null;
    return {
      videoUrl: video.url,
      duration: video.duration,
    };
  } else if (provider === 'hailuo') {
    const hailuoPayload = payload as HailuoWebhookPayload;
    if (!hailuoPayload.video_url) return null;
    return {
      videoUrl: hailuoPayload.video_url,
      thumbnailUrl: hailuoPayload.cover_url,
      duration: hailuoPayload.duration,
    };
  }
  return null;
}

function extractErrorData(
  provider: VideoProvider,
  payload: KlingWebhookPayload | HailuoWebhookPayload,
): ErrorData {
  if (provider === 'kling') {
    const klingPayload = payload as KlingWebhookPayload;
    return {
      code: klingPayload.error?.code || 'PROVIDER_ERROR',
      message:
        klingPayload.error?.message ||
        klingPayload.task_status_msg ||
        'Unknown error',
    };
  } else if (provider === 'hailuo') {
    const hailuoPayload = payload as HailuoWebhookPayload;
    return {
      code: hailuoPayload.error?.code?.toString() || 'PROVIDER_ERROR',
      message: hailuoPayload.error?.message || 'Unknown error',
    };
  }
  return {
    code: 'UNKNOWN_PROVIDER',
    message: 'Unknown provider error',
  };
}
