import Redis from 'ioredis';
import type { CacheClient } from '../index';

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

  constructor(redisUrl: string) {
    // Parse Redis URL and create client
    this.client = new Redis(redisUrl, {
      // Retry strategy with exponential backoff
      retryStrategy: (times: number) => {
        const delay = Math.min(times * 50, 2000);
        return delay;
      },
      // Enable automatic pipelining for better performance
      enableAutoPipelining: true,
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
        return null;
      }

      // Parse JSON
      try {
        return JSON.parse(value) as T;
      } catch {
        // Return as-is if not JSON
        return value as T;
      }
    } catch (error) {
      console.error('[RedisCache] Get error:', error);
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
      throw error;
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
      throw error;
    }
  }

  async clear(): Promise<void> {
    try {
      await this.client.flushdb();
    } catch (error) {
      console.error('[RedisCache] Clear error:', error);
      throw error;
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
        console.log(`[RedisCache] Deleted ${keysDeleted} keys matching pattern: ${pattern}`);
      }
    } catch (error) {
      console.error('[RedisCache] Pattern delete error:', error);
      throw error;
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
