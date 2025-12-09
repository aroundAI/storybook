import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { VideoGenerationRequest } from '../src/lib/types';
import { HailuoProvider } from '../src/providers/hailuo';
import { HailuoProviderError } from '../src/providers/hailuo/types';

// Mock server-only module
vi.mock('server-only', () => ({}));

// Mock cache client
const mockCacheGet = vi.fn().mockResolvedValue(null);
const mockCacheSet = vi.fn().mockResolvedValue(undefined);
const mockCacheDel = vi.fn().mockResolvedValue(undefined);
const mockCacheClient = {
  get: mockCacheGet,
  set: mockCacheSet,
  del: mockCacheDel,
};

vi.mock('@kit/cache', () => ({
  createCacheClient: () => mockCacheClient,
}));

// Mock logger
const mockLoggerWarn = vi.fn();
const mockLoggerError = vi.fn();
const mockLoggerInfo = vi.fn();
vi.mock('@kit/shared/logger', () => ({
  getLogger: () =>
    Promise.resolve({
      warn: mockLoggerWarn,
      error: mockLoggerError,
      info: mockLoggerInfo,
    }),
}));

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

/**
 * Helper to safely extract the request body from mock fetch calls.
 */
function getRequestBody(
  mockFn: ReturnType<typeof vi.fn>,
  callIndex = 0,
): Record<string, unknown> {
  const calls = mockFn.mock.calls;
  if (!calls[callIndex]) {
    throw new Error(`No call at index ${callIndex}`);
  }
  const requestInit = calls[callIndex][1] as RequestInit;
  return JSON.parse(requestInit.body as string) as Record<string, unknown>;
}

/**
 * Helper to get the URL from mock fetch calls.
 */
function getRequestUrl(
  mockFn: ReturnType<typeof vi.fn>,
  callIndex = 0,
): string {
  const calls = mockFn.mock.calls;
  if (!calls[callIndex]) {
    throw new Error(`No call at index ${callIndex}`);
  }
  return calls[callIndex][0] as string;
}

describe('HailuoProvider', () => {
  let provider: HailuoProvider;

  const validConfig = {
    apiKey: 'test-api-key',
    webhookSecret: 'https://example.com/webhooks/hailuo',
  };

  const validRequest: VideoGenerationRequest = {
    prompt: 'A beautiful sunset over the ocean',
    duration: 5,
    aspectRatio: '16:9',
  };

  beforeEach(() => {
    provider = new HailuoProvider(validConfig);
    vi.clearAllMocks();
    vi.useFakeTimers();
    // Reset cache mock to always miss
    mockCacheGet.mockResolvedValue(null);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('constructor', () => {
    it('should create provider with valid config', () => {
      expect(provider.name).toBe('hailuo');
      expect(provider.capabilities).toBeDefined();
      expect(provider.capabilities.maxDuration).toBe(6);
      expect(provider.capabilities.supportsNegativePrompt).toBe(false);
      expect(provider.capabilities.supportsImageToVideo).toBe(true);
    });

    it('should use default base URL when not provided', () => {
      const providerWithDefaults = new HailuoProvider({ apiKey: 'test' });
      expect(providerWithDefaults.name).toBe('hailuo');
    });
  });

  describe('generateVideo', () => {
    const successResponse = {
      task_id: 'task-123',
      base_resp: {
        status_code: 0,
        status_msg: 'Success',
      },
    };

    it('should successfully submit text-to-video request', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => successResponse,
      });

      const resultPromise = provider.generateVideo(validRequest);
      await vi.runAllTimersAsync();
      const result = await resultPromise;

      expect(result.jobId).toBe('task-123');
      expect(result.status).toBe('pending');
      expect(result.estimatedTime).toBe(20); // ~20 seconds for Hailuo

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/video_generation'),
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
            Authorization: 'Bearer test-api-key',
          }),
        }),
      );
    });

    it('should include webhook URL in request payload', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => successResponse,
      });

      const resultPromise = provider.generateVideo(validRequest);
      await vi.runAllTimersAsync();
      await resultPromise;

      const body = getRequestBody(mockFetch);
      expect(body.callback_url).toBe('https://example.com/webhooks/hailuo');
    });

    it('should use video-01 model', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => successResponse,
      });

      const resultPromise = provider.generateVideo(validRequest);
      await vi.runAllTimersAsync();
      await resultPromise;

      const body = getRequestBody(mockFetch);
      expect(body.model).toBe('video-01');
    });

    it('should reject invalid duration', async () => {
      const invalidRequest = { ...validRequest, duration: 15 };

      await expect(provider.generateVideo(invalidRequest)).rejects.toThrow(
        'Duration exceeds maximum of 6 seconds for hailuo',
      );
    });

    it('should reject unsupported aspect ratio', async () => {
      const invalidRequest = { ...validRequest, aspectRatio: '4:3' };

      await expect(provider.generateVideo(invalidRequest)).rejects.toThrow(
        'Aspect ratio 4:3 not supported',
      );
    });

    it('should reject empty prompt', async () => {
      const invalidRequest = { ...validRequest, prompt: '' };

      await expect(provider.generateVideo(invalidRequest)).rejects.toThrow(
        'Prompt is required',
      );
    });

    it('should reject negative prompts (not supported)', async () => {
      const invalidRequest = {
        ...validRequest,
        negativePrompt: 'blurry, low quality',
      };

      await expect(provider.generateVideo(invalidRequest)).rejects.toThrow(
        'hailuo does not support negative prompts',
      );
    });

    it('should handle API errors with status_code != 0', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          task_id: null,
          base_resp: {
            status_code: 1001,
            status_msg: 'Invalid prompt',
          },
        }),
      });

      const resultPromise = provider.generateVideo(validRequest);
      vi.runAllTimersAsync();

      await expect(resultPromise).rejects.toThrow(
        'Hailuo API error: Invalid prompt',
      );
    });

    it('should handle rate limit errors', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 429,
        statusText: 'Too Many Requests',
        json: async () => ({
          base_resp: { status_code: 429, status_msg: 'Rate limit exceeded' },
        }),
      });

      const resultPromise = provider.generateVideo(validRequest);
      vi.runAllTimersAsync();

      await expect(resultPromise).rejects.toThrow('Rate limit exceeded');
    });

    it('should handle authentication errors', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        json: async () => ({
          base_resp: { status_code: 401, status_msg: 'Invalid API key' },
        }),
      });

      const resultPromise = provider.generateVideo(validRequest);
      vi.runAllTimersAsync();

      await expect(resultPromise).rejects.toThrow('Invalid API credentials');
    });

    it('should handle timeout errors', async () => {
      mockFetch.mockImplementationOnce(
        () =>
          new Promise((_, reject) => {
            setTimeout(() => {
              const error = new Error('Aborted');
              error.name = 'AbortError';
              reject(error);
            }, 35000);
          }),
      );

      const resultPromise = provider.generateVideo(validRequest);
      vi.advanceTimersByTimeAsync(35000);

      await expect(resultPromise).rejects.toThrow('Hailuo API request timeout');
    });

    it('should handle network errors', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network failure'));

      const resultPromise = provider.generateVideo(validRequest);
      vi.runAllTimersAsync();

      await expect(resultPromise).rejects.toThrow(
        'Network error: Network failure',
      );
    });
  });

  describe('generateVideoWithImage', () => {
    const imageRequest = {
      prompt: 'Animate this image',
      duration: 5 as const,
      aspectRatio: '16:9' as const,
      referenceImageUrl: 'https://example.com/image.jpg',
    };

    it('should submit image-to-video request', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          task_id: 'task-456',
          base_resp: {
            status_code: 0,
            status_msg: 'Success',
          },
        }),
      });

      const resultPromise = provider.generateVideoWithImage(imageRequest);
      await vi.runAllTimersAsync();
      const result = await resultPromise;

      expect(result.providerJobId).toBe('task-456');
      expect(result.status).toBe('pending');

      const url = getRequestUrl(mockFetch);
      expect(url).toContain('/video_generation');

      const body = getRequestBody(mockFetch);
      expect(body.first_frame_image).toBe('https://example.com/image.jpg');
    });

    it('should require reference image URL', async () => {
      const requestWithoutImage = {
        prompt: 'Test',
        duration: 5 as const,
        aspectRatio: '16:9' as const,
      };

      await expect(
        provider.generateVideoWithImage(requestWithoutImage),
      ).rejects.toThrow('Reference image URL is required');
    });
  });

  describe('getStatus', () => {
    it('should poll job status', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          task_id: 'task-123',
          status: 'Processing',
          base_resp: {
            status_code: 0,
            status_msg: 'Success',
          },
        }),
      });

      const resultPromise = provider.getStatus('task-123');
      await vi.runAllTimersAsync();
      const status = await resultPromise;

      expect(status.jobId).toBe('task-123');
      expect(status.status).toBe('processing');
      expect(status.progress).toBe(50);
    });

    it('should return completed status with video URL', async () => {
      // First call for status
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          task_id: 'task-123',
          status: 'Success',
          file_id: 'file-abc',
          base_resp: {
            status_code: 0,
            status_msg: 'Success',
          },
        }),
      });

      // Second call for video URL
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          file: {
            file_id: 'file-abc',
            download_url: 'https://cdn.minimax.chat/videos/video.mp4',
          },
          base_resp: {
            status_code: 0,
            status_msg: 'Success',
          },
        }),
      });

      const resultPromise = provider.getStatus('task-123');
      await vi.runAllTimersAsync();
      const status = await resultPromise;

      expect(status.status).toBe('completed');
      expect(status.videoUrl).toBe('https://cdn.minimax.chat/videos/video.mp4');
      expect(status.completedAt).toBeDefined();
    });

    it('should return failed status with error message', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          task_id: 'task-123',
          status: 'Fail',
          base_resp: {
            status_code: 0,
            status_msg: 'Content policy violation',
          },
        }),
      });

      const resultPromise = provider.getStatus('task-123');
      await vi.runAllTimersAsync();
      const status = await resultPromise;

      expect(status.status).toBe('failed');
      expect(status.error).toBe('Content policy violation');
    });

    it('should map Queueing status to pending', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          task_id: 'task-123',
          status: 'Queueing',
          base_resp: { status_code: 0, status_msg: 'OK' },
        }),
      });

      const resultPromise = provider.getStatus('task-123');
      await vi.runAllTimersAsync();
      const status = await resultPromise;

      expect(status.status).toBe('pending');
      expect(status.progress).toBe(0);
    });

    it('should map Processing status to processing', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          task_id: 'task-123',
          status: 'Processing',
          base_resp: { status_code: 0, status_msg: 'OK' },
        }),
      });

      const resultPromise = provider.getStatus('task-123');
      await vi.runAllTimersAsync();
      const status = await resultPromise;

      expect(status.status).toBe('processing');
      expect(status.progress).toBe(50);
    });

    it('should map Fail status to failed', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          task_id: 'task-123',
          status: 'Fail',
          base_resp: { status_code: 0, status_msg: 'Failed' },
        }),
      });

      const resultPromise = provider.getStatus('task-123');
      await vi.runAllTimersAsync();
      const status = await resultPromise;

      expect(status.status).toBe('failed');
      expect(status.progress).toBe(0);
    });

    it('should return cached status if available', async () => {
      const cachedStatus = {
        jobId: 'task-123',
        status: 'processing' as const,
        progress: 50,
      };
      mockCacheGet.mockResolvedValueOnce(cachedStatus);

      const status = await provider.getStatus('task-123');

      expect(status).toEqual(cachedStatus);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should cache status responses', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          task_id: 'task-123',
          status: 'Processing',
          base_resp: {
            status_code: 0,
            status_msg: 'Success',
          },
        }),
      });

      const resultPromise = provider.getStatus('task-123');
      await vi.runAllTimersAsync();
      await resultPromise;

      expect(mockCacheSet).toHaveBeenCalledWith(
        'hailuo:status:task-123',
        expect.any(Object),
        5, // HAILUO_STATUS_CACHE_TTL
      );
    });

    it('should throw error if video URL is not available', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          task_id: 'task-123',
          status: 'Success',
          file_id: 'file-abc',
          base_resp: {
            status_code: 0,
            status_msg: 'Success',
          },
        }),
      });

      // Mock file retrieval with missing download_url
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          file: null,
          base_resp: {
            status_code: 0,
            status_msg: 'Success',
          },
        }),
      });

      const resultPromise = provider.getStatus('task-123');
      vi.runAllTimersAsync();

      await expect(resultPromise).rejects.toThrow(
        'Video URL not available from Hailuo API',
      );
    });
  });

  describe('cancelJob', () => {
    it('should log warning (cancellation not supported)', async () => {
      await provider.cancelJob('task-123');

      expect(mockLoggerWarn).toHaveBeenCalledWith(
        { name: 'hailuo-job-cancellation-unsupported', jobId: 'task-123' },
        'Hailuo job cancellation not supported - processing is typically too fast',
      );
    });
  });

  describe('estimateCost', () => {
    it('should return flat rate cost of $0.40 (40 cents)', () => {
      const cost = provider.estimateCost();

      expect(cost.costCents).toBe(40);
    });
  });

  describe('HailuoProviderError', () => {
    it('should create error with correct properties', () => {
      const error = new HailuoProviderError('Test error', 'RATE_LIMITED', {
        retryable: true,
        retryAfter: 60,
      });

      expect(error.message).toBe('Test error');
      expect(error.code).toBe('RATE_LIMITED');
      expect(error.retryable).toBe(true);
      expect(error.retryAfter).toBe(60);
      expect(error.name).toBe('HailuoProviderError');
    });

    it('should default retryable to false', () => {
      const error = new HailuoProviderError('Test error', 'AUTH_ERROR');

      expect(error.retryable).toBe(false);
      expect(error.retryAfter).toBeUndefined();
    });
  });
});
