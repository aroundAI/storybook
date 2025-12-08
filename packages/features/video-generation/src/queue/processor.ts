'server-only';

import type { Job } from 'bullmq';

import { checkRateLimit } from '../lib/rate-limiter';
import type { ProviderConfig, VideoProvider } from '../lib/types';
import { createVideoProvider } from '../providers';

import type {
  VideoGenerationJobData,
  VideoGenerationJobResult,
} from './types';

/**
 * Get provider configuration from environment variables
 */
function getProviderConfig(provider: VideoProvider): ProviderConfig {
  const envKeyMap: Record<VideoProvider, string> = {
    kling: 'KLING_API_KEY',
    runway: 'RUNWAY_API_KEY',
    luma: 'LUMA_API_KEY',
  };

  const envBaseUrlMap: Record<VideoProvider, string> = {
    kling: 'KLING_BASE_URL',
    runway: 'RUNWAY_BASE_URL',
    luma: 'LUMA_BASE_URL',
  };

  const apiKey = process.env[envKeyMap[provider]];
  const baseUrl = process.env[envBaseUrlMap[provider]];

  if (!apiKey) {
    throw new Error(`${envKeyMap[provider]} environment variable is required`);
  }

  return {
    apiKey,
    baseUrl,
  };
}

/**
 * Error thrown when rate limit is exceeded
 */
export class RateLimitExceededError extends Error {
  constructor(
    public readonly retryAfter: number,
    message?: string,
  ) {
    super(message || `Rate limit exceeded. Retry after ${retryAfter}s`);
    this.name = 'RateLimitExceededError';
  }
}

/**
 * Error thrown when provider API fails
 */
export class ProviderApiError extends Error {
  constructor(
    public readonly provider: string,
    public readonly code?: string,
    message?: string,
  ) {
    super(message || `Provider ${provider} API error`);
    this.name = 'ProviderApiError';
  }
}

/**
 * Process a video generation job
 *
 * This function:
 * 1. Updates job status to 'processing' in DB
 * 2. Checks rate limit via checkRateLimit()
 * 3. Creates provider via createVideoProvider()
 * 4. Submits generation request to provider
 * 5. Updates DB with provider job ID
 * 6. Returns result (completion via webhook)
 *
 * @param job - The BullMQ job to process
 * @returns The job result
 */
export async function processVideoGenerationJob(
  job: Job<VideoGenerationJobData>,
): Promise<VideoGenerationJobResult> {
  const {
    accountId,
    shotId,
    provider,
    generationJobId,
    prompt,
    duration,
    aspectRatio,
    mode,
    referenceImageUrl,
  } = job.data;

  console.log('[VideoQueue] Processing job:', {
    jobId: job.id,
    accountId,
    provider,
    attempt: job.attemptsMade + 1,
  });

  // Get Supabase client (lazy import to avoid circular dependencies)
  const { getSupabaseServerClient } = await import(
    '@kit/supabase/server-client'
  );
  const client = getSupabaseServerClient();

  try {
    // Step 1: Update job status to processing
    const { error: updateError } = await client
      .from('generation_jobs')
      .update({
        status: 'processing',
        started_at: new Date().toISOString(),
      })
      .eq('id', generationJobId);

    if (updateError) {
      console.error('[VideoQueue] Failed to update job status:', updateError);
      // Continue processing even if status update fails
    }

    // Step 2: Check rate limit
    const rateLimitResult = await checkRateLimit(accountId, provider);

    if (!rateLimitResult.allowed) {
      throw new RateLimitExceededError(rateLimitResult.retryAfter ?? 30);
    }

    // Step 3: Get provider config and create provider instance
    const providerType = provider as VideoProvider;
    const providerConfig = getProviderConfig(providerType);
    const videoProvider = createVideoProvider(providerType, providerConfig);

    // Step 4: Submit generation request
    // Note: referenceImageUrl is passed via settings for image-to-video
    const generation = await videoProvider.generateVideo({
      prompt,
      duration: parseInt(duration, 10),
      aspectRatio,
      modelVersion: mode,
      settings: referenceImageUrl ? { imageUrl: referenceImageUrl } : undefined,
    });

    // Step 5: Update generation job with provider job ID
    const { error: providerUpdateError } = await client
      .from('generation_jobs')
      .update({
        provider_job_id: generation.jobId,
      })
      .eq('id', generationJobId);

    if (providerUpdateError) {
      console.error(
        '[VideoQueue] Failed to update provider job ID:',
        providerUpdateError,
      );
    }

    // Step 6: Update shot status to 'generating'
    const { error: shotUpdateError } = await client
      .from('shots')
      .update({
        status: 'generating',
        updated_at: new Date().toISOString(),
      })
      .eq('id', shotId);

    if (shotUpdateError) {
      console.error(
        '[VideoQueue] Failed to update shot status:',
        shotUpdateError,
      );
    }

    console.log('[VideoQueue] Job submitted to provider:', {
      jobId: job.id,
      providerJobId: generation.jobId,
      provider,
    });

    // Job will be completed via webhook
    return {
      success: true,
      providerJobId: generation.jobId,
    };
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : 'Unknown error';

    console.error('[VideoQueue] Job processing error:', {
      jobId: job.id,
      error: errorMessage,
    });

    // Update generation job with error
    await client
      .from('generation_jobs')
      .update({
        status: 'failed',
        error_message: errorMessage,
        retry_count: job.attemptsMade + 1,
      })
      .eq('id', generationJobId);

    // Re-throw to trigger BullMQ retry logic
    throw error;
  }
}

/**
 * Handle job completion (called by worker)
 *
 * @param job - The completed job
 * @param result - The job result
 */
export function onJobCompleted(
  job: Job<VideoGenerationJobData>,
  result: VideoGenerationJobResult,
): void {
  console.log('[VideoQueue] Job completed:', {
    jobId: job.id,
    accountId: job.data.accountId,
    success: result.success,
    providerJobId: result.providerJobId,
  });
}

/**
 * Handle job failure (called by worker)
 *
 * @param job - The failed job
 * @param error - The error that caused the failure
 */
export function onJobFailed(
  job: Job<VideoGenerationJobData> | undefined,
  error: Error,
): void {
  console.error('[VideoQueue] Job failed:', {
    jobId: job?.id,
    accountId: job?.data.accountId,
    error: error.message,
    attempts: job?.attemptsMade,
  });
}

/**
 * Handle worker errors (called by worker)
 *
 * @param error - The worker error
 */
export function onWorkerError(error: Error): void {
  console.error('[VideoQueue] Worker error:', { error: error.message });
}
