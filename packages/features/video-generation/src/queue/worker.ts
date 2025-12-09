'server-only';

import { Worker } from 'bullmq';

import { QUEUE_NAME, getWorkerConfig } from './config';
import {
  onJobCompleted,
  onJobFailed,
  onWorkerError,
  processVideoGenerationJob,
} from './processor';
import type { VideoGenerationJobData, VideoGenerationJobResult } from './types';

/**
 * Singleton worker instance
 */
let workerInstance: Worker<
  VideoGenerationJobData,
  VideoGenerationJobResult
> | null = null;

/**
 * Create the video generation worker
 *
 * The worker processes jobs from the queue with:
 * - Configurable concurrency (default: 10)
 * - Rate limiting (default: 10 jobs/second)
 * - Automatic retry with exponential backoff
 * - Event handlers for completion, failure, and errors
 *
 * @returns The worker instance
 */
export function createVideoGenerationWorker(): Worker<
  VideoGenerationJobData,
  VideoGenerationJobResult
> {
  if (workerInstance) {
    return workerInstance;
  }

  const config = getWorkerConfig();

  workerInstance = new Worker<VideoGenerationJobData, VideoGenerationJobResult>(
    QUEUE_NAME,
    async (job) => {
      return processVideoGenerationJob(job);
    },
    config,
  );

  // Event handlers
  workerInstance.on('completed', (job, result) => {
    onJobCompleted(job, result);
  });

  workerInstance.on('failed', (job, error) => {
    onJobFailed(job, error);
  });

  workerInstance.on('error', (error) => {
    onWorkerError(error);
  });

  // Log worker startup
  workerInstance.on('ready', () => {
    console.log('[VideoQueue] Worker ready:', {
      queueName: QUEUE_NAME,
      concurrency: config.concurrency,
    });
  });

  // Log when worker starts processing
  workerInstance.on('active', (job) => {
    console.log('[VideoQueue] Job active:', {
      jobId: job.id,
      accountId: job.data.accountId,
      provider: job.data.provider,
    });
  });

  // Log stalled jobs (took too long)
  workerInstance.on('stalled', (jobId) => {
    console.warn('[VideoQueue] Job stalled:', { jobId });
  });

  console.log('[VideoQueue] Worker initialized:', { queueName: QUEUE_NAME });

  return workerInstance;
}

/**
 * Stop the worker gracefully
 *
 * @param force - If true, force close without waiting for jobs
 */
export async function stopWorker(force = false): Promise<void> {
  if (!workerInstance) {
    return;
  }

  console.log('[VideoQueue] Stopping worker...', { force });

  await workerInstance.close(force);
  workerInstance = null;

  console.log('[VideoQueue] Worker stopped');
}

/**
 * Pause the worker (stops processing new jobs)
 */
export async function pauseWorker(): Promise<void> {
  if (!workerInstance) {
    throw new Error('Worker not initialized');
  }

  await workerInstance.pause();
  console.log('[VideoQueue] Worker paused');
}

/**
 * Resume the worker
 */
export async function resumeWorker(): Promise<void> {
  if (!workerInstance) {
    throw new Error('Worker not initialized');
  }

  workerInstance.resume();
  console.log('[VideoQueue] Worker resumed');
}

/**
 * Check if worker is running
 */
export function isWorkerRunning(): boolean {
  return workerInstance !== null && workerInstance.isRunning();
}

/**
 * Get worker instance (for testing/monitoring)
 */
export function getWorker(): Worker<
  VideoGenerationJobData,
  VideoGenerationJobResult
> | null {
  return workerInstance;
}

/**
 * Reset worker instance (for testing)
 */
export async function resetWorker(): Promise<void> {
  await stopWorker(true);
}
