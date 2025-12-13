/**
 * Queue Definitions
 *
 * Defines all job queues used in the application.
 */

import 'server-only';

import { Queue } from 'bullmq';

import { getRedisConnection } from './connection';

/**
 * Available queue names
 */
export const QueueName = {
    VIDEO_GENERATION: 'video-generation',
    AUDIO_GENERATION: 'audio-generation',
    ANALYTICS_SYNC: 'analytics-sync',
    IMAGE_PROCESSING: 'image-processing',
} as const;

export type QueueName = (typeof QueueName)[keyof typeof QueueName];

/**
 * Job data types for each queue
 */
export interface JobData {
    'video-generation': {
        shotId: string;
        episodeId: string;
        prompt: string;
        provider: 'runway' | 'flux' | 'kling';
    };
    'audio-generation': {
        sceneId: string;
        episodeId: string;
        type: 'voice' | 'music' | 'sfx';
        text?: string;
        voiceId?: string;
    };
    'analytics-sync': {
        publishId: string;
        platform: 'youtube' | 'tiktok' | 'instagram';
    };
    'image-processing': {
        assetId: string;
        operation: 'resize' | 'thumbnail' | 'optimize';
        options: Record<string, unknown>;
    };
}

/**
 * Job result types
 */
export interface JobResult {
    'video-generation': {
        videoUrl: string;
        duration: number;
    };
    'audio-generation': {
        audioUrl: string;
        duration: number;
    };
    'analytics-sync': {
        views: number;
        likes: number;
        synced: boolean;
    };
    'image-processing': {
        outputUrl: string;
        size: number;
    };
}

// Queue cache
const queues = new Map<QueueName, Queue>();

/**
 * Get or create a queue
 */
export function getQueue<T extends QueueName>(name: T): Queue<JobData[T]> | null {
    const connection = getRedisConnection();

    if (!connection) {
        console.warn(`[Jobs] Cannot create queue "${name}" - Redis not available`);
        return null;
    }

    if (queues.has(name)) {
        return queues.get(name) as Queue<JobData[T]>;
    }

    const queue = new Queue<JobData[T]>(name, {
        connection,
        defaultJobOptions: {
            attempts: 3,
            backoff: {
                type: 'exponential',
                delay: 1000,
            },
            removeOnComplete: {
                age: 24 * 3600, // Keep completed jobs for 24 hours
                count: 1000, // Keep last 1000 completed jobs
            },
            removeOnFail: {
                age: 7 * 24 * 3600, // Keep failed jobs for 7 days
            },
        },
    });

    queues.set(name, queue as Queue);
    return queue;
}

/**
 * Create a queue (alias for getQueue)
 */
export function createQueue<T extends QueueName>(name: T): Queue<JobData[T]> | null {
    return getQueue(name);
}

/**
 * Add a job to a queue
 */
export async function addJob<T extends QueueName>(
    queueName: T,
    data: JobData[T],
    options?: { priority?: number; delay?: number },
): Promise<string | null> {
    const queue = getQueue(queueName);

    if (!queue) {
        console.warn(`[Jobs] Cannot add job to "${queueName}" - queue not available`);
        return null;
    }

    // Cast queue to any to work around BullMQ's strict generic constraints
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const anyQueue = queue as any;
    const job = await anyQueue.add('job', data, {
        priority: options?.priority,
        delay: options?.delay,
    });

    console.log(`[Jobs] Added job ${job.id} to queue "${queueName}"`);
    return job.id ?? null;
}

/**
 * Get queue statistics
 */
export async function getQueueStats(
    queueName: QueueName,
): Promise<{ waiting: number; active: number; completed: number; failed: number } | null> {
    const queue = getQueue(queueName);

    if (!queue) {
        return null;
    }

    const [waiting, active, completed, failed] = await Promise.all([
        queue.getWaitingCount(),
        queue.getActiveCount(),
        queue.getCompletedCount(),
        queue.getFailedCount(),
    ]);

    return { waiting, active, completed, failed };
}

/**
 * Close all queues
 */
export async function closeAllQueues(): Promise<void> {
    for (const queue of queues.values()) {
        await queue.close();
    }
    queues.clear();
}
