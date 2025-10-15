import Redis from 'ioredis';

import type { CacheClient, CacheMetrics } from '../index';

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
  private metrics = {
    hits: 0,
    misses: 0,
  };

  constructor(redisUrl: string) {
    // Validate Redis URL format
    this.validateRedisUrl(redisUrl);

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
  }

  private async connect(): Promise<void> {
    try {
      await this.client.connect();
      this.isConnected = true;
    } catch (error) {
      console.error('[RedisCache] Failed to connect:', error);
      this.isConnected = false;
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
   */
  private async deletePattern(pattern: string): Promise<void> {
    try {
      const stream = this.client.scanStream({
        match: pattern,
        count: 100, // Number of keys to scan per iteration
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
      await this.client.quit();
      this.isConnected = false;
      console.log('[RedisCache] Disconnected from Redis');
    } catch (error) {
      console.error('[RedisCache] Disconnect error:', error);
    }
  }
}
