/**
 * Redis Connection Manager
 *
 * Manages a single Redis connection for all queues and workers.
 * Falls back gracefully when Redis is not available.
 */

import 'server-only';

import Redis from 'ioredis';

let redisConnection: Redis | null = null;
let connectionChecked = false;
let isAvailable = false;

/**
 * Redis connection options
 */
const REDIS_OPTIONS = {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
    password: process.env.REDIS_PASSWORD || undefined,
    maxRetriesPerRequest: null, // Required for BullMQ
    enableReadyCheck: false,
    retryStrategy: (times: number) => {
        if (times > 3) {
            console.warn('[Jobs] Redis connection failed after 3 retries');
            return null; // Stop retrying
        }
        return Math.min(times * 100, 3000);
    },
};

/**
 * Get or create the Redis connection
 */
export function getRedisConnection(): Redis | null {
    if (redisConnection) {
        return redisConnection;
    }

    // Skip if we've already checked and Redis is unavailable
    if (connectionChecked && !isAvailable) {
        return null;
    }

    try {
        redisConnection = new Redis(REDIS_OPTIONS);

        redisConnection.on('connect', () => {
            console.log('[Jobs] Connected to Redis');
            isAvailable = true;
            connectionChecked = true;
        });

        redisConnection.on('error', (err) => {
            console.warn('[Jobs] Redis connection error:', err.message);
            isAvailable = false;
            connectionChecked = true;
        });

        redisConnection.on('close', () => {
            console.log('[Jobs] Redis connection closed');
            isAvailable = false;
        });

        return redisConnection;
    } catch (error) {
        console.warn('[Jobs] Failed to create Redis connection:', error);
        connectionChecked = true;
        isAvailable = false;
        return null;
    }
}

/**
 * Check if Redis is available
 */
export async function isRedisAvailable(): Promise<boolean> {
    if (connectionChecked) {
        return isAvailable;
    }

    const connection = getRedisConnection();
    if (!connection) {
        return false;
    }

    try {
        await connection.ping();
        isAvailable = true;
        connectionChecked = true;
        return true;
    } catch {
        isAvailable = false;
        connectionChecked = true;
        return false;
    }
}

/**
 * Close the Redis connection
 */
export async function closeRedisConnection(): Promise<void> {
    if (redisConnection) {
        await redisConnection.quit();
        redisConnection = null;
        isAvailable = false;
        connectionChecked = false;
    }
}

/**
 * Reset connection state (for testing)
 */
export function resetConnectionState(): void {
    connectionChecked = false;
    isAvailable = false;
}
