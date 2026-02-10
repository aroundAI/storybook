/**
 * Jobs Package Tests
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';

// Mock server-only
vi.mock('server-only', () => ({}));

// Mock ioredis
vi.mock('ioredis', () => {
    return {
        default: vi.fn().mockImplementation(() => ({
            on: vi.fn(),
            ping: vi.fn().mockResolvedValue('PONG'),
            quit: vi.fn().mockResolvedValue(undefined),
        })),
    };
});

// Mock bullmq
vi.mock('bullmq', () => ({
    Queue: vi.fn().mockImplementation(() => ({
        add: vi.fn().mockResolvedValue({ id: 'test-job-id' }),
        close: vi.fn(),
        getWaitingCount: vi.fn().mockResolvedValue(0),
        getActiveCount: vi.fn().mockResolvedValue(0),
        getCompletedCount: vi.fn().mockResolvedValue(0),
        getFailedCount: vi.fn().mockResolvedValue(0),
    })),
    Worker: vi.fn().mockImplementation(() => ({
        on: vi.fn(),
        close: vi.fn(),
    })),
}));

// Mock node-cron
vi.mock('node-cron', () => ({
    default: {
        validate: vi.fn().mockReturnValue(true),
        schedule: vi.fn().mockReturnValue({
            stop: vi.fn(),
        }),
    },
}));

describe('Queue Definitions', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.resetModules();
    });

    it('should export QueueName constants', async () => {
        const { QueueName } = await import('../src/queues/definitions');
        expect(QueueName.ANALYTICS_SYNC).toBe('analytics-sync');
    });
});

describe('Cron Scheduler', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.resetModules();
    });

    it('should export cron functions', async () => {
        const { startCronJobs, stopCronJobs, getCronStatus } = await import(
            '../src/cron/scheduler'
        );
        expect(startCronJobs).toBeDefined();
        expect(stopCronJobs).toBeDefined();
        expect(getCronStatus).toBeDefined();
    });

    it('should return cron status', async () => {
        const { getCronStatus } = await import('../src/cron/scheduler');
        const status = getCronStatus();
        expect(Array.isArray(status)).toBe(true);
        expect(status.length).toBeGreaterThan(0);
        expect(status[0]).toHaveProperty('name');
        expect(status[0]).toHaveProperty('schedule');
        expect(status[0]).toHaveProperty('enabled');
    });
});

describe('Worker Manager', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.resetModules();
    });

    it('should export worker functions', async () => {
        const { startWorkers, stopWorkers, getWorkerStatus } = await import(
            '../src/workers/manager'
        );
        expect(startWorkers).toBeDefined();
        expect(stopWorkers).toBeDefined();
        expect(getWorkerStatus).toBeDefined();
    });

    it('should return worker status', async () => {
        const { getWorkerStatus } = await import('../src/workers/manager');
        const status = getWorkerStatus();
        expect(Array.isArray(status)).toBe(true);
    });
});
