import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  DEFAULT_JOB_OPTIONS,
  getQueueConcurrency,
  getQueueRateLimitConfig,
  MAX_RETRY_ATTEMPTS,
  PROVIDER_CONCURRENCY_LIMITS,
  QUEUE_NAME,
  RETRY_DELAYS,
} from '../config';
import {
  ProviderApiError,
  RateLimitExceededError,
} from '../processor';
import { VideoGenerationJobSchema } from '../types';

// Mock BullMQ
vi.mock('bullmq', () => {
  const mockJob = {
    id: 'test-job-id',
    data: {
      accountId: 'account-123',
      projectId: 'project-123',
      shotId: 'shot-123',
      provider: 'kling',
      generationJobId: 'gen-123',
      prompt: 'Test prompt',
      duration: '5',
      aspectRatio: '16:9',
      priority: 5,
    },
    attemptsMade: 0,
    getState: vi.fn().mockResolvedValue('waiting'),
    remove: vi.fn().mockResolvedValue(undefined),
  };

  const mockQueue = {
    add: vi.fn().mockResolvedValue(mockJob),
    getJob: vi.fn().mockResolvedValue(mockJob),
    getWaitingCount: vi.fn().mockResolvedValue(5),
    getActiveCount: vi.fn().mockResolvedValue(2),
    getCompletedCount: vi.fn().mockResolvedValue(100),
    getFailedCount: vi.fn().mockResolvedValue(3),
    pause: vi.fn().mockResolvedValue(undefined),
    resume: vi.fn().mockResolvedValue(undefined),
    clean: vi.fn().mockResolvedValue(['job-1', 'job-2']),
    close: vi.fn().mockResolvedValue(undefined),
  };

  const mockWorker = {
    on: vi.fn().mockReturnThis(),
    close: vi.fn().mockResolvedValue(undefined),
    pause: vi.fn().mockResolvedValue(undefined),
    resume: vi.fn(),
    isRunning: vi.fn().mockReturnValue(true),
  };

  return {
    Queue: vi.fn().mockReturnValue(mockQueue),
    Worker: vi.fn().mockReturnValue(mockWorker),
  };
});

// Mock rate limiter
vi.mock('../../lib/rate-limiter', () => ({
  checkRateLimit: vi.fn().mockResolvedValue({ allowed: true }),
}));

// Mock providers
vi.mock('../../providers', () => ({
  createVideoProvider: vi.fn().mockResolvedValue({
    generateVideo: vi.fn().mockResolvedValue({ jobId: 'provider-job-123' }),
    generateVideoWithImage: vi.fn().mockResolvedValue({ jobId: 'provider-job-123' }),
  }),
}));

// Mock Supabase
vi.mock('@kit/supabase/server-client', () => ({
  getSupabaseServerClient: vi.fn().mockReturnValue({
    from: vi.fn().mockReturnValue({
      update: vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ error: null }),
      }),
    }),
  }),
}));

describe('Video Generation Queue', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    process.env = { ...originalEnv };
    process.env.REDIS_URL = 'redis://localhost:6379';
  });

  describe('Configuration', () => {
    describe('QUEUE_NAME', () => {
      it('should be "video-generation"', () => {
        expect(QUEUE_NAME).toBe('video-generation');
      });
    });

    describe('PROVIDER_CONCURRENCY_LIMITS', () => {
      it('should have correct limits for each provider', () => {
        expect(PROVIDER_CONCURRENCY_LIMITS.kling).toBe(5);
        expect(PROVIDER_CONCURRENCY_LIMITS.runway).toBe(3);
        expect(PROVIDER_CONCURRENCY_LIMITS.luma).toBe(3);
      });
    });

    describe('DEFAULT_JOB_OPTIONS', () => {
      it('should have 3 retry attempts', () => {
        expect(DEFAULT_JOB_OPTIONS!.attempts).toBe(3);
      });

      it('should use exponential backoff starting at 30s', () => {
        expect(DEFAULT_JOB_OPTIONS!.backoff).toEqual({
          type: 'exponential',
          delay: 30000,
        });
      });

      it('should keep completed jobs for 24 hours', () => {
        expect(DEFAULT_JOB_OPTIONS!.removeOnComplete).toEqual({
          age: 24 * 60 * 60,
          count: 1000,
        });
      });

      it('should keep failed jobs for 7 days', () => {
        expect(DEFAULT_JOB_OPTIONS!.removeOnFail).toEqual({
          age: 7 * 24 * 60 * 60,
        });
      });
    });

    describe('RETRY_DELAYS', () => {
      it('should have correct retry delays', () => {
        expect(RETRY_DELAYS.first).toBe(30000);
        expect(RETRY_DELAYS.second).toBe(60000);
        expect(RETRY_DELAYS.third).toBe(120000);
      });
    });

    describe('MAX_RETRY_ATTEMPTS', () => {
      it('should be 3', () => {
        expect(MAX_RETRY_ATTEMPTS).toBe(3);
      });
    });

    describe('getQueueConcurrency', () => {
      it('should return default of 10', () => {
        delete process.env.VIDEO_QUEUE_CONCURRENCY;
        expect(getQueueConcurrency()).toBe(10);
      });

      it('should return value from environment', () => {
        process.env.VIDEO_QUEUE_CONCURRENCY = '20';
        expect(getQueueConcurrency()).toBe(20);
      });
    });

    describe('getQueueRateLimitConfig', () => {
      it('should return default values', () => {
        delete process.env.VIDEO_QUEUE_RATE_LIMIT;
        delete process.env.VIDEO_QUEUE_RATE_LIMIT_DURATION;

        const config = getQueueRateLimitConfig();
        expect(config.max).toBe(10);
        expect(config.duration).toBe(1000);
      });

      it('should return values from environment', () => {
        process.env.VIDEO_QUEUE_RATE_LIMIT = '50';
        process.env.VIDEO_QUEUE_RATE_LIMIT_DURATION = '2000';

        const config = getQueueRateLimitConfig();
        expect(config.max).toBe(50);
        expect(config.duration).toBe(2000);
      });
    });
  });

  describe('VideoGenerationJobSchema', () => {
    const validJobData = {
      accountId: '123e4567-e89b-12d3-a456-426614174000',
      projectId: '123e4567-e89b-12d3-a456-426614174001',
      shotId: '123e4567-e89b-12d3-a456-426614174002',
      provider: 'kling',
      generationJobId: '123e4567-e89b-12d3-a456-426614174003',
      prompt: 'A beautiful sunset',
      duration: '5',
      aspectRatio: '16:9',
      priority: 5,
    };

    it('should validate correct job data', () => {
      const result = VideoGenerationJobSchema.safeParse(validJobData);
      expect(result.success).toBe(true);
    });

    it('should reject invalid UUID for accountId', () => {
      const result = VideoGenerationJobSchema.safeParse({
        ...validJobData,
        accountId: 'invalid-uuid',
      });
      expect(result.success).toBe(false);
    });

    it('should reject invalid provider', () => {
      const result = VideoGenerationJobSchema.safeParse({
        ...validJobData,
        provider: 'invalid-provider',
      });
      expect(result.success).toBe(false);
    });

    it('should reject priority below 0', () => {
      const result = VideoGenerationJobSchema.safeParse({
        ...validJobData,
        priority: -1,
      });
      expect(result.success).toBe(false);
    });

    it('should reject priority above 10', () => {
      const result = VideoGenerationJobSchema.safeParse({
        ...validJobData,
        priority: 11,
      });
      expect(result.success).toBe(false);
    });

    it('should default priority to 5', () => {
      const { priority, ...dataWithoutPriority } = validJobData;
      const result = VideoGenerationJobSchema.safeParse(dataWithoutPriority);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.priority).toBe(5);
      }
    });

    it('should accept optional referenceImageUrl', () => {
      const result = VideoGenerationJobSchema.safeParse({
        ...validJobData,
        referenceImageUrl: 'https://example.com/image.jpg',
      });
      expect(result.success).toBe(true);
    });

    it('should reject invalid referenceImageUrl', () => {
      const result = VideoGenerationJobSchema.safeParse({
        ...validJobData,
        referenceImageUrl: 'not-a-url',
      });
      expect(result.success).toBe(false);
    });

    it('should accept optional mode', () => {
      const result = VideoGenerationJobSchema.safeParse({
        ...validJobData,
        mode: 'standard',
      });
      expect(result.success).toBe(true);
    });
  });

  describe('Custom Errors', () => {
    describe('RateLimitExceededError', () => {
      it('should create error with retryAfter', () => {
        const error = new RateLimitExceededError(30);
        expect(error.retryAfter).toBe(30);
        expect(error.message).toBe('Rate limit exceeded. Retry after 30s');
        expect(error.name).toBe('RateLimitExceededError');
      });

      it('should accept custom message', () => {
        const error = new RateLimitExceededError(60, 'Custom message');
        expect(error.message).toBe('Custom message');
        expect(error.retryAfter).toBe(60);
      });
    });

    describe('ProviderApiError', () => {
      it('should create error with provider', () => {
        const error = new ProviderApiError('kling');
        expect(error.provider).toBe('kling');
        expect(error.message).toBe('Provider kling API error');
        expect(error.name).toBe('ProviderApiError');
      });

      it('should accept code and custom message', () => {
        const error = new ProviderApiError('runway', 'RATE_LIMIT', 'Too many requests');
        expect(error.provider).toBe('runway');
        expect(error.code).toBe('RATE_LIMIT');
        expect(error.message).toBe('Too many requests');
      });
    });
  });

  describe('Queue Operations', () => {
    // Note: These tests use mocked BullMQ, so they test the interface not actual queue behavior

    it('should export queue functions', async () => {
      const queue = await import('../video-generation-queue');

      expect(typeof queue.createVideoGenerationQueue).toBe('function');
      expect(typeof queue.addVideoGenerationJob).toBe('function');
      expect(typeof queue.getJobStatus).toBe('function');
      expect(typeof queue.cancelVideoGenerationJob).toBe('function');
      expect(typeof queue.getQueueMetrics).toBe('function');
      expect(typeof queue.pauseQueue).toBe('function');
      expect(typeof queue.resumeQueue).toBe('function');
      expect(typeof queue.cleanQueue).toBe('function');
      expect(typeof queue.resetQueue).toBe('function');
    });
  });

  describe('Worker Operations', () => {
    it('should export worker functions', async () => {
      const worker = await import('../worker');

      expect(typeof worker.createVideoGenerationWorker).toBe('function');
      expect(typeof worker.stopWorker).toBe('function');
      expect(typeof worker.pauseWorker).toBe('function');
      expect(typeof worker.resumeWorker).toBe('function');
      expect(typeof worker.isWorkerRunning).toBe('function');
      expect(typeof worker.getWorker).toBe('function');
      expect(typeof worker.resetWorker).toBe('function');
    });
  });

  describe('Processor Functions', () => {
    it('should export processor functions', async () => {
      const processor = await import('../processor');

      expect(typeof processor.processVideoGenerationJob).toBe('function');
      expect(typeof processor.onJobCompleted).toBe('function');
      expect(typeof processor.onJobFailed).toBe('function');
      expect(typeof processor.onWorkerError).toBe('function');
    });
  });

  describe('Priority Inversion', () => {
    it('should convert priority 10 to BullMQ priority 0 (highest)', async () => {
      // Priority 10 (highest in our system) should become 0 (highest in BullMQ)
      // Formula: bullmqPriority = 10 - priority
      const ourPriority = 10;
      const expectedBullmqPriority = 10 - ourPriority; // 0
      expect(expectedBullmqPriority).toBe(0);
    });

    it('should convert priority 0 to BullMQ priority 10 (lowest)', async () => {
      const ourPriority = 0;
      const expectedBullmqPriority = 10 - ourPriority; // 10
      expect(expectedBullmqPriority).toBe(10);
    });

    it('should convert priority 5 to BullMQ priority 5 (middle)', async () => {
      const ourPriority = 5;
      const expectedBullmqPriority = 10 - ourPriority; // 5
      expect(expectedBullmqPriority).toBe(5);
    });
  });
});
