/**
 * Memory Cache Tests
 *
 * Tests the in-memory LRU cache implementation with TTL support
 */
import { beforeEach, describe, expect, it } from 'vitest';

import { MemoryCache } from '../providers/memory';

describe('MemoryCache', () => {
  let cache: MemoryCache;

  beforeEach(() => {
    cache = new MemoryCache({ maxSize: 100, maxAge: 5 });
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
      await cache.set('temp', 'value', 1); // 1 second TTL
      const immediate = await cache.get('temp');
      expect(immediate).toBe('value');

      // Wait for expiration
      await new Promise((resolve) => setTimeout(resolve, 1100));
      const expired = await cache.get('temp');
      expect(expired).toBeNull();
    });

    it('should delete keys', async () => {
      await cache.set('key1', 'value1');
      await cache.del('key1');
      const result = await cache.get('key1');
      expect(result).toBeNull();
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

      const result1 = await cache.get('key1');
      const result2 = await cache.get('key2');
      expect(result1).toBe('value1');
      expect(result2).toBe('value2');
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

  describe('Counters (FILM-1904)', () => {
    it('incr starts at 1 and counts up', async () => {
      expect(await cache.incr('rl:a', 60)).toBe(1);
      expect(await cache.incr('rl:a', 60)).toBe(2);
      expect(await cache.incr('rl:a', 60)).toBe(3);
      expect(await cache.incr('rl:b', 60)).toBe(1);
    });

    it('concurrent increments never share a value', async () => {
      const values = await Promise.all(
        Array.from({ length: 50 }, () => cache.incr('rl:burst', 60)),
      );

      expect([...values].sort((a, b) => a - b)).toEqual(
        Array.from({ length: 50 }, (_, i) => i + 1),
      );
    });

    it('a counter restarts at 1 once its TTL has passed', async () => {
      await cache.incr('rl:short', 1);
      await cache.incr('rl:short', 1);

      await new Promise((resolve) => setTimeout(resolve, 1100));

      expect(await cache.incr('rl:short', 1)).toBe(1);
    });
  });

  describe('TTL and Expiration', () => {
    it('should respect default TTL', async () => {
      const shortCache = new MemoryCache({ maxAge: 1 }); // 1 second default TTL
      await shortCache.set('key1', 'value1');

      // Immediate access should work
      const immediate = await shortCache.get('key1');
      expect(immediate).toBe('value1');

      // Wait for expiration
      await new Promise((resolve) => setTimeout(resolve, 1100));
      const expired = await shortCache.get('key1');
      expect(expired).toBeNull();
    });

    it('should cleanup expired entries automatically', async () => {
      const cache = new MemoryCache({ maxAge: 1, maxSize: 100 });

      await cache.set('key1', 'value1');
      await cache.set('key2', 'value2');

      // Wait for cleanup interval
      await new Promise((resolve) => setTimeout(resolve, 1100));

      // Trigger cleanup by accessing
      await cache.get('key1');

      const result1 = await cache.get('key1');
      const result2 = await cache.get('key2');

      expect(result1).toBeNull();
      expect(result2).toBeNull();
    });
  });

  describe('LRU Eviction', () => {
    it('should evict oldest entry when maxSize is reached', async () => {
      const smallCache = new MemoryCache({ maxSize: 3 });

      await smallCache.set('key1', 'value1');
      await smallCache.set('key2', 'value2');
      await smallCache.set('key3', 'value3');
      await smallCache.set('key4', 'value4'); // Should evict key1

      const result1 = await smallCache.get('key1');
      const result4 = await smallCache.get('key4');

      expect(result1).toBeNull(); // Evicted
      expect(result4).toBe('value4'); // Still exists
    });

    it('should update access order on get', async () => {
      const smallCache = new MemoryCache({ maxSize: 3 });

      await smallCache.set('key1', 'value1');
      await smallCache.set('key2', 'value2');
      await smallCache.set('key3', 'value3');

      // Access key1 to move it to front
      await smallCache.get('key1');

      // Add new key - should evict key2 (least recently used)
      await smallCache.set('key4', 'value4');

      const result1 = await smallCache.get('key1');
      const result2 = await smallCache.get('key2');
      const result4 = await smallCache.get('key4');

      expect(result1).toBe('value1'); // Still exists (recently accessed)
      expect(result2).toBeNull(); // Evicted
      expect(result4).toBe('value4'); // New entry
    });
  });

  describe('Health Check', () => {
    it('should always report healthy', async () => {
      const healthy = await cache.isHealthy();
      expect(healthy).toBe(true);
    });
  });

  describe('Disconnect', () => {
    it('should clear cache and stop cleanup on disconnect', async () => {
      await cache.set('key1', 'value1');
      await cache.disconnect();

      const result = await cache.get('key1');
      expect(result).toBeNull();
    });
  });
});
