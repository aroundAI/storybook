'use client';

/**
 * LRU Media Cache — least-recently-used cache for decoded media frames.
 *
 * Prevents re-fetching/decoding of thumbnails and waveform data
 * when the user scrolls back and forth in the timeline.
 *
 * Eviction: when capacity is exceeded, the least-recently-used
 * entry is removed. Supports optional TTL (time-to-live).
 */

// ──────────────────────────────────────────
// LRUCache
// ──────────────────────────────────────────

interface CacheEntry<V> {
  value: V;
  createdAt: number;
}

export class LRUCache<V> {
  private cache = new Map<string, CacheEntry<V>>();
  private readonly maxSize: number;
  private readonly ttlMs: number | null;

  constructor(maxSize = 200, ttlMs: number | null = null) {
    this.maxSize = maxSize;
    this.ttlMs = ttlMs;
  }

  get(key: string): V | undefined {
    const entry = this.cache.get(key);
    if (!entry) return undefined;

    // Check TTL
    if (this.ttlMs && Date.now() - entry.createdAt > this.ttlMs) {
      this.cache.delete(key);
      return undefined;
    }

    // Move to end (most recently used) by re-inserting
    this.cache.delete(key);
    this.cache.set(key, entry);
    return entry.value;
  }

  set(key: string, value: V): void {
    // Delete if exists (to update position)
    if (this.cache.has(key)) {
      this.cache.delete(key);
    }

    // Evict LRU entries if at capacity
    while (this.cache.size >= this.maxSize) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey !== undefined) {
        this.cache.delete(firstKey);
      }
    }

    this.cache.set(key, { value, createdAt: Date.now() });
  }

  has(key: string): boolean {
    const entry = this.cache.get(key);
    if (!entry) return false;

    if (this.ttlMs && Date.now() - entry.createdAt > this.ttlMs) {
      this.cache.delete(key);
      return false;
    }

    return true;
  }

  delete(key: string): boolean {
    return this.cache.delete(key);
  }

  clear(): void {
    this.cache.clear();
  }

  get size(): number {
    return this.cache.size;
  }
}

// ──────────────────────────────────────────
// Pre-configured caches
// ──────────────────────────────────────────

/** Cache for thumbnail image blobs (200 entries, 5 min TTL) */
export const thumbnailCache = new LRUCache<string>(200, 5 * 60 * 1000);

/** Cache for waveform data arrays (100 entries, 10 min TTL) */
export const waveformCache = new LRUCache<Float32Array>(100, 10 * 60 * 1000);

/** Cache for decoded video frame URLs (50 entries, 2 min TTL) */
export const frameCache = new LRUCache<string>(50, 2 * 60 * 1000);
