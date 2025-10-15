import type { CacheClient, CacheConfig, CacheProvider } from './index';
import { MemoryCache } from './providers/memory';
import { RedisCache } from './providers/redis';

/**
 * Singleton cache instance
 */
let cacheInstance: CacheClient | null = null;

/**
 * Create or get cache client instance
 * Uses singleton pattern to reuse connections
 *
 * @param config - Optional cache configuration (reads from env if not provided)
 * @returns Cache client instance
 */
export function createCacheClient(config?: CacheConfig): CacheClient {
  // Return existing instance if available
  if (cacheInstance) {
    return cacheInstance;
  }

  // Load configuration from environment if not provided
  const finalConfig: CacheConfig = config || loadConfigFromEnv();

  console.log('[Cache] Initializing cache client:', {
    provider: finalConfig.provider,
  });

  // Create appropriate provider
  switch (finalConfig.provider) {
    case 'redis': {
      if (!finalConfig.redis?.url) {
        console.warn(
          '[Cache] Redis URL not provided, falling back to memory cache',
        );
        cacheInstance = new MemoryCache(finalConfig.memory);
        break;
      }

      try {
        cacheInstance = new RedisCache(finalConfig.redis.url);
        console.log('[Cache] Redis cache initialized');
      } catch (error) {
        console.error(
          '[Cache] Failed to initialize Redis, using memory cache:',
          error,
        );
        cacheInstance = new MemoryCache(finalConfig.memory);
      }
      break;
    }

    case 'memory':
    default: {
      cacheInstance = new MemoryCache(finalConfig.memory);
      console.log('[Cache] Memory cache initialized');
      break;
    }
  }

  return cacheInstance;
}

/**
 * Load cache configuration from environment variables
 */
function loadConfigFromEnv(): CacheConfig {
  const provider = (process.env.CACHE_PROVIDER as CacheProvider) || 'memory';

  const config: CacheConfig = {
    provider,
  };

  if (provider === 'redis') {
    // Only set redis config if REDIS_URL is provided
    // If not provided, it will fall back to memory cache
    if (process.env.REDIS_URL) {
      config.redis = {
        url: process.env.REDIS_URL,
      };
    }
  }

  if (provider === 'memory') {
    config.memory = {
      maxSize: process.env.CACHE_MAX_SIZE
        ? parseInt(process.env.CACHE_MAX_SIZE, 10)
        : 1000,
      maxAge: process.env.CACHE_MAX_AGE
        ? parseInt(process.env.CACHE_MAX_AGE, 10)
        : 300, // 5 minutes default
    };
  }

  return config;
}

/**
 * Reset cache instance (for testing)
 */
export function resetCacheInstance(): void {
  cacheInstance = null;
}

// Re-export types for testing
export type { CacheProvider };
