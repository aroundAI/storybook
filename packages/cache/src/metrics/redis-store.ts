import type Redis from 'ioredis';

import type { CacheMetrics } from '../index';
import type { MetricsStore } from './storage';

/**
 * Redis-based metrics storage
 *
 * Persists metrics to Redis with atomic operations.
 * Suitable for distributed deployments with multiple cache instances.
 *
 * Storage structure:
 * ```
 * cache:metrics:{cacheId} -> hash {hits, misses, operations, hitRate, timestamp}
 * cache:metrics:instances -> set {cacheId1, cacheId2, ...}
 * ```
 */
export class RedisMetricsStore implements MetricsStore {
  private readonly client: Redis;
  private readonly keyPrefix: string;

  /**
   * @param client - Redis client instance
   * @param keyPrefix - Prefix for metrics keys (default: cache:metrics)
   */
  constructor(client: Redis, keyPrefix = 'cache:metrics') {
    this.client = client;
    this.keyPrefix = keyPrefix;
  }

  async save(metrics: CacheMetrics, cacheId: string): Promise<void> {
    try {
      const key = this.getMetricsKey(cacheId);
      const instancesKey = this.getInstancesKey();

      // Use pipeline for atomic operations
      const pipeline = this.client.pipeline();

      // Save metrics as hash
      pipeline.hset(key, {
        hits: metrics.hits,
        misses: metrics.misses,
        operations: metrics.operations,
        hitRate: metrics.hitRate,
        timestamp: Date.now(),
      });

      // Add to instances set
      pipeline.sadd(instancesKey, cacheId);

      // Set expiry (24 hours)
      pipeline.expire(key, 86400);

      await pipeline.exec();
    } catch (error) {
      console.error('[RedisMetricsStore] Save error:', error);
      // Fail gracefully - don't throw
    }
  }

  async load(cacheId: string): Promise<CacheMetrics | null> {
    try {
      const key = this.getMetricsKey(cacheId);
      const data = await this.client.hgetall(key);

      if (!data || Object.keys(data).length === 0) {
        return null;
      }

      return {
        hits: parseInt(data.hits || '0', 10),
        misses: parseInt(data.misses || '0', 10),
        operations: parseInt(data.operations || '0', 10),
        hitRate: parseFloat(data.hitRate || '0'),
      };
    } catch (error) {
      console.error('[RedisMetricsStore] Load error:', error);
      return null;
    }
  }

  async aggregate(): Promise<CacheMetrics> {
    try {
      const instancesKey = this.getInstancesKey();

      // Get all cache instance IDs
      const cacheIds = await this.client.smembers(instancesKey);

      if (cacheIds.length === 0) {
        return {
          hits: 0,
          misses: 0,
          operations: 0,
          hitRate: 0,
        };
      }

      // Load metrics for all instances
      const metricsPromises = cacheIds.map((id) => this.load(id));
      const allMetrics = await Promise.all(metricsPromises);

      // Aggregate metrics
      let totalHits = 0;
      let totalMisses = 0;

      for (const metrics of allMetrics) {
        if (metrics) {
          totalHits += metrics.hits;
          totalMisses += metrics.misses;
        }
      }

      const operations = totalHits + totalMisses;
      const hitRate = operations > 0 ? (totalHits / operations) * 100 : 0;

      return {
        hits: totalHits,
        misses: totalMisses,
        operations,
        hitRate,
      };
    } catch (error) {
      console.error('[RedisMetricsStore] Aggregate error:', error);
      return {
        hits: 0,
        misses: 0,
        operations: 0,
        hitRate: 0,
      };
    }
  }

  async clear(cacheId: string): Promise<void> {
    try {
      const key = this.getMetricsKey(cacheId);
      const instancesKey = this.getInstancesKey();

      // Use pipeline for atomic operations
      const pipeline = this.client.pipeline();
      pipeline.del(key);
      pipeline.srem(instancesKey, cacheId);

      await pipeline.exec();
    } catch (error) {
      console.error('[RedisMetricsStore] Clear error:', error);
      // Fail gracefully - don't throw
    }
  }

  async clearAll(): Promise<void> {
    try {
      const instancesKey = this.getInstancesKey();

      // Get all cache instance IDs
      const cacheIds = await this.client.smembers(instancesKey);

      if (cacheIds.length === 0) return;

      // Delete all metrics keys
      const keys = cacheIds.map((id) => this.getMetricsKey(id));
      keys.push(instancesKey);

      await this.client.del(...keys);
    } catch (error) {
      console.error('[RedisMetricsStore] Clear all error:', error);
      // Fail gracefully - don't throw
    }
  }

  /**
   * Get metrics key for a cache instance
   */
  private getMetricsKey(cacheId: string): string {
    return `${this.keyPrefix}:${cacheId}`;
  }

  /**
   * Get key for the set of all cache instances
   */
  private getInstancesKey(): string {
    return `${this.keyPrefix}:instances`;
  }
}
