'server-only';

import { type Job, Queue } from 'bullmq';

import { QUEUE_NAME, getQueueConfig } from './config';
import type {
  AddJobOptions,
  QueueJobStatus,
  QueueMetrics,
  VideoGenerationJobData,
  VideoGenerationJobResult,
} from './types';
import { VideoGenerationJobSchema } from './types';

/**
 * Singleton queue instance
 */
let queueInstance: Queue<
  VideoGenerationJobData,
  VideoGenerationJobResult
> | null = null;

/**
 * Create or get the video generation queue instance
 * Uses singleton pattern to reuse connections
 */
export function createVideoGenerationQueue(): Queue<
  VideoGenerationJobData,
  VideoGenerationJobResult
> {
  if (queueInstance) {
    return queueInstance;
  }

  const config = getQueueConfig();

  queueInstance = new Queue<VideoGenerationJobData, VideoGenerationJobResult>(
    QUEUE_NAME,
    config,
  );

  console.log('[VideoQueue] Queue initialized:', { queueName: QUEUE_NAME });

  return queueInstance;
}

/**
 * Reset queue instance (for testing)
 */
export async function resetQueue(): Promise<void> {
  if (queueInstance) {
    await queueInstance.close();
    queueInstance = null;
  }
}

/**
 * Add a video generation job to the queue
 *
 * @param data - Job data to process
 * @param options - Additional job options
 * @returns The created job
 */
export async function addVideoGenerationJob(
  data: VideoGenerationJobData,
  options?: AddJobOptions,
): Promise<Job<VideoGenerationJobData, VideoGenerationJobResult>> {
  const queue = createVideoGenerationQueue();

  // Validate job data
  const validated = VideoGenerationJobSchema.parse(data);

  // BullMQ uses lower number = higher priority
  // We invert our priority (0-10) so that 10 becomes 0 (highest)
  const priority = options?.priority ?? validated.priority;
  const bullmqPriority = 10 - priority;

  const job = await queue.add('generate-video', validated, {
    priority: bullmqPriority,
    jobId: options?.jobId ?? validated.generationJobId,
    delay: options?.delay,
  });

  console.log('[VideoQueue] Job added to queue:', {
    jobId: job.id,
    accountId: validated.accountId,
    provider: validated.provider,
    priority,
  });

  return job;
}

/**
 * Get the status of a job
 *
 * @param jobId - The job ID to check
 * @returns The job status
 */
export async function getJobStatus(jobId: string): Promise<QueueJobStatus> {
  const queue = createVideoGenerationQueue();
  const job = await queue.getJob(jobId);

  if (!job) {
    return 'unknown';
  }

  const state = await job.getState();

  switch (state) {
    case 'waiting':
    case 'delayed':
    case 'prioritized':
      return 'queued';
    case 'active':
      return 'processing';
    case 'completed':
      return 'completed';
    case 'failed':
      return 'failed';
    default:
      return 'unknown';
  }
}

/**
 * Get a job by ID
 *
 * @param jobId - The job ID to retrieve
 * @returns The job or null if not found
 */
export async function getJob(
  jobId: string,
): Promise<Job<VideoGenerationJobData, VideoGenerationJobResult> | null> {
  const queue = createVideoGenerationQueue();
  const job = await queue.getJob(jobId);
  return job ?? null;
}

/**
 * Cancel a video generation job
 *
 * @param jobId - The job ID to cancel
 * @throws Error if job not found
 */
export async function cancelVideoGenerationJob(jobId: string): Promise<void> {
  const queue = createVideoGenerationQueue();
  const job = await queue.getJob(jobId);

  if (!job) {
    throw new Error(`Job not found: ${jobId}`);
  }

  const state = await job.getState();

  // Can only remove jobs that are waiting or delayed
  if (state === 'active') {
    throw new Error(`Cannot cancel active job: ${jobId}`);
  }

  await job.remove();

  console.log('[VideoQueue] Job cancelled:', { jobId });
}

/**
 * Get queue metrics for monitoring
 *
 * @returns Current queue statistics
 */
export async function getQueueMetrics(): Promise<QueueMetrics> {
  const queue = createVideoGenerationQueue();

  const [waiting, active, completed, failed] = await Promise.all([
    queue.getWaitingCount(),
    queue.getActiveCount(),
    queue.getCompletedCount(),
    queue.getFailedCount(),
  ]);

  return {
    waiting,
    active,
    completed,
    failed,
    total: waiting + active,
  };
}

/**
 * Pause the queue (stops processing new jobs)
 */
export async function pauseQueue(): Promise<void> {
  const queue = createVideoGenerationQueue();
  await queue.pause();
  console.log('[VideoQueue] Queue paused');
}

/**
 * Resume the queue
 */
export async function resumeQueue(): Promise<void> {
  const queue = createVideoGenerationQueue();
  await queue.resume();
  console.log('[VideoQueue] Queue resumed');
}

/**
 * Clean old jobs from the queue
 *
 * @param grace - Grace period in milliseconds
 * @param limit - Maximum number of jobs to clean
 * @param status - Job status to clean ('completed' | 'failed')
 */
export async function cleanQueue(
  grace: number = 0,
  limit: number = 1000,
  status: 'completed' | 'failed' = 'completed',
): Promise<string[]> {
  const queue = createVideoGenerationQueue();
  return queue.clean(grace, limit, status);
}
