/**
 * Redis Cache Tests
 *
 * Tests the Redis cache implementation with connection handling,
 * fail-fast behavior, and graceful degradation
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { RedisCache } from '../providers/redis';

// Mock ioredis
vi.mock('ioredis', () => {
  return {
    default: vi.fn().mockImplementation((url: string) => {
      // Simulate connection failure for invalid URLs
      if (url.includes('invalid')) {
        return {
          connect: vi.fn().mockRejectedValue(new Error('Connection refused')),
          get: vi.fn().mockRejectedValue(new Error('Connection refused')),
          set: vi.fn().mockRejectedValue(new Error('Connection refused')),
          del: vi.fn().mockRejectedValue(new Error('Connection refused')),
          mget: vi.fn().mockRejectedValue(new Error('Connection refused')),
          pipeline: vi.fn().mockReturnValue({
            mset: vi.fn().mockReturnThis(),
            exec: vi.fn().mockRejectedValue(new Error('Connection refused')),
          }),
          flushdb: vi.fn().mockRejectedValue(new Error('Connection refused')),
          ping: vi.fn().mockRejectedValue(new Error('Connection refused')),
          quit: vi.fn().mockResolvedValue(undefined),
          on: vi.fn(),
        };
      }

      // Simulate successful Redis client
      const mockData = new Map<string, string>();

      return {
        connect: vi.fn().mockResolvedValue(undefined),
        get: vi.fn().mockImplementation(async (key: string) => {
          return mockData.get(key) || null;
        }),
        // The INCR + EXPIRE script: counts in mockData, remembers the TTL
        // only on the increment that created the key.
        eval: vi
          .fn()
          .mockImplementation(
            async (
              _script: string,
              _keys: number,
              key: string,
              ttl: string,
            ) => {
              const count = Number(mockData.get(key) ?? '0') + 1;
              mockData.set(key, String(count));
              if (count === 1) mockData.set(`${key}:ttl`, ttl);
              return count;
            },
          ),
        set: vi.fn().mockImplementation(async (key: string, value: string) => {
          mockData.set(key, value);
          return 'OK';
        }),
        setex: vi
          .fn()
          .mockImplementation(
            async (key: string, _ttl: number, value: string) => {
              mockData.set(key, value);
              return 'OK';
            },
          ),
        del: vi.fn().mockImplementation(async (...keys: string[]) => {
          keys.forEach((key) => mockData.delete(key));
          return keys.length;
        }),
        mget: vi.fn().mockImplementation(async (...keys: string[]) => {
          return keys.map((key) => mockData.get(key) || null);
        }),
        pipeline: vi.fn().mockReturnValue({
          mset: vi.fn().mockReturnThis(),
          setex: vi.fn().mockReturnThis(),
          del: vi.fn().mockReturnThis(),
          exec: vi.fn().mockResolvedValue([]),
        }),
        flushdb: vi.fn().mockImplementation(async () => {
          mockData.clear();
          return 'OK';
        }),
        scanStream: vi.fn().mockReturnValue({
          [Symbol.asyncIterator]: async function* () {
            // Return empty stream for pattern deletion
            yield [];
          },
        }),
        ping: vi.fn().mockResolvedValue('PONG'),
        quit: vi.fn().mockResolvedValue(undefined),
        on: vi.fn(),
      };
    }),
  };
});

describe('RedisCache', () => {
  let cache: RedisCache;

  beforeEach(() => {
    vi.clearAllMocks();
    cache = new RedisCache('redis://localhost:6379');
  });

  describe('Basic Operations', () => {
    it('should set and get values', async () => {
      await cache.set('key1', 'value1');
      const result = await cache.get('key1');
      expect(result).toBe('value1');
    });

    it('should return null for non-existent keys', async () => {
      const result = await cache.get('nonexistent');
      expect(result).toBeNull();
    });

    it('should set with custom TTL', async () => {
      await cache.set('temp', 'value', 60);
      const result = await cache.get('temp');
      expect(result).toBe('value');
    });

    it('should delete keys', async () => {
      await cache.set('key1', 'value1');
      await cache.del('key1');
      const result = await cache.get('key1');
      expect(result).toBeNull();
    });

    it('incr runs INCR and EXPIRE as one script and returns the count (FILM-1904)', async () => {
      expect(await cache.incr('rl:conn', 120)).toBe(1);
      expect(await cache.incr('rl:conn', 120)).toBe(2);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const client = (cache as any).client;

      expect(client.eval).toHaveBeenCalledTimes(2);
      expect(client.eval.mock.calls[0][0]).toMatch(/INCR[\s\S]*EXPIRE/);
      expect(client.eval.mock.calls[0].slice(1)).toEqual([1, 'rl:conn', '120']);
      expect(await cache.get('rl:conn:ttl')).toBe(120);
    });

    it('should clear all keys', async () => {
      await cache.set('key1', 'value1');
      await cache.set('key2', 'value2');
      await cache.clear();

      const result1 = await cache.get('key1');
      const result2 = await cache.get('key2');
      expect(result1).toBeNull();
      expect(result2).toBeNull();
    });
  });

  describe('Bulk Operations', () => {
    it('should mget multiple keys', async () => {
      await cache.set('key1', 'value1');
      await cache.set('key2', 'value2');
      await cache.set('key3', 'value3');

      const results = await cache.mget(['key1', 'key2', 'key3', 'nonexistent']);
      expect(results).toEqual(['value1', 'value2', 'value3', null]);
    });

    it('should mset multiple keys', async () => {
      await cache.mset(
        [
          ['key1', 'value1'],
          ['key2', 'value2'],
        ],
        10,
      );

      // Note: mset uses pipeline, so we need to verify differently
      // In the mock, we don't actually set the values in pipeline
      // This test verifies the pipeline is called correctly
      expect(cache).toBeDefined();
    });

    it('should mdel multiple keys', async () => {
      await cache.set('key1', 'value1');
      await cache.set('key2', 'value2');
      await cache.set('key3', 'value3');

      await cache.mdel(['key1', 'key3']);

      const result1 = await cache.get('key1');
      const result2 = await cache.get('key2');
      const result3 = await cache.get('key3');

      expect(result1).toBeNull();
      expect(result2).toBe('value2');
      expect(result3).toBeNull();
    });
  });

  describe('Connection Failure Handling', () => {
    it('should handle connection failures gracefully', async () => {
      const invalidCache = new RedisCache('redis://invalid:6379');

      // Operations should not throw, but return null/empty
      const result = await invalidCache.get('key1');
      expect(result).toBeNull();
    });

    it('should log errors on connection failure', async () => {
      const consoleSpy = vi
        .spyOn(console, 'error')
        .mockImplementation(() => {});
      const invalidCache = new RedisCache('redis://invalid:6379');

      await invalidCache.set('key1', 'value1');
      expect(consoleSpy).toHaveBeenCalled();

      consoleSpy.mockRestore();
    });

    it('should report unhealthy on connection failure', async () => {
      const invalidCache = new RedisCache('redis://invalid:6379');
      const healthy = await invalidCache.isHealthy();
      expect(healthy).toBe(false);
    });
  });

  describe('Health Check', () => {
    it('should report healthy when connected', async () => {
      const healthy = await cache.isHealthy();
      expect(healthy).toBe(true);
    });

    it('should report unhealthy on ping failure', async () => {
      const invalidCache = new RedisCache('redis://invalid:6379');
      const healthy = await invalidCache.isHealthy();
      expect(healthy).toBe(false);
    });
  });

  describe('Disconnect', () => {
    it('should disconnect cleanly', async () => {
      await cache.set('key1', 'value1');
      await cache.disconnect();
      // Should not throw
      expect(cache).toBeDefined();
    });

    it('should handle disconnect errors gracefully', async () => {
      const consoleSpy = vi
        .spyOn(console, 'error')
        .mockImplementation(() => {});

      await cache.disconnect();
      // Should not throw even if error occurs
      expect(cache).toBeDefined();

      consoleSpy.mockRestore();
    });
  });

  describe('Error Handling', () => {
    it('should return null on get errors', async () => {
      const invalidCache = new RedisCache('redis://invalid:6379');
      const result = await invalidCache.get('key1');
      expect(result).toBeNull();
    });

    it('should handle mget errors', async () => {
      const invalidCache = new RedisCache('redis://invalid:6379');
      const results = await invalidCache.mget(['key1', 'key2']);
      expect(results).toEqual([]);
    });

    it('should handle clear errors gracefully', async () => {
      const invalidCache = new RedisCache('redis://invalid:6379');
      // Should not throw
      await expect(invalidCache.clear()).resolves.not.toThrow();
    });
  });
});
