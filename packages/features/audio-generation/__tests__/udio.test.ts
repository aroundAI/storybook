import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { UDIO } from '../src/lib/constants';
import { UdioProvider } from '../src/providers/udio';

describe('UdioProvider', () => {
  const mockConfig = {
    apiKey: 'test-api-key',
    baseUrl: 'https://api.udio.com/v1',
    timeout: 30000,
    maxRetries: 3,
  };

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('constructor', () => {
    it('should initialize with provided config', () => {
      const provider = new UdioProvider(mockConfig);

      expect(provider.name).toBe('udio');
      expect(provider.maxDuration).toBe(UDIO.MAX_DURATION);
      expect(provider.supportsVocals).toBe(true);
      expect(provider.supportsInstrumental).toBe(true);
    });

    it('should use default base URL if not provided', () => {
      const provider = new UdioProvider({ apiKey: 'test-key' });

      expect(provider.name).toBe('udio');
    });
  });

  describe('generateMusic', () => {
    it('should call Udio API with correct parameters', async () => {
      const provider = new UdioProvider(mockConfig);

      const mockResponse = {
        task_id: 'task-123',
        status: 'queued',
        message: 'Generation started',
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      const result = await provider.generateMusic({
        prompt: 'Epic orchestral music for a battle scene',
        duration: 60,
        genre: 'orchestral',
        mood: 'epic',
        tempo: 'fast',
        instrumentalOnly: true,
      });

      expect(fetch).toHaveBeenCalledWith(
        'https://api.udio.com/v1/generate',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
            Authorization: 'Bearer test-api-key',
          }),
        }),
      );

      expect(result.jobId).toBe('task-123');
      expect(result.status).toBe('pending');
      expect(result.estimatedTime).toBe(UDIO.TYPICAL_PROCESSING_TIME);
      expect(result.cost).toBe(UDIO.COST_PER_GENERATION);
    });

    it('should validate prompt is not empty', async () => {
      const provider = new UdioProvider(mockConfig);

      await expect(
        provider.generateMusic({
          prompt: '',
          duration: 60,
        }),
      ).rejects.toThrow('Prompt is required');
    });

    it('should validate prompt length against Udio limit (500 chars)', async () => {
      const provider = new UdioProvider(mockConfig);

      await expect(
        provider.generateMusic({
          prompt: 'a'.repeat(501),
          duration: 60,
        }),
      ).rejects.toThrow(
        `Prompt exceeds Udio maximum of ${UDIO.MAX_PROMPT_LENGTH} characters`,
      );
    });

    it('should validate duration is positive', async () => {
      const provider = new UdioProvider(mockConfig);

      await expect(
        provider.generateMusic({
          prompt: 'Test music',
          duration: 0,
        }),
      ).rejects.toThrow('Duration must be positive');
    });

    it('should validate duration does not exceed max', async () => {
      const provider = new UdioProvider(mockConfig);

      await expect(
        provider.generateMusic({
          prompt: 'Test music',
          duration: 150, // Exceeds 120 max
        }),
      ).rejects.toThrow('Duration exceeds maximum');
    });

    it('should handle API errors gracefully', async () => {
      const provider = new UdioProvider(mockConfig);

      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        statusText: 'Unauthorized',
        json: () => Promise.resolve({ message: 'Invalid API key' }),
      });

      await expect(
        provider.generateMusic({
          prompt: 'Test music',
          duration: 60,
        }),
      ).rejects.toThrow();
    });
  });

  describe('getStatus', () => {
    it('should poll Udio API for task status', async () => {
      const provider = new UdioProvider(mockConfig);

      const mockResponse = {
        task_id: 'task-123',
        status: 'completed',
        audio_url: 'https://cdn.udio.com/audio/123.mp3',
        progress: 100,
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      const result = await provider.getStatus('task-123');

      expect(fetch).toHaveBeenCalledWith(
        'https://api.udio.com/v1/tasks/task-123',
        expect.objectContaining({
          method: 'GET',
          headers: expect.objectContaining({
            Authorization: 'Bearer test-api-key',
          }),
        }),
      );

      expect(result.status).toBe('completed');
      expect(result.audioUrl).toBe('https://cdn.udio.com/audio/123.mp3');
      expect(result.progress).toBe(100);
    });

    it('should return error message when task fails', async () => {
      const provider = new UdioProvider(mockConfig);

      const mockResponse = {
        task_id: 'task-123',
        status: 'failed',
        error_message: 'Generation failed: invalid prompt',
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      const result = await provider.getStatus('task-123');

      expect(result.status).toBe('failed');
      expect(result.error).toBe('Generation failed: invalid prompt');
    });
  });

  describe('getExtendedStatus', () => {
    it('should return extended status with metadata', async () => {
      const provider = new UdioProvider(mockConfig);

      const mockResponse = {
        task_id: 'task-123',
        status: 'completed',
        audio_url: 'https://cdn.udio.com/audio/123.mp3',
        progress: 100,
        duration: 60,
        title: 'Epic Battle Theme',
        genre: 'orchestral',
        mood: 'epic',
        lyrics: 'Instrumental',
        bpm: 120,
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      const result = await provider.getExtendedStatus('task-123');

      expect(result.status).toBe('completed');
      expect(result.audioUrl).toBe('https://cdn.udio.com/audio/123.mp3');
      expect(result.duration).toBe(60);
      expect(result.metadata).toEqual({
        title: 'Epic Battle Theme',
        genre: 'orchestral',
        mood: 'epic',
        lyrics: 'Instrumental',
        bpm: 120,
      });
    });
  });

  describe('extendSong', () => {
    it('should call Udio extend API with correct parameters', async () => {
      const provider = new UdioProvider(mockConfig);

      const mockResponse = {
        task_id: 'extend-task-123',
        status: 'queued',
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      const result = await provider.extendSong({
        songId: 'song-123',
        prompt: 'Continue with more intensity',
        fromTimestamp: 60,
      });

      expect(fetch).toHaveBeenCalledWith(
        'https://api.udio.com/v1/extend',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            song_id: 'song-123',
            prompt: 'Continue with more intensity',
            from_timestamp: 60,
          }),
        }),
      );

      expect(result.jobId).toBe('extend-task-123');
      expect(result.status).toBe('pending');
      expect(result.estimatedTime).toBe(UDIO.EXTENSION_DURATION);
      expect(result.cost).toBe(UDIO.COST_PER_EXTENSION);
    });
  });

  describe('getVariations', () => {
    it('should call Udio variations API with correct parameters', async () => {
      const provider = new UdioProvider(mockConfig);

      const mockResponse = {
        variations: [
          { task_id: 'var-1', status: 'queued' },
          { task_id: 'var-2', status: 'queued' },
          { task_id: 'var-3', status: 'queued' },
        ],
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      const result = await provider.getVariations('song-123', 3);

      expect(fetch).toHaveBeenCalledWith(
        'https://api.udio.com/v1/songs/song-123/variations',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ count: 3 }),
        }),
      );

      expect(result).toHaveLength(3);
      expect(result[0].jobId).toBe('var-1');
      expect(result[0].status).toBe('pending');
      expect(result[0].cost).toBe(UDIO.COST_PER_GENERATION);
    });

    it('should validate songId is not empty', async () => {
      const provider = new UdioProvider(mockConfig);

      await expect(provider.getVariations('', 3)).rejects.toThrow(
        'songId is required',
      );

      await expect(provider.getVariations('   ', 3)).rejects.toThrow(
        'songId is required',
      );
    });

    it('should validate count is within bounds (1-10)', async () => {
      const provider = new UdioProvider(mockConfig);

      await expect(provider.getVariations('song-123', 0)).rejects.toThrow(
        'count must be between 1 and 10',
      );

      await expect(provider.getVariations('song-123', 11)).rejects.toThrow(
        'count must be between 1 and 10',
      );

      await expect(provider.getVariations('song-123', -1)).rejects.toThrow(
        'count must be between 1 and 10',
      );
    });

    it('should use default count of 3 if not provided', async () => {
      const provider = new UdioProvider(mockConfig);

      const mockResponse = {
        variations: [
          { task_id: 'var-1', status: 'queued' },
          { task_id: 'var-2', status: 'queued' },
          { task_id: 'var-3', status: 'queued' },
        ],
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      await provider.getVariations('song-123');

      expect(fetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: JSON.stringify({ count: 3 }),
        }),
      );
    });
  });

  describe('cancelGeneration', () => {
    it('should call Udio cancel API with correct parameters', async () => {
      const provider = new UdioProvider(mockConfig);

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ success: true }),
      });

      await provider.cancelGeneration('task-123');

      expect(fetch).toHaveBeenCalledWith(
        'https://api.udio.com/v1/tasks/task-123/cancel',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: 'Bearer test-api-key',
          }),
        }),
      );
    });

    it('should validate taskId is not empty', async () => {
      const provider = new UdioProvider(mockConfig);

      await expect(provider.cancelGeneration('')).rejects.toThrow(
        'taskId is required',
      );

      await expect(provider.cancelGeneration('   ')).rejects.toThrow(
        'taskId is required',
      );
    });

    it('should throw error when cancellation fails', async () => {
      const provider = new UdioProvider(mockConfig);

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ success: false }),
      });

      await expect(provider.cancelGeneration('task-123')).rejects.toThrow(
        'Failed to cancel generation task: task-123',
      );
    });
  });

  describe('estimateCost', () => {
    it('should return 40 cents per generation', () => {
      const provider = new UdioProvider(mockConfig);

      const cost = provider.estimateCost({
        prompt: 'Any music',
        duration: 60,
      });

      expect(cost).toBe(40);
    });

    it('should return same cost regardless of duration', () => {
      const provider = new UdioProvider(mockConfig);

      const cost15s = provider.estimateCost({
        prompt: 'Short track',
        duration: 15,
      });

      const cost120s = provider.estimateCost({
        prompt: 'Long track',
        duration: 120,
      });

      expect(cost15s).toBe(40);
      expect(cost120s).toBe(40);
    });
  });

  describe('estimateExtensionCost', () => {
    it('should return 20 cents per extension', () => {
      const provider = new UdioProvider(mockConfig);

      const cost = provider.estimateExtensionCost();

      expect(cost).toBe(20);
    });
  });

  describe('getRateLimits', () => {
    it('should return correct rate limits from constants', () => {
      const provider = new UdioProvider(mockConfig);

      const limits = provider.getRateLimits();

      expect(limits.requestsPerMinute).toBe(
        UDIO.RATE_LIMITS.REQUESTS_PER_MINUTE,
      );
      expect(limits.concurrentRequests).toBe(
        UDIO.RATE_LIMITS.CONCURRENT_REQUESTS,
      );
      expect(limits.dailyLimit).toBe(UDIO.RATE_LIMITS.DAILY_LIMIT);
    });

    it('should have expected default values', () => {
      const provider = new UdioProvider(mockConfig);

      const limits = provider.getRateLimits();

      expect(limits.requestsPerMinute).toBe(10);
      expect(limits.concurrentRequests).toBe(3);
      expect(limits.dailyLimit).toBe(100);
    });
  });

  describe('mapStatus (internal)', () => {
    it('should map all Udio statuses to standard statuses', async () => {
      const provider = new UdioProvider(mockConfig);

      const testCases = [
        { udioStatus: 'queued', expectedStatus: 'pending' },
        { udioStatus: 'pending', expectedStatus: 'pending' },
        { udioStatus: 'processing', expectedStatus: 'processing' },
        { udioStatus: 'generating', expectedStatus: 'processing' },
        { udioStatus: 'running', expectedStatus: 'processing' },
        { udioStatus: 'complete', expectedStatus: 'completed' },
        { udioStatus: 'completed', expectedStatus: 'completed' },
        { udioStatus: 'done', expectedStatus: 'completed' },
        { udioStatus: 'success', expectedStatus: 'completed' },
        { udioStatus: 'failed', expectedStatus: 'failed' },
        { udioStatus: 'error', expectedStatus: 'failed' },
        { udioStatus: 'UNKNOWN', expectedStatus: 'pending' }, // Default fallback
      ];

      for (const { udioStatus, expectedStatus } of testCases) {
        global.fetch = vi.fn().mockResolvedValue({
          ok: true,
          json: () => Promise.resolve({ task_id: 'test', status: udioStatus }),
        });

        const result = await provider.getStatus('test-task');
        expect(result.status).toBe(expectedStatus);
      }
    });
  });

  describe('supportedGenres', () => {
    it('should have supported genres defined', () => {
      const provider = new UdioProvider(mockConfig);

      expect(provider.supportedGenres).toEqual(
        expect.arrayContaining([
          'pop',
          'rock',
          'electronic',
          'cinematic',
          'metal',
          'country',
        ]),
      );
    });
  });

  describe('provider properties', () => {
    it('should have correct max duration (2 minutes)', () => {
      const provider = new UdioProvider(mockConfig);

      expect(provider.maxDuration).toBe(120);
    });

    it('should support both vocals and instrumental', () => {
      const provider = new UdioProvider(mockConfig);

      expect(provider.supportsVocals).toBe(true);
      expect(provider.supportsInstrumental).toBe(true);
    });
  });
});
