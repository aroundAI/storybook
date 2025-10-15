import type { CacheClient } from '../index';

/**
 * Memory cache configuration
 */
interface MemoryCacheConfig {
  maxSize?: number; // Maximum number of items (default: 1000)
  maxAge?: number; // Default TTL in seconds (default: 300 = 5 minutes)
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
 *
 * This is used as a fallback when Redis is not available,
 * or for development/testing environments.
 */
export class MemoryCache implements CacheClient {
  private cache: Map<string, CacheEntry<unknown>>;
  private readonly maxSize: number;
  private readonly defaultTTL: number;
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor(config?: MemoryCacheConfig) {
    this.maxSize = config?.maxSize || 1000;
    this.defaultTTL = (config?.maxAge || 300) * 1000; // Convert to milliseconds
    this.cache = new Map();

    // Start periodic cleanup of expired entries (every minute)
    this.startCleanup();
  }

  async get<T>(key: string): Promise<T | null> {
    const entry = this.cache.get(key) as CacheEntry<T> | undefined;

    if (!entry) {
      return null;
    }

    // Check if expired
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return null;
    }

    // Move to end (LRU)
    this.cache.delete(key);
    this.cache.set(key, entry);

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
    // Clean up every minute
    this.cleanupInterval = setInterval(() => {
      this.cleanupExpired();
    }, 60000);

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
      console.log(`[MemoryCache] Cleaned up ${keysToDelete.length} expired entries`);
    }
  }

  /**
   * Stop cleanup interval (for testing/shutdown)
   */
  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    this.cache.clear();
  }
}
