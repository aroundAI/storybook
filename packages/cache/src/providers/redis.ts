import Redis from 'ioredis';

import type { CacheClient, CacheMetrics } from '../index';
import type { MetricsStore } from '../metrics/storage';
import { NoOpMetricsStore } from '../metrics/storage';

/**
 * Redis cache client
 *
 * Works with:
 * - AWS ElastiCache Redis
 * - Upstash Redis
 * - Self-hosted Redis
 *
 * Features:
 * - Automatic JSON serialization/deserialization
 * - Pattern-based deletion (e.g., 'auth:*')
 * - Connection pooling and auto-reconnect
 * - Error handling with fallback
 */
export class RedisCache implements CacheClient {
  private client: Redis;
  private isConnected = false;
  private metricsStore: MetricsStore;
  private cacheId: string;
  private metricsInterval: NodeJS.Timeout | null = null;
  private readonly scanCount: number;
  private metrics = {
    hits: 0,
    misses: 0,
  };

  constructor(
    redisUrl: string,
    metricsStore?: MetricsStore,
    cacheId = 'redis-default',
    scanCount = 100,
  ) {
    // Validate Redis URL format
    this.validateRedisUrl(redisUrl);

    this.metricsStore = metricsStore || new NoOpMetricsStore();
    this.cacheId = cacheId;
    this.scanCount = scanCount;

    // Parse Redis URL and create client
    const stage = process.env.NODE_ENV || 'development';

    this.client = new Redis(redisUrl, {
      // Retry strategy with exponential backoff
      retryStrategy: (times: number) => {
        const delay = Math.min(times * 50, 2000);
        return delay;
      },
      // Limit retries per request to fail fast instead of queueing
      maxRetriesPerRequest: 3,
      // Enable automatic pipelining for better performance
      enableAutoPipelining: true,
      // Disable offline queue to fail fast when Redis is unavailable
      enableOfflineQueue: false,
      // Connection name for debugging in Redis
      connectionName: `${stage}-cache`,
      // Reconnect on error
      reconnectOnError: (err) => {
        const targetError = 'READONLY';
        if (err.message.includes(targetError)) {
          // Reconnect on READONLY errors (ElastiCache failover)
          return true;
        }
        return false;
      },
      // Connection timeout
      connectTimeout: 10000,
      // Lazy connect (connect on first command)
      lazyConnect: true,
      // Production hardening: Command timeout to prevent hanging operations
      commandTimeout: 5000,
    });

    // Event listeners for monitoring
    this.client.on('connect', () => {
      console.log('[RedisCache] Connected to Redis');
      this.isConnected = true;
    });

    this.client.on('ready', () => {
      console.log('[RedisCache] Redis client ready');
    });

    this.client.on('error', (error) => {
      console.error('[RedisCache] Redis error:', error.message);
      this.isConnected = false;
    });

    this.client.on('close', () => {
      console.warn('[RedisCache] Redis connection closed');
      this.isConnected = false;
    });

    this.client.on('reconnecting', () => {
      console.log('[RedisCache] Reconnecting to Redis...');
    });

    // Connect immediately
    this.connect();

    // Load persisted metrics
    this.loadMetrics();

    // Start periodic metrics persistence
    this.startMetricsPersistence();
  }

  private async connect(): Promise<void> {
    const maxRetries = 3;
    let attempt = 0;

    while (attempt < maxRetries) {
      try {
        await this.client.connect();
        this.isConnected = true;
        console.log(
          `[RedisCache] Connected successfully on attempt ${attempt + 1}`,
        );
        return;
      } catch (error) {
        attempt++;
        console.error(
          `[RedisCache] Connection attempt ${attempt} failed:`,
          error,
        );

        if (attempt === maxRetries) {
          console.error(
            '[RedisCache] Failed to connect after all retries:',
            error,
          );
          this.isConnected = false;
          return;
        }

        // Exponential backoff: 1s, 2s, 3s
        const delay = 1000 * attempt;
        console.log(`[RedisCache] Retrying in ${delay}ms...`);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  async get<T>(key: string): Promise<T | null> {
    try {
      const value = await this.client.get(key);

      if (value === null) {
        this.metrics.misses++;
        return null;
      }

      // Parse JSON
      try {
        const parsed = JSON.parse(value) as T;
        this.metrics.hits++;
        return parsed;
      } catch {
        // Return as-is if not JSON
        this.metrics.hits++;
        return value as T;
      }
    } catch (error) {
      console.error('[RedisCache] Get error:', error);
      this.metrics.misses++;
      return null;
    }
  }

  async set<T>(key: string, value: T, ttlSeconds?: number): Promise<void> {
    try {
      // Serialize value
      const serialized = JSON.stringify(value);

      // Set with TTL if provided
      if (ttlSeconds) {
        await this.client.setex(key, ttlSeconds, serialized);
      } else {
        await this.client.set(key, serialized);
      }
    } catch (error) {
      console.error('[RedisCache] Set error:', error);
      // Fail gracefully - don't throw
    }
  }

  async del(key: string): Promise<void> {
    try {
      // Check if key is a pattern (contains '*' or '?')
      if (key.includes('*') || key.includes('?')) {
        await this.deletePattern(key);
        return;
      }

      await this.client.del(key);
    } catch (error) {
      console.error('[RedisCache] Delete error:', error);
      // Fail gracefully - don't throw
    }
  }

  async clear(): Promise<void> {
    try {
      await this.client.flushdb();
    } catch (error) {
      console.error('[RedisCache] Clear error:', error);
      // Fail gracefully - don't throw
    }
  }

  async isHealthy(): Promise<boolean> {
    try {
      // Check if connected
      if (!this.isConnected) {
        return false;
      }

      // Ping Redis
      const result = await this.client.ping();
      return result === 'PONG';
    } catch {
      return false;
    }
  }

  /**
   * Get multiple values at once
   */
  async mget<T>(keys: string[]): Promise<(T | null)[]> {
    try {
      const values = await this.client.mget(...keys);

      return values.map((value) => {
        if (value === null) {
          this.metrics.misses++;
          return null;
        }

        try {
          const parsed = JSON.parse(value) as T;
          this.metrics.hits++;
          return parsed;
        } catch {
          this.metrics.hits++;
          return value as T;
        }
      });
    } catch (error) {
      console.error('[RedisCache] Mget error:', error);
      // Return empty array on error
      return [];
    }
  }

  /**
   * Set multiple values at once using pipeline
   */
  async mset<T>(entries: [string, T][], ttlSeconds?: number): Promise<void> {
    try {
      const pipeline = this.client.pipeline();

      for (const [key, value] of entries) {
        const serialized = JSON.stringify(value);

        if (ttlSeconds) {
          pipeline.setex(key, ttlSeconds, serialized);
        } else {
          pipeline.set(key, serialized);
        }
      }

      await pipeline.exec();
    } catch (error) {
      console.error('[RedisCache] Mset error:', error);
      // Fail gracefully - don't throw
    }
  }

  /**
   * Delete multiple keys at once
   */
  async mdel(keys: string[]): Promise<void> {
    try {
      if (keys.length === 0) return;
      await this.client.del(...keys);
    } catch (error) {
      console.error('[RedisCache] Mdel error:', error);
      // Fail gracefully - don't throw
    }
  }

  /**
   * Get cache performance metrics
   */
  getMetrics(): CacheMetrics {
    const operations = this.metrics.hits + this.metrics.misses;
    const hitRate = operations > 0 ? (this.metrics.hits / operations) * 100 : 0;

    return {
      hits: this.metrics.hits,
      misses: this.metrics.misses,
      operations,
      hitRate,
    };
  }

  /**
   * Reset cache metrics
   */
  resetMetrics(): void {
    this.metrics.hits = 0;
    this.metrics.misses = 0;
  }

  /**
   * Delete keys matching a pattern using SCAN
   * More efficient than KEYS for large datasets
   *
   * Scan count can be configured via constructor.
   * Recommended values:
   * - Small datasets (<1000 keys): 100-200 (default: 100)
   * - Medium datasets (1000-10000 keys): 500-1000
   * - Large datasets (>10000 keys): 1000-5000
   */
  private async deletePattern(pattern: string): Promise<void> {
    try {
      const stream = this.client.scanStream({
        match: pattern,
        count: this.scanCount,
      });

      const pipeline = this.client.pipeline();
      let keysDeleted = 0;

      for await (const keys of stream) {
        if (keys.length > 0) {
          keys.forEach((key: string) => pipeline.del(key));
          keysDeleted += keys.length;
        }
      }

      if (keysDeleted > 0) {
        await pipeline.exec();
        console.log(
          `[RedisCache] Deleted ${keysDeleted} keys matching pattern: ${pattern}`,
        );
      }
    } catch (error) {
      console.error('[RedisCache] Pattern delete error:', error);
      // Fail gracefully - don't throw
    }
  }

  /**
   * Validate Redis URL format
   */
  private validateRedisUrl(url: string): void {
    if (!url) {
      throw new Error(
        '[RedisCache] Redis URL is required. Please set REDIS_URL environment variable.',
      );
    }

    // Check for valid Redis URL protocol
    const validProtocols = ['redis://', 'rediss://'];
    const hasValidProtocol = validProtocols.some((protocol) =>
      url.startsWith(protocol),
    );

    if (!hasValidProtocol) {
      throw new Error(
        `[RedisCache] Invalid Redis URL format. Must start with 'redis://' (unencrypted) or 'rediss://' (TLS). Got: ${url.substring(0, 20)}...`,
      );
    }

    // Basic URL validation
    try {
      new URL(url);
    } catch (error) {
      throw new Error(
        `[RedisCache] Malformed Redis URL. Please check the URL format. Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }

  /**
   * Close Redis connection (for shutdown)
   */
  async disconnect(): Promise<void> {
    try {
      // Stop metrics persistence
      if (this.metricsInterval) {
        clearInterval(this.metricsInterval);
        this.metricsInterval = null;
      }

      // Persist metrics one last time before shutdown
      await this.persistMetrics();

      await this.client.quit();
      this.isConnected = false;
      console.log('[RedisCache] Disconnected from Redis');
    } catch (error) {
      console.error('[RedisCache] Disconnect error:', error);
    }
  }

  /**
   * Load persisted metrics on initialization
   */
  private async loadMetrics(): Promise<void> {
    try {
      const saved = await this.metricsStore.load(this.cacheId);

      if (saved) {
        this.metrics.hits = saved.hits;
        this.metrics.misses = saved.misses;
        console.log(
          `[RedisCache] Loaded persisted metrics for ${this.cacheId}:`,
          saved,
        );
      }
    } catch (error) {
      console.error('[RedisCache] Failed to load metrics:', error);
      // Continue with zero metrics
    }
  }

  /**
   * Start periodic metrics persistence
   */
  private startMetricsPersistence(): void {
    // Persist metrics every minute by default
    this.metricsInterval = setInterval(
      () => {
        this.persistMetrics();
      },
      60000, // 1 minute
    );

    // Prevent interval from keeping Node.js process alive
    if (this.metricsInterval.unref) {
      this.metricsInterval.unref();
    }
  }

  /**
   * Persist current metrics to store
   */
  private async persistMetrics(): Promise<void> {
    try {
      const metrics = this.getMetrics();
      await this.metricsStore.save(metrics, this.cacheId);
    } catch (error) {
      console.error('[RedisCache] Failed to persist metrics:', error);
      // Fail gracefully - don't throw
    }
  }
}
