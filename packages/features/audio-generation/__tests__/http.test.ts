import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { fetchWithRetry, formatProviderError } from '../src/lib/http';

describe('HTTP Utilities', () => {
  describe('formatProviderError', () => {
    it('should format Error instances correctly', () => {
      const error = new Error('Connection failed');
      const result = formatProviderError('ElevenLabs', 'generateVoice', error);

      expect(result.message).toBe(
        'ElevenLabs generateVoice failed: Connection failed',
      );
    });

    it('should handle non-Error objects', () => {
      const result = formatProviderError(
        'Suno',
        'generateMusic',
        'string error',
      );

      expect(result.message).toBe('Suno generateMusic failed: Unknown error');
    });

    it('should handle null/undefined errors', () => {
      const result = formatProviderError('PlayHT', 'cloneVoice', null);

      expect(result.message).toBe('PlayHT cloneVoice failed: Unknown error');
    });
  });

  describe('fetchWithRetry', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
      vi.restoreAllMocks();
    });

    it('should return data on successful fetch', async () => {
      const mockData = { success: true, data: 'test' };
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockData),
      });

      const result = await fetchWithRetry<typeof mockData>(
        'https://api.example.com/test',
        { method: 'GET' },
      );

      expect(result).toEqual(mockData);
      expect(fetch).toHaveBeenCalledTimes(1);
    });

    it('should return ArrayBuffer when binary is true', async () => {
      const mockBuffer = new ArrayBuffer(8);
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        arrayBuffer: () => Promise.resolve(mockBuffer),
      });

      const result = await fetchWithRetry<ArrayBuffer>(
        'https://api.example.com/audio',
        { method: 'GET' },
        {},
        true,
      );

      expect(result).toBe(mockBuffer);
    });

    it('should throw immediately on validation errors', async () => {
      const validationError = new Error('Invalid request: missing field');
      global.fetch = vi.fn().mockRejectedValue(validationError);

      await expect(
        fetchWithRetry('https://api.example.com/test', { method: 'GET' }),
      ).rejects.toThrow('Invalid request: missing field');

      expect(fetch).toHaveBeenCalledTimes(1); // No retries
    });

    it('should retry on transient errors', async () => {
      vi.useRealTimers(); // Use real timers for this test

      const transientError = new Error('Network error');
      global.fetch = vi
        .fn()
        .mockRejectedValueOnce(transientError)
        .mockRejectedValueOnce(transientError)
        .mockResolvedValue({
          ok: true,
          json: () => Promise.resolve({ success: true }),
        });

      const result = await fetchWithRetry(
        'https://api.example.com/test',
        { method: 'GET' },
        { maxRetries: 3, baseDelay: 1, maxDelay: 5 }, // Use minimal delays
      );

      expect(result).toEqual({ success: true });
      expect(fetch).toHaveBeenCalledTimes(3);
    });

    it('should throw after max retries exhausted', async () => {
      vi.useRealTimers(); // Use real timers for this test

      const persistentError = new Error('Server unavailable');
      global.fetch = vi.fn().mockRejectedValue(persistentError);

      await expect(
        fetchWithRetry(
          'https://api.example.com/test',
          { method: 'GET' },
          { maxRetries: 2, baseDelay: 1, maxDelay: 5 }, // Use minimal delays
        ),
      ).rejects.toThrow('Server unavailable');

      expect(fetch).toHaveBeenCalledTimes(2);
    });

    it('should handle API error responses', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        json: () => Promise.resolve({ message: 'Resource not found' }),
      });

      const fetchPromise = fetchWithRetry(
        'https://api.example.com/test',
        { method: 'GET' },
        { maxRetries: 1 },
      );

      // The status belongs in the message: fetchWithRetry decides whether an
      // error is retryable by matching `API error (4xx)` against it, so a mock
      // without a status was not exercising that branch at all.
      await expect(fetchPromise).rejects.toThrow(
        'API error (404): Resource not found',
      );
    });

    it('should use statusText when error message is not available', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        json: () => Promise.reject(new Error('Parse error')),
      });

      const fetchPromise = fetchWithRetry(
        'https://api.example.com/test',
        { method: 'GET' },
        { maxRetries: 1 },
      );

      await expect(fetchPromise).rejects.toThrow(
        'API error (500): Internal Server Error',
      );
    });

    it('should not retry a 4xx response', async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: false,
        status: 422,
        statusText: 'Unprocessable Entity',
        json: () => Promise.resolve({ detail: 'Bad voice id' }),
      });

      global.fetch = fetchMock;

      await expect(
        fetchWithRetry(
          'https://api.example.com/test',
          { method: 'GET' },
          { maxRetries: 3, baseDelay: 1, maxDelay: 5 },
        ),
      ).rejects.toThrow('API error (422): Bad voice id');

      // Client errors are permanent — retrying just burns quota.
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('should use custom config values', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ data: 'test' }),
      });

      await fetchWithRetry(
        'https://api.example.com/test',
        { method: 'POST' },
        {
          maxRetries: 10,
          timeout: 60000,
          baseDelay: 500,
          maxDelay: 5000,
        },
      );

      expect(fetch).toHaveBeenCalledWith(
        'https://api.example.com/test',
        expect.objectContaining({
          method: 'POST',
          signal: expect.any(AbortSignal),
        }),
      );
    });
  });
});
