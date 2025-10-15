/**
 * Cache Abstraction Layer
 *
 * Provides a unified interface for caching across different providers:
 * - Memory (in-memory LRU cache with TTL)
 * - Redis (ElastiCache, Upstash, self-hosted)
 *
 * Usage:
 * ```typescript
 * import { createCacheClient } from '@kit/cache';
 *
 * const cache = createCacheClient();
 * await cache.set('key', { data: 'value' }, 300); // 5 min TTL
 * const value = await cache.get<{ data: string }>('key');
 * ```
 */

/**
 * Cache client interface
 */
export interface CacheClient {
  /**
   * Get a value from cache
   * @param key - Cache key
   * @returns The cached value or null if not found/expired
   */
  get<T>(key: string): Promise<T | null>;

  /**
   * Set a value in cache
   * @param key - Cache key
   * @param value - Value to cache
   * @param ttlSeconds - Time to live in seconds (optional)
   */
  set<T>(key: string, value: T, ttlSeconds?: number): Promise<void>;

  /**
   * Delete a key from cache
   * @param key - Cache key or pattern (e.g., 'auth:*')
   */
  del(key: string): Promise<void>;

  /**
   * Clear all cache entries
   */
  clear(): Promise<void>;

  /**
   * Check if cache is connected/healthy
   */
  isHealthy(): Promise<boolean>;
}

/**
 * Cache provider types
 */
export type CacheProvider = 'memory' | 'redis';

/**
 * Cache configuration
 */
export interface CacheConfig {
  provider: CacheProvider;
  redis?: {
    url: string;
  };
  memory?: {
    maxSize?: number; // Maximum number of items
    maxAge?: number; // Default TTL in seconds
  };
}

// Re-export cache factory
export { createCacheClient } from './factory';

// Re-export providers for advanced use cases
export { MemoryCache } from './providers/memory';
export { RedisCache } from './providers/redis';
