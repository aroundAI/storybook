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
 * Cache metrics for monitoring
 */
export interface CacheMetrics {
  /** Number of successful cache hits */
  hits: number;
  /** Number of cache misses */
  misses: number;
  /** Total number of operations (hits + misses) */
  operations: number;
  /** Cache hit rate as percentage (hits / operations * 100) */
  hitRate: number;
}

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
   * Get multiple values at once
   * @param keys - Array of cache keys
   * @returns Array of values (null for missing keys)
   */
  mget<T>(keys: string[]): Promise<(T | null)[]>;

  /**
   * Set multiple values at once
   * @param entries - Array of [key, value] tuples
   * @param ttlSeconds - Time to live in seconds (optional)
   */
  mset<T>(entries: [string, T][], ttlSeconds?: number): Promise<void>;

  /**
   * Delete multiple keys at once
   * @param keys - Array of cache keys
   */
  mdel(keys: string[]): Promise<void>;

  /**
   * Clear all cache entries
   */
  clear(): Promise<void>;

  /**
   * Check if cache is connected/healthy
   */
  isHealthy(): Promise<boolean>;

  /**
   * Get cache performance metrics
   * @returns Current cache metrics
   */
  getMetrics(): CacheMetrics;

  /**
   * Reset cache metrics
   */
  resetMetrics(): void;

  /**
   * Disconnect from cache (cleanup resources)
   */
  disconnect(): Promise<void>;
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
    cleanupInterval?: number; // Cleanup interval in milliseconds
  };
}

// Re-export cache factory
export { createCacheClient } from './factory';

// Re-export providers for advanced use cases
export { MemoryCache } from './providers/memory';
export { RedisCache } from './providers/redis';
