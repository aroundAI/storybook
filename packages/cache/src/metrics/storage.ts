import type { CacheMetrics } from '../index';

/**
 * Interface for persisting cache metrics
 *
 * Enables metrics to survive cache restarts and be aggregated
 * across multiple instances for distributed systems.
 */
export interface MetricsStore {
  /**
   * Save metrics to persistent storage
   * @param metrics - Current cache metrics snapshot
   * @param cacheId - Unique identifier for this cache instance
   */
  save(metrics: CacheMetrics, cacheId: string): Promise<void>;

  /**
   * Load metrics from persistent storage
   * @param cacheId - Unique identifier for this cache instance
   * @returns Saved metrics or null if not found
   */
  load(cacheId: string): Promise<CacheMetrics | null>;

  /**
   * Aggregate metrics from all cache instances
   * @returns Combined metrics across all instances
   */
  aggregate(): Promise<CacheMetrics>;

  /**
   * Clear stored metrics for a specific cache instance
   * @param cacheId - Unique identifier for this cache instance
   */
  clear(cacheId: string): Promise<void>;

  /**
   * Clear all stored metrics
   */
  clearAll(): Promise<void>;
}

/**
 * No-op metrics store (default)
 *
 * Used when metrics persistence is not configured.
 * All operations succeed but do nothing.
 */
export class NoOpMetricsStore implements MetricsStore {
  async save(): Promise<void> {
    // No-op
  }

  async load(): Promise<CacheMetrics | null> {
    return null;
  }

  async aggregate(): Promise<CacheMetrics> {
    return {
      hits: 0,
      misses: 0,
      operations: 0,
      hitRate: 0,
    };
  }

  async clear(): Promise<void> {
    // No-op
  }

  async clearAll(): Promise<void> {
    // No-op
  }
}
