import type { ConnectionOptions, QueueOptions, WorkerOptions } from 'bullmq';

import type { VideoProvider } from '../lib/types';

/**
 * Queue name for video generation jobs
 */
export const QUEUE_NAME = 'video-generation';

/**
 * Get Redis connection configuration from environment
 */
export function getRedisConnection(): ConnectionOptions {
  const redisUrl = process.env.REDIS_URL;

  if (!redisUrl) {
    throw new Error('REDIS_URL environment variable is required for queue');
  }

  // Parse Redis URL
  const url = new URL(redisUrl);

  return {
    host: url.hostname,
    port: parseInt(url.port || '6379', 10),
    password: url.password || undefined,
    // Enable TLS for rediss:// URLs (e.g., Upstash)
    ...(url.protocol === 'rediss:' && {
      tls: {
        rejectUnauthorized: false,
      },
    }),
  };
}

/**
 * Concurrency limits per video provider
 * These limits prevent overwhelming provider APIs
 */
export const PROVIDER_CONCURRENCY_LIMITS: Record<VideoProvider, number> = {
  kling: 5,
  runway: 3,
  luma: 3,
};

/**
 * Get total concurrency from environment or default
 */
export function getQueueConcurrency(): number {
  return parseInt(process.env.VIDEO_QUEUE_CONCURRENCY || '10', 10);
}

/**
 * Get rate limit configuration for the queue worker
 */
export function getQueueRateLimitConfig(): { max: number; duration: number } {
  return {
    max: parseInt(process.env.VIDEO_QUEUE_RATE_LIMIT || '10', 10),
    duration: parseInt(
      process.env.VIDEO_QUEUE_RATE_LIMIT_DURATION || '1000',
      10,
    ),
  };
}

/**
 * Default job options for the queue
 */
export const DEFAULT_JOB_OPTIONS: QueueOptions['defaultJobOptions'] = {
  attempts: 3,
  backoff: {
    type: 'exponential',
    delay: 30000, // Start with 30 seconds: 30s → 60s → 120s
  },
  removeOnComplete: {
    age: 24 * 60 * 60, // Keep completed jobs for 24 hours
    count: 1000, // Keep last 1000 completed jobs
  },
  removeOnFail: {
    age: 7 * 24 * 60 * 60, // Keep failed jobs for 7 days
  },
};

/**
 * Get queue configuration
 */
export function getQueueConfig(): QueueOptions {
  return {
    connection: getRedisConnection(),
    defaultJobOptions: DEFAULT_JOB_OPTIONS,
  };
}

/**
 * Get worker configuration
 */
export function getWorkerConfig(): WorkerOptions {
  const rateLimit = getQueueRateLimitConfig();

  return {
    connection: getRedisConnection(),
    concurrency: getQueueConcurrency(),
    limiter: {
      max: rateLimit.max,
      duration: rateLimit.duration,
    },
  };
}

/**
 * Retry backoff delays in milliseconds
 */
export const RETRY_DELAYS = {
  first: 30000, // 30 seconds
  second: 60000, // 60 seconds
  third: 120000, // 120 seconds
} as const;

/**
 * Maximum retry attempts
 */
export const MAX_RETRY_ATTEMPTS = 3;
