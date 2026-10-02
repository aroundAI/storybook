import type { CacheClient, CacheMetrics } from '../index';
import type { MetricsStore } from '../metrics/storage';
import { NoOpMetricsStore } from '../metrics/storage';

/**
 * Memory cache configuration
 */
interface MemoryCacheConfig {
  maxSize?: number; // Maximum number of items (default: 1000)
  maxAge?: number; // Default TTL in seconds (default: 300 = 5 minutes)
  cleanupInterval?: number; // Cleanup interval in ms (default: 60000 = 1 minute)
}

/**
 * Cache entry with TTL
 */
interface CacheEntry<T> {
  value: T;
  expiresAt: number; // Unix timestamp in milliseconds
}

/**
 * In-memory LRU cache with TTL support
 *
 * Features:
 * - Least Recently Used (LRU) eviction
 * - Per-key TTL support
 * - Automatic cleanup of expired entries
 * - Pattern-based deletion (e.g., 'auth:*')
 * - Performance metrics tracking (hit/miss rates)
 *
 * This is used as a fallback when Redis is not available,
 * or for development/testing environments.
 */
export class MemoryCache implements CacheClient {
  private cache: Map<string, CacheEntry<unknown>>;
  private readonly maxSize: number;
  private readonly defaultTTL: number;
  private readonly cleanupIntervalMs: number;
  private cleanupInterval: NodeJS.Timeout | null = null;
  private metricsStore: MetricsStore;
  private cacheId: string;
  private metricsInterval: NodeJS.Timeout | null = null;
  private metrics = {
    hits: 0,
    misses: 0,
  };

  constructor(
    config?: MemoryCacheConfig,
    metricsStore?: MetricsStore,
    cacheId = 'memory-default',
  ) {
    this.maxSize = config?.maxSize || 1000;
    this.defaultTTL = (config?.maxAge || 300) * 1000; // Convert to milliseconds
    this.cleanupIntervalMs = config?.cleanupInterval || 60000; // Default: 1 minute
    this.cache = new Map();
    this.metricsStore = metricsStore || new NoOpMetricsStore();
    this.cacheId = cacheId;

    // Load persisted metrics
    this.loadMetrics();

    // Start periodic cleanup of expired entries
    this.startCleanup();

    // Start periodic metrics persistence
    this.startMetricsPersistence();
  }

  async get<T>(key: string): Promise<T | null> {
    const entry = this.cache.get(key) as CacheEntry<T> | undefined;

    if (!entry) {
      this.metrics.misses++;
      return null;
    }

    // Check if expired
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      this.metrics.misses++;
      return null;
    }

    // Move to end (LRU)
    this.cache.delete(key);
    this.cache.set(key, entry);

    this.metrics.hits++;
    return entry.value;
  }

  async set<T>(key: string, value: T, ttlSeconds?: number): Promise<void> {
    const ttl = ttlSeconds ? ttlSeconds * 1000 : this.defaultTTL;
    const expiresAt = Date.now() + ttl;

    const entry: CacheEntry<T> = {
      value,
      expiresAt,
    };

    // If at capacity, remove oldest entry (first in Map)
    if (this.cache.size >= this.maxSize && !this.cache.has(key)) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey) {
        this.cache.delete(firstKey);
      }
    }

    this.cache.set(key, entry as CacheEntry<unknown>);
  }

  async del(key: string): Promise<void> {
    // Check if key is a pattern (contains '*')
    if (key.includes('*')) {
      await this.deletePattern(key);
      return;
    }

    this.cache.delete(key);
  }

  async clear(): Promise<void> {
    this.cache.clear();
  }

  async isHealthy(): Promise<boolean> {
    return true; // Memory cache is always healthy
  }

  /**
   * Delete keys matching a pattern
   * Supports simple wildcard patterns (e.g., 'auth:*', 'user:123:*')
   */
  private async deletePattern(pattern: string): Promise<void> {
    const regex = new RegExp(
      '^' + pattern.replace(/\*/g, '.*').replace(/\?/g, '.') + '$',
    );

    const keysToDelete: string[] = [];

    for (const key of this.cache.keys()) {
      if (regex.test(key)) {
        keysToDelete.push(key);
      }
    }

    keysToDelete.forEach((key) => this.cache.delete(key));
  }

  /**
   * Start periodic cleanup of expired entries
   */
  private startCleanup(): void {
    // Clean up at configured interval
    this.cleanupInterval = setInterval(() => {
      this.cleanupExpired();
    }, this.cleanupIntervalMs);

    // Prevent interval from keeping Node.js process alive
    if (this.cleanupInterval.unref) {
      this.cleanupInterval.unref();
    }
  }

  /**
   * Remove all expired entries
   */
  private cleanupExpired(): void {
    const now = Date.now();
    const keysToDelete: string[] = [];

    for (const [key, entry] of this.cache.entries()) {
      if (now > entry.expiresAt) {
        keysToDelete.push(key);
      }
    }

    keysToDelete.forEach((key) => this.cache.delete(key));

    if (keysToDelete.length > 0) {
      console.log(
        `[MemoryCache] Cleaned up ${keysToDelete.length} expired entries`,
      );
    }
  }

  /**
   * Get multiple values at once
   */
  async mget<T>(keys: string[]): Promise<(T | null)[]> {
    const results: (T | null)[] = [];

    for (const key of keys) {
      const value = await this.get<T>(key);
      results.push(value);
    }

    return results;
  }

  /**
   * Set multiple values at once
   */
  async mset<T>(entries: [string, T][], ttlSeconds?: number): Promise<void> {
    for (const [key, value] of entries) {
      await this.set(key, value, ttlSeconds);
    }
  }

  /**
   * Delete multiple keys at once
   */
  async mdel(keys: string[]): Promise<void> {
    for (const key of keys) {
      await this.del(key);
    }
  }

  /**
   * Add one to a counter, creating it with the TTL when absent or expired.
   * Synchronous inside, so two awaiting callers see consecutive values.
   */
  async incr(key: string, ttlSeconds: number): Promise<number> {
    const now = Date.now();
    const entry = this.cache.get(key) as CacheEntry<number> | undefined;

    if (!entry || now > entry.expiresAt || typeof entry.value !== 'number') {
      await this.set(key, 1, ttlSeconds);
      return 1;
    }

    entry.value += 1;
    return entry.value;
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
   * Disconnect from cache (cleanup resources)
   */
  async disconnect(): Promise<void> {
    // Persist metrics one last time before shutdown
    await this.persistMetrics();
    this.destroy();
  }

  /**
   * Stop cleanup interval (for testing/shutdown)
   */
  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }

    if (this.metricsInterval) {
      clearInterval(this.metricsInterval);
      this.metricsInterval = null;
    }

    this.cache.clear();
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
          `[MemoryCache] Loaded persisted metrics for ${this.cacheId}:`,
          saved,
        );
      }
    } catch (error) {
      console.error('[MemoryCache] Failed to load metrics:', error);
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
      console.error('[MemoryCache] Failed to persist metrics:', error);
      // Fail gracefully - don't throw
    }
  }
}
