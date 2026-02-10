/**
 * Worker Manager
 *
 * Manages BullMQ workers for processing background jobs.
 */

import 'server-only';

import { Worker, type Job } from 'bullmq';

import { getRedisConnection } from '../queues/connection';
import { QueueName, type JobData, type JobResult } from '../queues/definitions';

/**
 * Active workers
 */
const activeWorkers = new Map<QueueName, Worker>();

/**
 * Worker status
 */
interface WorkerStatus {
    name: QueueName;
    running: boolean;
    processed: number;
    failed: number;
}

const workerStats = new Map<QueueName, { processed: number; failed: number }>();

/**
 * Worker processor functions
 */
type WorkerProcessor<T extends QueueName> = (
    job: Job<JobData[T]>,
) => Promise<JobResult[T]>;

/**
 * Get processor for a queue
 */
async function getProcessor<T extends QueueName>(
    queueName: T,
): Promise<WorkerProcessor<T> | null> {
    switch (queueName) {
        case QueueName.ANALYTICS_SYNC:
            return async (job) => {
                console.log(`[Worker] Processing analytics sync: ${job.id}`);
                const { syncSinglePublishById } = await import(
                    '@kit/content-analytics/server'
                );
                // Type assertion for the analytics sync job data
                const data = job.data as JobData['analytics-sync'];
                const result = await syncSinglePublishById(data.publishId);
                return {
                    views: 0,
                    likes: 0,
                    synced: result.success,
                } as JobResult[T];
            };

        default:
            return null;
    }
}

/**
 * Start a worker for a specific queue
 */
export async function startWorker(queueName: QueueName): Promise<boolean> {
    const connection = getRedisConnection();

    if (!connection) {
        console.warn(`[Workers] Cannot start worker for "${queueName}" - Redis not available`);
        return false;
    }

    if (activeWorkers.has(queueName)) {
        console.warn(`[Workers] Worker for "${queueName}" is already running`);
        return true;
    }

    const processor = await getProcessor(queueName);

    if (!processor) {
        console.error(`[Workers] No processor found for queue "${queueName}"`);
        return false;
    }

    const worker = new Worker(
        queueName,
        async (job) => {
            const stats = workerStats.get(queueName) || { processed: 0, failed: 0 };

            try {
                const result = await processor(job as Job<JobData[typeof queueName]>);
                workerStats.set(queueName, { ...stats, processed: stats.processed + 1 });
                return result;
            } catch (error) {
                workerStats.set(queueName, { ...stats, failed: stats.failed + 1 });
                throw error;
            }
        },
        {
            connection,
            concurrency: 2, // Process 2 jobs concurrently
        },
    );

    worker.on('completed', (job) => {
        console.log(`[Workers] Job ${job.id} completed on "${queueName}"`);
    });

    worker.on('failed', (job, err) => {
        console.error(`[Workers] Job ${job?.id} failed on "${queueName}":`, err.message);
    });

    worker.on('error', (err) => {
        console.error(`[Workers] Worker error on "${queueName}":`, err.message);
    });

    activeWorkers.set(queueName, worker);
    workerStats.set(queueName, { processed: 0, failed: 0 });
    console.log(`[Workers] Started worker for "${queueName}"`);

    return true;
}

/**
 * Start all workers
 */
export async function startWorkers(): Promise<void> {
    console.log('[Workers] Starting all workers...');

    const queues = Object.values(QueueName);

    for (const queueName of queues) {
        await startWorker(queueName);
    }
}

/**
 * Stop a specific worker
 */
export async function stopWorker(queueName: QueueName): Promise<void> {
    const worker = activeWorkers.get(queueName);

    if (worker) {
        await worker.close();
        activeWorkers.delete(queueName);
        console.log(`[Workers] Stopped worker for "${queueName}"`);
    }
}

/**
 * Stop all workers
 */
export async function stopWorkers(): Promise<void> {
    console.log(`[Workers] Stopping ${activeWorkers.size} workers...`);

    for (const [name, worker] of activeWorkers) {
        await worker.close();
        console.log(`[Workers] Stopped worker: ${name}`);
    }

    activeWorkers.clear();
}

/**
 * Get status of all workers
 */
export function getWorkerStatus(): WorkerStatus[] {
    const queues = Object.values(QueueName);

    return queues.map((queueName) => {
        const stats = workerStats.get(queueName) || { processed: 0, failed: 0 };
        const worker = activeWorkers.get(queueName);

        return {
            name: queueName,
            running: !!worker,
            processed: stats.processed,
            failed: stats.failed,
        };
    });
}
