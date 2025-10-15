import crypto from 'crypto';

import type { CacheClient, CacheConfig, CacheProvider } from './index';
import { FileMetricsStore } from './metrics/file-store';
import { RedisMetricsStore } from './metrics/redis-store';
import type { MetricsStore } from './metrics/storage';
import { NoOpMetricsStore } from './metrics/storage';
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
    metricsStorage: finalConfig.metrics?.storage || 'none',
  });

  // Create metrics store and get cache ID
  const { store: metricsStore, cacheId } = createMetricsStore(finalConfig);

  // Create appropriate provider
  switch (finalConfig.provider) {
    case 'redis': {
      if (!finalConfig.redis?.url) {
        console.warn(
          '[Cache] Redis URL not provided, falling back to memory cache',
        );
        cacheInstance = new MemoryCache(
          finalConfig.memory,
          metricsStore,
          cacheId,
        );
        break;
      }

      try {
        const scanCount = finalConfig.redis.scanCount || 100;
        cacheInstance = new RedisCache(
          finalConfig.redis.url,
          metricsStore,
          cacheId,
          scanCount,
        );
        console.log('[Cache] Redis cache initialized');
      } catch (error) {
        console.error(
          '[Cache] Failed to initialize Redis, using memory cache:',
          error,
        );
        cacheInstance = new MemoryCache(
          finalConfig.memory,
          metricsStore,
          cacheId,
        );
      }
      break;
    }

    case 'memory':
    default: {
      cacheInstance = new MemoryCache(
        finalConfig.memory,
        metricsStore,
        cacheId,
      );
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
        scanCount: process.env.REDIS_SCAN_COUNT
          ? parseInt(process.env.REDIS_SCAN_COUNT, 10)
          : 100,
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

  // Metrics configuration
  const metricsStorage = process.env.CACHE_METRICS_STORAGE;

  if (metricsStorage && metricsStorage !== 'none') {
    config.metrics = {
      storage: metricsStorage as 'file' | 'redis',
      cacheId: process.env.CACHE_METRICS_ID,
      fileStorageDir: process.env.CACHE_METRICS_FILE_DIR,
      persistInterval: process.env.CACHE_METRICS_PERSIST_INTERVAL
        ? parseInt(process.env.CACHE_METRICS_PERSIST_INTERVAL, 10)
        : 60000,
    };
  }

  return config;
}

/**
 * Create metrics store based on configuration
 */
function createMetricsStore(config: CacheConfig): {
  store: MetricsStore;
  cacheId: string;
} {
  const storageType = config.metrics?.storage || 'none';

  // Generate cache ID if not provided
  const cacheId =
    config.metrics?.cacheId || crypto.randomBytes(8).toString('hex');

  switch (storageType) {
    case 'file': {
      const store = new FileMetricsStore(config.metrics?.fileStorageDir);
      console.log('[Cache] File-based metrics storage enabled:', {
        cacheId,
      });
      return { store, cacheId };
    }

    case 'redis': {
      const redisClient = config.metrics?.redisClient;

      if (!redisClient) {
        console.warn(
          '[Cache] Redis metrics storage requested but no client provided, using no-op store',
        );
        return { store: new NoOpMetricsStore(), cacheId };
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const store = new RedisMetricsStore(redisClient as any);
      console.log('[Cache] Redis-based metrics storage enabled:', {
        cacheId,
      });
      return { store, cacheId };
    }

    case 'none':
    default: {
      return { store: new NoOpMetricsStore(), cacheId };
    }
  }
}

/**
 * Reset cache instance (for testing)
 */
export function resetCacheInstance(): void {
  cacheInstance = null;
}

// Re-export types for testing
export type { CacheProvider };
