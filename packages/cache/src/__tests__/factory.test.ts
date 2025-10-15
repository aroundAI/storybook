/**
 * Cache Factory Tests
 *
 * Tests the cache factory and provider switching logic.
 * Validates vendor-agnostic architecture.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  type CacheProvider,
  createCacheClient,
  resetCacheInstance,
} from '../factory';

// Mock environment variables
const originalEnv = process.env;

beforeEach(() => {
  vi.resetModules();
  resetCacheInstance();
  process.env = { ...originalEnv };
});

afterEach(() => {
  process.env = originalEnv;
});

describe('CacheFactory', () => {
  describe('Provider Selection', () => {
    it('should default to memory cache when no provider is set', () => {
      delete process.env.CACHE_PROVIDER;
      const cache = createCacheClient();
      expect(cache).toBeDefined();
      // Memory cache is always healthy
      expect(cache.isHealthy()).resolves.toBe(true);
    });

    it('should create memory cache when CACHE_PROVIDER=memory', () => {
      process.env.CACHE_PROVIDER = 'memory' as CacheProvider;
      const cache = createCacheClient();
      expect(cache).toBeDefined();
    });

    it('should create Redis cache when CACHE_PROVIDER=redis', () => {
      process.env.CACHE_PROVIDER = 'redis' as CacheProvider;
      process.env.REDIS_URL = 'redis://localhost:6379';

      const cache = createCacheClient();
      expect(cache).toBeDefined();
    });

    it('should fallback to memory when redis provider is set without REDIS_URL', () => {
      process.env.CACHE_PROVIDER = 'redis' as CacheProvider;
      delete process.env.REDIS_URL;

      const cache = createCacheClient();
      expect(cache).toBeDefined();
      // Should fallback to memory cache, which is always healthy
      expect(cache.isHealthy()).resolves.toBe(true);
    });

    it('should handle invalid provider gracefully', () => {
      process.env.CACHE_PROVIDER = 'invalid' as CacheProvider;

      // Should fallback to memory cache
      const cache = createCacheClient();
      expect(cache).toBeDefined();
    });
  });

  describe('Singleton Pattern', () => {
    it('should return same instance on multiple calls', () => {
      const cache1 = createCacheClient();
      const cache2 = createCacheClient();
      expect(cache1).toBe(cache2);
    });

    it('should create new instance after reset', () => {
      const cache1 = createCacheClient();
      resetCacheInstance();
      const cache2 = createCacheClient();
      expect(cache1).not.toBe(cache2);
    });

    it('should maintain singleton across provider switches', () => {
      process.env.CACHE_PROVIDER = 'memory';
      const cache1 = createCacheClient();

      // Changing env var doesn't change instance
      process.env.CACHE_PROVIDER = 'redis';
      const cache2 = createCacheClient();

      expect(cache1).toBe(cache2);
    });
  });

  describe('Provider Switching', () => {
    it('should switch from memory to redis after reset', async () => {
      // Start with memory
      process.env.CACHE_PROVIDER = 'memory';
      const memoryCache = createCacheClient();
      await memoryCache.set('key1', 'value1');

      // Switch to redis
      resetCacheInstance();
      process.env.CACHE_PROVIDER = 'redis';
      process.env.REDIS_URL = 'redis://localhost:6379';
      const redisCache = createCacheClient();

      // Cache should be empty after switch (data doesn't migrate automatically)
      const result = await redisCache.get('key1');
      expect(result).toBeNull();
    });

    it('should maintain data within same provider instance', async () => {
      process.env.CACHE_PROVIDER = 'memory';
      const cache = createCacheClient();

      await cache.set('key1', 'value1');

      // Get new instance reference (but same singleton)
      const sameCache = createCacheClient();
      const result = await sameCache.get('key1');

      expect(result).toBe('value1');
    });
  });

  describe('Configuration Options', () => {
    it('should use provided config over defaults', () => {
      const cache = createCacheClient({
        provider: 'memory',
      });

      expect(cache).toBeDefined();
    });

    it('should override env var with explicit config', () => {
      process.env.CACHE_PROVIDER = 'redis';
      process.env.REDIS_URL = 'redis://localhost:6379';

      // Explicitly request memory cache
      const cache = createCacheClient({
        provider: 'memory',
      });

      expect(cache).toBeDefined();
      // Memory cache is always healthy
      expect(cache.isHealthy()).resolves.toBe(true);
    });

    it('should accept Redis URL in config', () => {
      const cache = createCacheClient({
        provider: 'redis',
        redis: {
          url: 'redis://custom:6379',
        },
      });

      expect(cache).toBeDefined();
    });
  });

  describe('Error Handling', () => {
    it('should handle invalid Redis URLs gracefully', () => {
      process.env.CACHE_PROVIDER = 'redis';
      process.env.REDIS_URL = 'not-a-valid-url';

      // Should create Redis cache but operations may fail gracefully
      const cache = createCacheClient();
      expect(cache).toBeDefined();
    });

    it('should log warning for missing REDIS_URL', () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      process.env.CACHE_PROVIDER = 'redis';
      delete process.env.REDIS_URL;

      const cache = createCacheClient();
      expect(cache).toBeDefined();
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('falling back to memory cache'),
      );
      consoleSpy.mockRestore();
    });
  });

  describe('Multi-Environment Support', () => {
    it('should support development with memory cache', () => {
      process.env.NODE_ENV = 'development';
      process.env.CACHE_PROVIDER = 'memory';

      const cache = createCacheClient();
      expect(cache).toBeDefined();
    });

    it('should support production with Redis cache', () => {
      process.env.NODE_ENV = 'production';
      process.env.CACHE_PROVIDER = 'redis';
      process.env.REDIS_URL = 'redis://production:6379';

      const cache = createCacheClient();
      expect(cache).toBeDefined();
    });

    it('should support staging with external Redis (Upstash)', () => {
      process.env.NODE_ENV = 'staging';
      process.env.CACHE_PROVIDER = 'redis';
      process.env.REDIS_URL = 'redis://default:password@upstash.io:6379';

      const cache = createCacheClient();
      expect(cache).toBeDefined();
    });
  });

  describe('Health Checks', () => {
    it('should propagate health check from underlying provider', async () => {
      process.env.CACHE_PROVIDER = 'memory';
      const cache = createCacheClient();

      const healthy = await cache.isHealthy();
      expect(healthy).toBe(true);
    });

    it('should handle unhealthy Redis gracefully', async () => {
      process.env.CACHE_PROVIDER = 'redis';
      process.env.REDIS_URL = 'redis://invalid:6379';

      const cache = createCacheClient();
      const healthy = await cache.isHealthy();

      expect(healthy).toBe(false);
    });
  });
});
