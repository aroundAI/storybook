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
   * Atomically add one to a counter and return the new value. A counter
   * that does not exist (or has expired) starts at 1 and lives for
   * `ttlSeconds`; later increments keep the original expiry. The unit of a
   * fixed-window rate limit (FILM-1904): two concurrent calls can never
   * both read 119 and both write 120.
   * @param key - Counter key
   * @param ttlSeconds - Lifetime set when the counter is created
   */
  incr(key: string, ttlSeconds: number): Promise<number>;

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
 * Metrics storage types
 */
export type MetricsStorageType = 'none' | 'file' | 'redis';

/**
 * Cache configuration
 */
export interface CacheConfig {
  provider: CacheProvider;
  redis?: {
    url: string;
    scanCount?: number; // Number of keys to scan per iteration in SCAN operations (default: 100)
  };
  memory?: {
    maxSize?: number; // Maximum number of items
    maxAge?: number; // Default TTL in seconds
    cleanupInterval?: number; // Cleanup interval in milliseconds
  };
  metrics?: {
    storage?: MetricsStorageType; // Where to persist metrics (default: none)
    cacheId?: string; // Unique ID for this cache instance (default: auto-generated)
    fileStorageDir?: string; // Directory for file storage (default: ./.cache-metrics)
    redisClient?: unknown; // Redis client for metrics storage (if storage=redis)
    persistInterval?: number; // How often to persist metrics in ms (default: 60000)
  };
}

// Re-export cache factory
export { createCacheClient } from './factory';

// Re-export providers for advanced use cases
export { MemoryCache } from './providers/memory';
export { RedisCache } from './providers/redis';

// Re-export metrics storage for advanced use cases
export type { MetricsStore } from './metrics/storage';
export { NoOpMetricsStore } from './metrics/storage';
export { FileMetricsStore } from './metrics/file-store';
export { RedisMetricsStore } from './metrics/redis-store';
