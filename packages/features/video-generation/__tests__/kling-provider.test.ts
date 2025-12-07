import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { KlingProviderError } from '../src/lib/kling-types';
import type { VideoGenerationRequest } from '../src/lib/types';
import { KlingProvider } from '../src/providers/kling';

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

describe('KlingProvider', () => {
  let provider: KlingProvider;

  const validConfig = {
    apiKey: 'test-api-key',
    webhookSecret: 'https://example.com/webhooks/kling',
  };

  const validRequest: VideoGenerationRequest = {
    prompt: 'A beautiful sunset over the ocean',
    duration: 5,
    aspectRatio: '16:9',
  };

  beforeEach(() => {
    provider = new KlingProvider(validConfig);
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('constructor', () => {
    it('should create provider with valid config', () => {
      expect(provider.name).toBe('kling');
      expect(provider.capabilities).toBeDefined();
      expect(provider.capabilities.maxDuration).toBe(10);
      expect(provider.capabilities.supportsNegativePrompt).toBe(true);
      expect(provider.capabilities.supportsImageToVideo).toBe(true);
    });

    it('should use default base URL when not provided', () => {
      const providerWithDefaults = new KlingProvider({ apiKey: 'test' });
      expect(providerWithDefaults.name).toBe('kling');
    });
  });

  describe('generateVideo', () => {
    const successResponse = {
      code: 200,
      message: 'Success',
      data: {
        task_id: 'task-123',
        task_status: 'submitted',
        created_at: 1640995200,
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
      expect(result.estimatedTime).toBe(180); // 3 minutes for 5s video

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/generations'),
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
            'X-API-Key': 'test-api-key',
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
      expect(body.callback_url).toBe('https://example.com/webhooks/kling');
    });

    it('should include negative prompt when provided', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => successResponse,
      });

      const requestWithNegative = {
        ...validRequest,
        negativePrompt: 'blurry, low quality',
      };

      const resultPromise = provider.generateVideo(requestWithNegative);
      await vi.runAllTimersAsync();
      await resultPromise;

      const body = getRequestBody(mockFetch);
      expect(body.negative_prompt).toBe('blurry, low quality');
    });

    it('should reject invalid duration', async () => {
      const invalidRequest = { ...validRequest, duration: 15 };

      await expect(provider.generateVideo(invalidRequest)).rejects.toThrow(
        'Duration exceeds maximum of 10 seconds for kling',
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

    it('should handle API errors', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          code: 400,
          message: 'Invalid prompt',
        }),
      });

      const resultPromise = provider.generateVideo(validRequest);
      await vi.runAllTimersAsync();

      await expect(resultPromise).rejects.toThrow(
        'Kling API error: Invalid prompt',
      );
    });

    it('should handle rate limit errors', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 429,
        statusText: 'Too Many Requests',
        json: async () => ({ message: 'Rate limit exceeded' }),
      });

      const resultPromise = provider.generateVideo(validRequest);
      await vi.runAllTimersAsync();

      try {
        await resultPromise;
        expect.fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(KlingProviderError);
        expect((error as KlingProviderError).code).toBe('RATE_LIMITED');
        expect((error as KlingProviderError).retryable).toBe(true);
      }
    });

    it('should handle authentication errors', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        json: async () => ({ message: 'Invalid API key' }),
      });

      const resultPromise = provider.generateVideo(validRequest);
      await vi.runAllTimersAsync();

      try {
        await resultPromise;
        expect.fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(KlingProviderError);
        expect((error as KlingProviderError).code).toBe('AUTH_ERROR');
      }
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
      await vi.advanceTimersByTimeAsync(35000);

      try {
        await resultPromise;
        expect.fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(KlingProviderError);
        expect((error as KlingProviderError).code).toBe('TIMEOUT');
        expect((error as KlingProviderError).retryable).toBe(true);
      }
    });

    it('should use 10-second duration settings', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => successResponse,
      });

      const request10s = { ...validRequest, duration: 10 };
      const resultPromise = provider.generateVideo(request10s);
      await vi.runAllTimersAsync();
      const result = await resultPromise;

      expect(result.estimatedTime).toBe(300); // 5 minutes for 10s video

      const body = getRequestBody(mockFetch);
      expect(body.duration).toBe('10');
    });

    it('should use model version from request settings', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => successResponse,
      });

      const requestWithModel = {
        ...validRequest,
        modelVersion: 'kling-v1.0',
      };
      const resultPromise = provider.generateVideo(requestWithModel);
      await vi.runAllTimersAsync();
      await resultPromise;

      const body = getRequestBody(mockFetch);
      expect(body.model).toBe('kling-v1.0');
    });

    it('should use pro mode from settings', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => successResponse,
      });

      const requestWithMode = {
        ...validRequest,
        settings: { mode: 'pro' },
      };
      const resultPromise = provider.generateVideo(requestWithMode);
      await vi.runAllTimersAsync();
      await resultPromise;

      const body = getRequestBody(mockFetch);
      expect(body.mode).toBe('pro');
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
          code: 200,
          message: 'Success',
          data: {
            task_id: 'task-456',
            task_status: 'submitted',
            created_at: 1640995200,
          },
        }),
      });

      const resultPromise = provider.generateVideoWithImage(imageRequest);
      await vi.runAllTimersAsync();
      const result = await resultPromise;

      expect(result.providerJobId).toBe('task-456');
      expect(result.status).toBe('pending');

      const url = getRequestUrl(mockFetch);
      expect(url).toContain('/image2video');

      const body = getRequestBody(mockFetch);
      expect(body.image_url).toBe('https://example.com/image.jpg');
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
          code: 200,
          message: 'Success',
          data: {
            task_id: 'task-123',
            task_status: 'processing',
            task_status_msg: 'Processing video',
            progress: 50,
            created_at: 1640995200,
            updated_at: 1640995300,
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
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          code: 200,
          message: 'Success',
          data: {
            task_id: 'task-123',
            task_status: 'succeed',
            task_status_msg: 'Completed',
            progress: 100,
            created_at: 1640995200,
            updated_at: 1640995400,
            task_result: {
              videos: [
                {
                  id: 'video-123',
                  url: 'https://cdn.piapi.ai/videos/video.mp4',
                  duration: 5,
                },
              ],
            },
          },
        }),
      });

      const resultPromise = provider.getStatus('task-123');
      await vi.runAllTimersAsync();
      const status = await resultPromise;

      expect(status.status).toBe('completed');
      expect(status.videoUrl).toBe('https://cdn.piapi.ai/videos/video.mp4');
      expect(status.completedAt).toBeDefined();
    });

    it('should return failed status with error message', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          code: 200,
          message: 'Success',
          data: {
            task_id: 'task-123',
            task_status: 'failed',
            task_status_msg: 'Content policy violation',
            progress: 0,
            created_at: 1640995200,
            updated_at: 1640995300,
          },
        }),
      });

      const resultPromise = provider.getStatus('task-123');
      await vi.runAllTimersAsync();
      const status = await resultPromise;

      expect(status.status).toBe('failed');
      expect(status.error).toBe('Content policy violation');
    });

    it('should map all status values correctly', async () => {
      const statusMappings = [
        { piStatus: 'submitted', expected: 'pending' },
        { piStatus: 'processing', expected: 'processing' },
        { piStatus: 'succeed', expected: 'completed' },
        { piStatus: 'failed', expected: 'failed' },
      ];

      for (const mapping of statusMappings) {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            code: 200,
            message: 'Success',
            data: {
              task_id: 'task-123',
              task_status: mapping.piStatus,
              task_status_msg: 'Test',
              progress: 0,
              created_at: 1640995200,
              updated_at: 1640995300,
            },
          }),
        });

        const resultPromise = provider.getStatus('task-123');
        await vi.runAllTimersAsync();
        const status = await resultPromise;

        expect(status.status).toBe(mapping.expected);
      }
    });
  });

  describe('cancelJob', () => {
    it('should log warning (cancellation not supported)', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      await provider.cancelJob('task-123');

      expect(warnSpy).toHaveBeenCalledWith(
        'Kling job cancellation not supported: task-123',
      );

      warnSpy.mockRestore();
    });
  });

  describe('estimateCost', () => {
    it('should calculate standard mode cost for 5 seconds', () => {
      const cost = provider.estimateCost({
        prompt: 'Test',
        duration: 5,
        aspectRatio: '16:9',
        mode: 'std',
      });

      expect(cost.costCents).toBe(50); // 10 cents/second * 5 seconds
      expect(cost.breakdown.mode).toBe('std');
      expect(cost.breakdown.duration).toBe(5);
      expect(cost.breakdown.ratePerSecond).toBe(10);
    });

    it('should calculate standard mode cost for 10 seconds', () => {
      const cost = provider.estimateCost({
        prompt: 'Test',
        duration: 10,
        aspectRatio: '16:9',
        mode: 'std',
      });

      expect(cost.costCents).toBe(100); // 10 cents/second * 10 seconds
    });

    it('should calculate pro mode cost for 5 seconds', () => {
      const cost = provider.estimateCost({
        prompt: 'Test',
        duration: 5,
        aspectRatio: '16:9',
        mode: 'pro',
      });

      expect(cost.costCents).toBe(150); // 30 cents/second * 5 seconds
      expect(cost.breakdown.mode).toBe('pro');
      expect(cost.breakdown.ratePerSecond).toBe(30);
    });

    it('should calculate pro mode cost for 10 seconds', () => {
      const cost = provider.estimateCost({
        prompt: 'Test',
        duration: 10,
        aspectRatio: '16:9',
        mode: 'pro',
      });

      expect(cost.costCents).toBe(300); // 30 cents/second * 10 seconds
    });

    it('should default to std mode when not specified', () => {
      const cost = provider.estimateCost({
        prompt: 'Test',
        duration: 5,
        aspectRatio: '16:9',
      });

      expect(cost.costCents).toBe(50);
      expect(cost.breakdown.mode).toBe('std');
    });
  });

  describe('KlingProviderError', () => {
    it('should create error with correct properties', () => {
      const error = new KlingProviderError('Test error', 'RATE_LIMITED', {
        retryable: true,
        retryAfter: 60,
      });

      expect(error.message).toBe('Test error');
      expect(error.code).toBe('RATE_LIMITED');
      expect(error.retryable).toBe(true);
      expect(error.retryAfter).toBe(60);
      expect(error.name).toBe('KlingProviderError');
    });

    it('should default retryable to false', () => {
      const error = new KlingProviderError('Test error', 'AUTH_ERROR');

      expect(error.retryable).toBe(false);
      expect(error.retryAfter).toBeUndefined();
    });
  });
});
