import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SUNO } from '../src/lib/constants';
import { SunoProvider } from '../src/providers/suno';

describe('SunoProvider', () => {
  const mockConfig = {
    apiKey: 'test-api-key',
    baseUrl: 'https://api.suno.ai',
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
      const provider = new SunoProvider(mockConfig);

      expect(provider.name).toBe('suno');
      expect(provider.maxDuration).toBe(SUNO.MAX_DURATION);
      expect(provider.supportsVocals).toBe(true);
      expect(provider.supportsInstrumental).toBe(true);
    });

    it('should use default base URL if not provided', () => {
      const provider = new SunoProvider({ apiKey: 'test-key' });

      expect(provider.name).toBe('suno');
    });
  });

  describe('generateMusic', () => {
    it('should call Suno API with correct parameters', async () => {
      const provider = new SunoProvider(mockConfig);

      const mockResponse = {
        id: 'job-123',
        status: 'queued',
        audio_url: undefined,
        estimated_time: 120,
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
        'https://api.suno.ai/v1/generate',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
            Authorization: 'Bearer test-api-key',
          }),
        }),
      );

      expect(result.jobId).toBe('job-123');
      expect(result.status).toBe('pending'); // 'queued' maps to 'pending'
    });

    it('should validate prompt is not empty', async () => {
      const provider = new SunoProvider(mockConfig);

      await expect(
        provider.generateMusic({
          prompt: '',
          duration: 60,
        }),
      ).rejects.toThrow('Prompt is required');
    });

    it('should validate prompt length', async () => {
      const provider = new SunoProvider(mockConfig);

      await expect(
        provider.generateMusic({
          prompt: 'a'.repeat(1001),
          duration: 60,
        }),
      ).rejects.toThrow('Prompt exceeds maximum length');
    });

    it('should validate duration is positive', async () => {
      const provider = new SunoProvider(mockConfig);

      await expect(
        provider.generateMusic({
          prompt: 'Test music',
          duration: 0,
        }),
      ).rejects.toThrow('Duration must be positive');
    });

    it('should validate duration does not exceed max', async () => {
      const provider = new SunoProvider(mockConfig);

      await expect(
        provider.generateMusic({
          prompt: 'Test music',
          duration: 300, // Exceeds 240 max
        }),
      ).rejects.toThrow('Duration exceeds maximum');
    });

    it('should handle API errors gracefully', async () => {
      const provider = new SunoProvider(mockConfig);

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
    it('should poll Suno API for job status', async () => {
      const provider = new SunoProvider(mockConfig);

      const mockResponse = {
        status: 'complete',
        audio_url: 'https://cdn.suno.ai/audio/123.mp3',
        progress: 100,
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      const result = await provider.getStatus('job-123');

      expect(fetch).toHaveBeenCalledWith(
        'https://api.suno.ai/v1/status/job-123',
        expect.objectContaining({
          method: 'GET',
          headers: expect.objectContaining({
            Authorization: 'Bearer test-api-key',
          }),
        }),
      );

      expect(result.status).toBe('completed'); // 'complete' maps to 'completed'
      expect(result.audioUrl).toBe('https://cdn.suno.ai/audio/123.mp3');
      expect(result.progress).toBe(100);
    });

    it('should return error message when job fails', async () => {
      const provider = new SunoProvider(mockConfig);

      const mockResponse = {
        status: 'failed',
        error: 'Generation failed: invalid prompt',
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      const result = await provider.getStatus('job-123');

      expect(result.status).toBe('failed');
      expect(result.error).toBe('Generation failed: invalid prompt');
    });
  });

  describe('estimateCost', () => {
    it('should return 50 cents per generation', () => {
      const provider = new SunoProvider(mockConfig);

      const cost = provider.estimateCost({
        prompt: 'Any music',
        duration: 60,
      });

      expect(cost).toBe(50);
    });

    it('should return same cost regardless of duration', () => {
      const provider = new SunoProvider(mockConfig);

      const cost30s = provider.estimateCost({
        prompt: 'Short track',
        duration: 30,
      });

      const cost240s = provider.estimateCost({
        prompt: 'Long track',
        duration: 240,
      });

      expect(cost30s).toBe(50);
      expect(cost240s).toBe(50);
    });
  });

  describe('getRateLimits', () => {
    it('should return correct rate limits per spec', () => {
      const provider = new SunoProvider(mockConfig);

      const limits = provider.getRateLimits();

      expect(limits.requestsPerMinute).toBe(5);
      expect(limits.concurrentRequests).toBe(2);
      expect(limits.dailyLimit).toBe(50);
    });
  });

  describe('mapStatus (internal)', () => {
    it('should map all Suno statuses to standard statuses', async () => {
      const provider = new SunoProvider(mockConfig);

      // Test by making API calls with different status responses
      const testCases = [
        { sunoStatus: 'queued', expectedStatus: 'pending' },
        { sunoStatus: 'pending', expectedStatus: 'pending' },
        { sunoStatus: 'processing', expectedStatus: 'processing' },
        { sunoStatus: 'running', expectedStatus: 'processing' },
        { sunoStatus: 'completed', expectedStatus: 'completed' },
        { sunoStatus: 'done', expectedStatus: 'completed' },
        { sunoStatus: 'success', expectedStatus: 'completed' },
        { sunoStatus: 'failed', expectedStatus: 'failed' },
        { sunoStatus: 'error', expectedStatus: 'failed' },
        { sunoStatus: 'UNKNOWN', expectedStatus: 'pending' }, // Default fallback
      ];

      for (const { sunoStatus, expectedStatus } of testCases) {
        global.fetch = vi.fn().mockResolvedValue({
          ok: true,
          json: () => Promise.resolve({ status: sunoStatus }),
        });

        const result = await provider.getStatus('test-job');
        expect(result.status).toBe(expectedStatus);
      }
    });
  });

  describe('supportedGenres', () => {
    it('should have supported genres defined', () => {
      const provider = new SunoProvider(mockConfig);

      expect(provider.supportedGenres).toEqual(
        expect.arrayContaining(['pop', 'rock', 'electronic', 'cinematic']),
      );
    });
  });
});
