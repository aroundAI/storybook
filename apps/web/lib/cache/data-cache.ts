/**
 * Data Caching Utility
 *
 * Provides a simple wrapper for caching expensive database queries
 * with automatic Redis/Memory fallback based on environment.
 *
 * Usage:
 * ```typescript
 * const project = await cached(
 *   `project:${slug}`,
 *   () => client.from('projects').select('*').eq('slug', slug).single(),
 *   3600 // 1 hour TTL
 * );
 * ```
 */
import { type CacheClient, createCacheClient } from '@kit/cache';

// Singleton cache client
let cacheClient: CacheClient | null = null;

function getCache(): CacheClient {
  if (!cacheClient) {
    cacheClient = createCacheClient();
  }
  return cacheClient;
}

/**
 * Cache wrapper for async functions
 *
 * @param key - Unique cache key
 * @param fn - Function that fetches the data
 * @param ttlSeconds - Time to live in seconds (default: 300 = 5 min)
 * @returns Cached or fresh data
 */
export async function cached<T>(
  key: string,
  fn: () => Promise<T>,
  ttlSeconds = 300,
): Promise<T> {
  const cache = getCache();

  try {
    // Try to get from cache first
    const cachedValue = await cache.get<T>(key);
    if (cachedValue !== null) {
      return cachedValue;
    }
  } catch {
    // Cache miss or error - proceed to fetch
  }

  // Fetch fresh data
  const result = await fn();

  // Cache the result (fire and forget)
  cache.set(key, result, ttlSeconds).catch(() => {
    // Ignore cache write errors - data is still returned
  });

  return result;
}

/**
 * Invalidate cache entries
 *
 * @param keys - Array of cache keys to invalidate
 */
export async function invalidateCache(keys: string[]): Promise<void> {
  const cache = getCache();
  await cache.mdel(keys);
}

/**
 * Get the cache client directly for advanced operations
 */
export function getCacheClient(): CacheClient {
  return getCache();
}

// Re-export cache client type for convenience
export type { CacheClient };
