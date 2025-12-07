/**
 * Video Generation Job Queue
 *
 * BullMQ-based Redis queue for managing asynchronous video generation jobs.
 *
 * Features:
 * - Priority-based processing (0-10 scale)
 * - Retry logic with exponential backoff (30s → 60s → 120s)
 * - Dead letter queue after max retries
 * - Per-provider concurrency limits
 * - Integration with rate limiter
 * - Queue metrics and monitoring
 *
 * @example
 * ```typescript
 * import {
 *   addVideoGenerationJob,
 *   getJobStatus,
 *   getQueueMetrics,
 *   createVideoGenerationWorker,
 * } from '@kit/video-generation/queue';
 *
 * // Add a job to the queue
 * const job = await addVideoGenerationJob({
 *   accountId: 'account-123',
 *   projectId: 'project-123',
 *   shotId: 'shot-123',
 *   provider: 'kling',
 *   generationJobId: 'job-123',
 *   prompt: 'A beautiful sunset over the ocean',
 *   duration: '5',
 *   aspectRatio: '16:9',
 *   priority: 5,
 * });
 *
 * // Check job status
 * const status = await getJobStatus(job.id);
 *
 * // Get queue metrics
 * const metrics = await getQueueMetrics();
 *
 * // Start the worker (typically in a separate process)
 * const worker = createVideoGenerationWorker();
 * ```
 */

// Queue functions
export {
  createVideoGenerationQueue,
  resetQueue,
  addVideoGenerationJob,
  getJobStatus,
  getJob,
  cancelVideoGenerationJob,
  getQueueMetrics,
  pauseQueue,
  resumeQueue,
  cleanQueue,
} from './video-generation-queue';

// Worker functions
export {
  createVideoGenerationWorker,
  stopWorker,
  pauseWorker,
  resumeWorker,
  isWorkerRunning,
  getWorker,
  resetWorker,
} from './worker';

// Processor functions and errors
export {
  processVideoGenerationJob,
  onJobCompleted,
  onJobFailed,
  onWorkerError,
  RateLimitExceededError,
  ProviderApiError,
} from './processor';

// Types
export type {
  VideoGenerationJobData,
  VideoGenerationJobResult,
  QueueJobStatus,
  QueueMetrics,
  AddJobOptions,
} from './types';

// Schemas
export { VideoGenerationJobSchema } from './types';

// Configuration
export {
  QUEUE_NAME,
  PROVIDER_CONCURRENCY_LIMITS,
  DEFAULT_JOB_OPTIONS,
  MAX_RETRY_ATTEMPTS,
  RETRY_DELAYS,
  getRedisConnection,
  getQueueConfig,
  getWorkerConfig,
  getQueueConcurrency,
  getQueueRateLimitConfig,
} from './config';
