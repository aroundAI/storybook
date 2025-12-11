import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SYNCLABS, WAV2LIP } from '../src/lib/constants';
import { SyncLabsProvider } from '../src/providers/lip-sync/synclabs';
import type { LipSyncInput } from '../src/providers/lip-sync/types';
import { Wav2LipProvider } from '../src/providers/lip-sync/wav2lip';

// Helper to create a proper mock response
function createMockResponse(options: {
  ok?: boolean;
  statusText?: string;
  data?: unknown;
}) {
  return {
    ok: options.ok ?? true,
    statusText: options.statusText ?? 'OK',
    json: vi.fn().mockResolvedValue(options.data ?? {}),
  };
}

describe('SyncLabsProvider', () => {
  let provider: SyncLabsProvider;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();

    fetchMock = vi.fn();
    global.fetch = fetchMock;

    provider = new SyncLabsProvider({
      apiKey: 'test-api-key',
      maxRetries: 1,
      timeout: 1000,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('constructor', () => {
    it('should create provider with default base URL', () => {
      expect(provider.name).toBe('synclabs');
    });

    it('should use custom base URL when provided', () => {
      const customProvider = new SyncLabsProvider({
        apiKey: 'test-key',
        baseUrl: 'https://custom.api.com',
      });
      expect(customProvider.name).toBe('synclabs');
    });
  });

  describe('generateLipSync', () => {
    const validInput: LipSyncInput = {
      videoUrl: 'https://example.com/video.mp4',
      audioUrl: 'https://example.com/audio.mp3',
      quality: 'standard',
    };

    it('should generate lip sync job with valid input', async () => {
      fetchMock.mockResolvedValueOnce(
        createMockResponse({
          ok: true,
          data: { id: 'job-123' },
        }),
      );

      const resultPromise = provider.generateLipSync(validInput);
      await vi.runAllTimersAsync();
      const result = await resultPromise;

      expect(result).toBe('job-123');
      expect(fetchMock).toHaveBeenCalledWith(
        `${SYNCLABS.BASE_URL}/lipsync`,
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'x-api-key': 'test-api-key',
            'Content-Type': 'application/json',
          }),
        }),
      );
    });

    it('should include face coordinates when provided', async () => {
      fetchMock.mockResolvedValueOnce(
        createMockResponse({
          ok: true,
          data: { id: 'job-456' },
        }),
      );

      const inputWithFace: LipSyncInput = {
        ...validInput,
        faceCoordinates: { x: 100, y: 100, width: 200, height: 200 },
      };

      const resultPromise = provider.generateLipSync(inputWithFace);
      await vi.runAllTimersAsync();
      await resultPromise;

      const callBody = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(callBody.faceCoordinates).toEqual({
        x: 100,
        y: 100,
        width: 200,
        height: 200,
      });
    });

    it('should throw error for invalid video URL', async () => {
      const invalidInput: LipSyncInput = {
        videoUrl: 'not-a-url',
        audioUrl: 'https://example.com/audio.mp3',
        quality: 'standard',
      };

      await expect(provider.generateLipSync(invalidInput)).rejects.toThrow(
        'Invalid video URL format',
      );
    });

    it('should throw error for invalid audio URL', async () => {
      const invalidInput: LipSyncInput = {
        videoUrl: 'https://example.com/video.mp4',
        audioUrl: 'not-a-url',
        quality: 'standard',
      };

      await expect(provider.generateLipSync(invalidInput)).rejects.toThrow(
        'Invalid audio URL format',
      );
    });
  });

  describe('getStatus', () => {
    it('should return pending status', async () => {
      fetchMock.mockResolvedValueOnce(
        createMockResponse({
          ok: true,
          data: { status: 'PENDING', progress: 0 },
        }),
      );

      const resultPromise = provider.getStatus('job-123');
      await vi.runAllTimersAsync();
      const result = await resultPromise;

      expect(result.status).toBe('pending');
      expect(result.progress).toBe(0);
    });

    it('should return processing status with progress', async () => {
      fetchMock.mockResolvedValueOnce(
        createMockResponse({
          ok: true,
          data: { status: 'PROCESSING', progress: 50 },
        }),
      );

      const resultPromise = provider.getStatus('job-123');
      await vi.runAllTimersAsync();
      const result = await resultPromise;

      expect(result.status).toBe('processing');
      expect(result.progress).toBe(50);
    });

    it('should return completed status with output URL', async () => {
      fetchMock.mockResolvedValueOnce(
        createMockResponse({
          ok: true,
          data: {
            status: 'COMPLETED',
            output_url: 'https://example.com/output.mp4',
          },
        }),
      );

      const resultPromise = provider.getStatus('job-123');
      await vi.runAllTimersAsync();
      const result = await resultPromise;

      expect(result.status).toBe('completed');
      expect(result.outputUrl).toBe('https://example.com/output.mp4');
    });

    it('should return failed status with error', async () => {
      fetchMock.mockResolvedValueOnce(
        createMockResponse({
          ok: true,
          data: {
            status: 'FAILED',
            error: 'Processing failed',
          },
        }),
      );

      const resultPromise = provider.getStatus('job-123');
      await vi.runAllTimersAsync();
      const result = await resultPromise;

      expect(result.status).toBe('failed');
      expect(result.error).toBe('Processing failed');
    });
  });

  describe('estimateDuration', () => {
    it('should return fast processing time for fast quality', () => {
      const duration = provider.estimateDuration({
        videoUrl: 'https://example.com/video.mp4',
        audioUrl: 'https://example.com/audio.mp3',
        quality: 'fast',
      });
      expect(duration).toBe(SYNCLABS.PROCESSING_TIME.FAST);
    });

    it('should return standard processing time for standard quality', () => {
      const duration = provider.estimateDuration({
        videoUrl: 'https://example.com/video.mp4',
        audioUrl: 'https://example.com/audio.mp3',
        quality: 'standard',
      });
      expect(duration).toBe(SYNCLABS.PROCESSING_TIME.STANDARD);
    });

    it('should return high processing time for high quality', () => {
      const duration = provider.estimateDuration({
        videoUrl: 'https://example.com/video.mp4',
        audioUrl: 'https://example.com/audio.mp3',
        quality: 'high',
      });
      expect(duration).toBe(SYNCLABS.PROCESSING_TIME.HIGH);
    });
  });

  describe('estimateCost', () => {
    it('should return cost per job', () => {
      const cost = provider.estimateCost({
        videoUrl: 'https://example.com/video.mp4',
        audioUrl: 'https://example.com/audio.mp3',
        quality: 'standard',
      });
      expect(cost).toBe(SYNCLABS.COST_PER_JOB);
    });
  });

  describe('getRateLimits', () => {
    it('should return rate limits', () => {
      const limits = provider.getRateLimits();
      expect(limits.requestsPerMinute).toBe(
        SYNCLABS.RATE_LIMITS.REQUESTS_PER_MINUTE,
      );
      expect(limits.concurrentRequests).toBe(
        SYNCLABS.RATE_LIMITS.CONCURRENT_REQUESTS,
      );
    });
  });
});

describe('Wav2LipProvider', () => {
  let provider: Wav2LipProvider;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();

    fetchMock = vi.fn();
    global.fetch = fetchMock;

    provider = new Wav2LipProvider({
      apiKey: 'test-api-key',
      maxRetries: 1,
      timeout: 1000,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('constructor', () => {
    it('should create provider with default name', () => {
      expect(provider.name).toBe('wav2lip');
    });
  });

  describe('generateLipSync', () => {
    const validInput: LipSyncInput = {
      videoUrl: 'https://example.com/video.mp4',
      audioUrl: 'https://example.com/audio.mp3',
      quality: 'standard',
    };

    it('should generate lip sync job with valid input', async () => {
      fetchMock.mockResolvedValueOnce(
        createMockResponse({
          ok: true,
          data: { job_id: 'wav2lip-job-123' },
        }),
      );

      const resultPromise = provider.generateLipSync(validInput);
      await vi.runAllTimersAsync();
      const result = await resultPromise;

      expect(result).toBe('wav2lip-job-123');
      expect(fetchMock).toHaveBeenCalledWith(
        `${WAV2LIP.BASE_URL}/sync`,
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: 'Bearer test-api-key',
            'Content-Type': 'application/json',
          }),
        }),
      );
    });
  });

  describe('getStatus', () => {
    it('should return completed status', async () => {
      fetchMock.mockResolvedValueOnce(
        createMockResponse({
          ok: true,
          data: {
            status: 'complete',
            output_url: 'https://example.com/output.mp4',
          },
        }),
      );

      const resultPromise = provider.getStatus('job-123');
      await vi.runAllTimersAsync();
      const result = await resultPromise;

      expect(result.status).toBe('completed');
      expect(result.outputUrl).toBe('https://example.com/output.mp4');
    });

    it('should handle failed status', async () => {
      fetchMock.mockResolvedValueOnce(
        createMockResponse({
          ok: true,
          data: {
            status: 'error',
            error_message: 'Processing error',
          },
        }),
      );

      const resultPromise = provider.getStatus('job-123');
      await vi.runAllTimersAsync();
      const result = await resultPromise;

      expect(result.status).toBe('failed');
      expect(result.error).toBe('Processing error');
    });
  });

  describe('estimateDuration', () => {
    it('should return correct duration for each quality', () => {
      expect(
        provider.estimateDuration({
          videoUrl: 'https://example.com/video.mp4',
          audioUrl: 'https://example.com/audio.mp3',
          quality: 'fast',
        }),
      ).toBe(WAV2LIP.PROCESSING_TIME.FAST);

      expect(
        provider.estimateDuration({
          videoUrl: 'https://example.com/video.mp4',
          audioUrl: 'https://example.com/audio.mp3',
          quality: 'standard',
        }),
      ).toBe(WAV2LIP.PROCESSING_TIME.STANDARD);

      expect(
        provider.estimateDuration({
          videoUrl: 'https://example.com/video.mp4',
          audioUrl: 'https://example.com/audio.mp3',
          quality: 'high',
        }),
      ).toBe(WAV2LIP.PROCESSING_TIME.HIGH);
    });
  });

  describe('estimateCost', () => {
    it('should return cost per job', () => {
      const cost = provider.estimateCost({
        videoUrl: 'https://example.com/video.mp4',
        audioUrl: 'https://example.com/audio.mp3',
        quality: 'standard',
      });
      expect(cost).toBe(WAV2LIP.COST_PER_JOB);
    });
  });

  describe('getRateLimits', () => {
    it('should return rate limits', () => {
      const limits = provider.getRateLimits();
      expect(limits.requestsPerMinute).toBe(
        WAV2LIP.RATE_LIMITS.REQUESTS_PER_MINUTE,
      );
      expect(limits.concurrentRequests).toBe(
        WAV2LIP.RATE_LIMITS.CONCURRENT_REQUESTS,
      );
    });
  });
});
