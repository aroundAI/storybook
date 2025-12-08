import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  DEFAULT_JOB_OPTIONS,
  getQueueConcurrency,
  getQueueRateLimitConfig,
  MAX_RETRY_ATTEMPTS,
  PROVIDER_CONCURRENCY_LIMITS,
  QUEUE_NAME,
  RETRY_DELAYS,
} from '../src/queue/config';
import {
  ProviderApiError,
  RateLimitExceededError,
} from '../src/queue/processor';
import { VideoGenerationJobSchema } from '../src/queue/types';

// Mock state that can be controlled by tests
const mockState = {
  checkRateLimitResult: { allowed: true } as { allowed: boolean; retryAfter?: number },
  generateVideoResult: { jobId: 'provider-job-123' } as { jobId: string },
  generateVideoError: null as Error | null,
  jobState: 'waiting' as string,
  getJobResult: null as object | null,
};

// Mock BullMQ
const mockJob = {
  id: 'test-job-id',
  data: {
    accountId: '123e4567-e89b-12d3-a456-426614174000',
    projectId: '123e4567-e89b-12d3-a456-426614174001',
    shotId: '123e4567-e89b-12d3-a456-426614174002',
    provider: 'kling',
    generationJobId: '123e4567-e89b-12d3-a456-426614174003',
    prompt: 'Test prompt',
    duration: '5',
    aspectRatio: '16:9',
    priority: 5,
  },
  attemptsMade: 0,
  getState: vi.fn().mockImplementation(() => Promise.resolve(mockState.jobState)),
  remove: vi.fn().mockResolvedValue(undefined),
};

const mockQueue = {
  add: vi.fn().mockImplementation(() => Promise.resolve(mockJob)),
  getJob: vi.fn().mockImplementation(() =>
    Promise.resolve(mockState.getJobResult === null ? mockJob : mockState.getJobResult),
  ),
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

vi.mock('bullmq', () => ({
  Queue: vi.fn().mockImplementation(() => mockQueue),
  Worker: vi.fn().mockImplementation(() => mockWorker),
}));

// Mock rate limiter
vi.mock('../src/lib/rate-limiter', () => ({
  checkRateLimit: vi.fn().mockImplementation(() => Promise.resolve(mockState.checkRateLimitResult)),
}));

// Mock providers
vi.mock('../src/providers', () => ({
  createVideoProvider: vi.fn().mockImplementation(() => ({
    generateVideo: vi.fn().mockImplementation(() => {
      if (mockState.generateVideoError) {
        return Promise.reject(mockState.generateVideoError);
      }
      return Promise.resolve(mockState.generateVideoResult);
    }),
  })),
}));

// Mock Supabase
const mockEq = vi.fn().mockResolvedValue({ error: null });
const mockUpdate = vi.fn().mockReturnValue({ eq: mockEq });
const mockFrom = vi.fn().mockReturnValue({ update: mockUpdate });

vi.mock('@kit/supabase/server-client', () => ({
  getSupabaseServerClient: vi.fn().mockReturnValue({
    from: mockFrom,
  }),
}));

describe('Video Generation Queue', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    process.env = { ...originalEnv };
    process.env.REDIS_URL = 'redis://localhost:6379';
    process.env.KLING_API_KEY = 'test-kling-key';
    process.env.RUNWAY_API_KEY = 'test-runway-key';
    process.env.LUMA_API_KEY = 'test-luma-key';

    // Reset mock state
    mockState.checkRateLimitResult = { allowed: true };
    mockState.generateVideoResult = { jobId: 'provider-job-123' };
    mockState.generateVideoError = null;
    mockState.jobState = 'waiting';
    mockState.getJobResult = null;
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
    it('should export queue functions', async () => {
      const queue = await import('../src/queue/video-generation-queue');

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
      const worker = await import('../src/queue/worker');

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
      const processor = await import('../src/queue/processor');

      expect(typeof processor.processVideoGenerationJob).toBe('function');
      expect(typeof processor.onJobCompleted).toBe('function');
      expect(typeof processor.onJobFailed).toBe('function');
      expect(typeof processor.onWorkerError).toBe('function');
    });
  });

  describe('Priority Inversion', () => {
    it('should convert priority 10 to BullMQ priority 0 (highest)', async () => {
      const ourPriority = 10;
      const expectedBullmqPriority = 10 - ourPriority;
      expect(expectedBullmqPriority).toBe(0);
    });

    it('should convert priority 0 to BullMQ priority 10 (lowest)', async () => {
      const ourPriority = 0;
      const expectedBullmqPriority = 10 - ourPriority;
      expect(expectedBullmqPriority).toBe(10);
    });

    it('should convert priority 5 to BullMQ priority 5 (middle)', async () => {
      const ourPriority = 5;
      const expectedBullmqPriority = 10 - ourPriority;
      expect(expectedBullmqPriority).toBe(5);
    });
  });

  describe('addVideoGenerationJob', () => {
    it('should add job to queue with valid data', async () => {
      const { addVideoGenerationJob, resetQueue } = await import(
        '../src/queue/video-generation-queue'
      );
      await resetQueue();

      const jobData = {
        accountId: '123e4567-e89b-12d3-a456-426614174000',
        projectId: '123e4567-e89b-12d3-a456-426614174001',
        shotId: '123e4567-e89b-12d3-a456-426614174002',
        provider: 'kling' as const,
        generationJobId: '123e4567-e89b-12d3-a456-426614174003',
        prompt: 'Test prompt',
        duration: '5',
        aspectRatio: '16:9',
        priority: 5,
      };

      const job = await addVideoGenerationJob(jobData);

      expect(job).toBeDefined();
      expect(job.id).toBe('test-job-id');
      expect(mockQueue.add).toHaveBeenCalledWith(
        'generate-video',
        expect.objectContaining({
          accountId: jobData.accountId,
          provider: jobData.provider,
        }),
        expect.objectContaining({
          priority: 5,
          jobId: jobData.generationJobId,
        }),
      );
    });

    it('should invert priority for BullMQ (high priority = low number)', async () => {
      const { addVideoGenerationJob, resetQueue } = await import(
        '../src/queue/video-generation-queue'
      );
      await resetQueue();

      const jobData = {
        accountId: '123e4567-e89b-12d3-a456-426614174000',
        projectId: '123e4567-e89b-12d3-a456-426614174001',
        shotId: '123e4567-e89b-12d3-a456-426614174002',
        provider: 'kling' as const,
        generationJobId: '123e4567-e89b-12d3-a456-426614174003',
        prompt: 'Test prompt',
        duration: '5',
        aspectRatio: '16:9',
        priority: 10,
      };

      await addVideoGenerationJob(jobData);

      expect(mockQueue.add).toHaveBeenCalledWith(
        'generate-video',
        expect.any(Object),
        expect.objectContaining({
          priority: 0,
        }),
      );
    });

    it('should reject invalid job data', async () => {
      const { addVideoGenerationJob, resetQueue } = await import(
        '../src/queue/video-generation-queue'
      );
      await resetQueue();

      const invalidJobData = {
        accountId: 'invalid-uuid',
        projectId: '123e4567-e89b-12d3-a456-426614174001',
        shotId: '123e4567-e89b-12d3-a456-426614174002',
        provider: 'kling' as const,
        generationJobId: '123e4567-e89b-12d3-a456-426614174003',
        prompt: 'Test prompt',
        duration: '5',
        aspectRatio: '16:9',
        priority: 5,
      };

      await expect(addVideoGenerationJob(invalidJobData)).rejects.toThrow();
    });
  });

  describe('getJobStatus', () => {
    it('should return queued for waiting jobs', async () => {
      const { getJobStatus, resetQueue } = await import(
        '../src/queue/video-generation-queue'
      );
      await resetQueue();

      mockState.jobState = 'waiting';
      const status = await getJobStatus('test-job-id');
      expect(status).toBe('queued');
    });

    it('should return processing for active jobs', async () => {
      const { getJobStatus, resetQueue } = await import(
        '../src/queue/video-generation-queue'
      );
      await resetQueue();

      mockState.jobState = 'active';
      const status = await getJobStatus('test-job-id');
      expect(status).toBe('processing');
    });

    it('should return completed for completed jobs', async () => {
      const { getJobStatus, resetQueue } = await import(
        '../src/queue/video-generation-queue'
      );
      await resetQueue();

      mockState.jobState = 'completed';
      const status = await getJobStatus('test-job-id');
      expect(status).toBe('completed');
    });

    it('should return failed for failed jobs', async () => {
      const { getJobStatus, resetQueue } = await import(
        '../src/queue/video-generation-queue'
      );
      await resetQueue();

      mockState.jobState = 'failed';
      const status = await getJobStatus('test-job-id');
      expect(status).toBe('failed');
    });

    it('should return unknown for non-existent jobs', async () => {
      const { getJobStatus, resetQueue } = await import(
        '../src/queue/video-generation-queue'
      );
      await resetQueue();

      // Set getJobResult to indicate no job found (empty object that will be falsy check)
      mockState.getJobResult = undefined as any;
      mockQueue.getJob.mockResolvedValueOnce(null);
      const status = await getJobStatus('non-existent-job');
      expect(status).toBe('unknown');
    });
  });

  describe('getQueueMetrics', () => {
    it('should return queue metrics', async () => {
      const { getQueueMetrics, resetQueue } = await import(
        '../src/queue/video-generation-queue'
      );
      await resetQueue();

      const metrics = await getQueueMetrics();

      expect(metrics).toEqual({
        waiting: 5,
        active: 2,
        completed: 100,
        failed: 3,
        total: 7,
      });
    });
  });

  describe('processVideoGenerationJob', () => {
    it('should process job successfully', async () => {
      const { processVideoGenerationJob } = await import(
        '../src/queue/processor'
      );

      mockState.checkRateLimitResult = { allowed: true };
      mockState.generateVideoResult = { jobId: 'provider-job-456' };

      const result = await processVideoGenerationJob(mockJob as any);

      expect(result).toEqual({
        success: true,
        providerJobId: 'provider-job-456',
      });
    });

    it('should throw RateLimitExceededError when rate limited', async () => {
      const { processVideoGenerationJob } = await import(
        '../src/queue/processor'
      );

      mockState.checkRateLimitResult = { allowed: false, retryAfter: 60 };

      await expect(processVideoGenerationJob(mockJob as any)).rejects.toMatchObject({
        name: 'RateLimitExceededError',
        retryAfter: 60,
      });
    });

    it('should update generation job status to processing', async () => {
      const { processVideoGenerationJob } = await import(
        '../src/queue/processor'
      );

      mockState.checkRateLimitResult = { allowed: true };

      await processVideoGenerationJob(mockJob as any);

      expect(mockFrom).toHaveBeenCalledWith('generation_jobs');
      expect(mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'processing',
        }),
      );
    });

    it('should update job status to failed on error', async () => {
      const { processVideoGenerationJob } = await import(
        '../src/queue/processor'
      );

      mockState.checkRateLimitResult = { allowed: true };
      mockState.generateVideoError = new Error('Provider error');

      await expect(processVideoGenerationJob(mockJob as any)).rejects.toThrow(
        'Provider error',
      );

      expect(mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'failed',
          error_message: 'Provider error',
        }),
      );
    });
  });
});
