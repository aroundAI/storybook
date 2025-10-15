import { promises as fs } from 'fs';
import path from 'path';

import type { CacheMetrics } from '../index';

import type { MetricsStore } from './storage';

/**
 * File-based metrics storage
 *
 * Persists metrics to disk as JSON files.
 * Suitable for single-instance deployments.
 *
 * Directory structure:
 * ```
 * {storageDir}/
 *   cache-metrics-{cacheId}.json
 * ```
 */
export class FileMetricsStore implements MetricsStore {
  private readonly storageDir: string;

  /**
   * @param storageDir - Directory to store metrics files (default: ./.cache-metrics)
   */
  constructor(storageDir = './.cache-metrics') {
    this.storageDir = storageDir;
  }

  async save(metrics: CacheMetrics, cacheId: string): Promise<void> {
    try {
      await this.ensureDirectory();

      const filePath = this.getFilePath(cacheId);
      const data = {
        ...metrics,
        timestamp: Date.now(),
      };

      await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
    } catch (error) {
      console.error('[FileMetricsStore] Save error:', error);
      // Fail gracefully - don't throw
    }
  }

  async load(cacheId: string): Promise<CacheMetrics | null> {
    try {
      const filePath = this.getFilePath(cacheId);
      const data = await fs.readFile(filePath, 'utf-8');
      const parsed = JSON.parse(data);

      return {
        hits: parsed.hits || 0,
        misses: parsed.misses || 0,
        operations: parsed.operations || 0,
        hitRate: parsed.hitRate || 0,
      };
    } catch {
      // File doesn't exist or can't be read - return null
      return null;
    }
  }

  async aggregate(): Promise<CacheMetrics> {
    try {
      await this.ensureDirectory();

      const files = await fs.readdir(this.storageDir);
      const metricsFiles = files.filter((f) =>
        f.startsWith('cache-metrics-'),
      );

      let totalHits = 0;
      let totalMisses = 0;

      for (const file of metricsFiles) {
        try {
          const filePath = path.join(this.storageDir, file);
          const data = await fs.readFile(filePath, 'utf-8');
          const parsed = JSON.parse(data);

          totalHits += parsed.hits || 0;
          totalMisses += parsed.misses || 0;
        } catch {
          // Skip corrupted files
          continue;
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
      console.error('[FileMetricsStore] Aggregate error:', error);
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
      const filePath = this.getFilePath(cacheId);
      await fs.unlink(filePath);
    } catch {
      // File doesn't exist - no-op
    }
  }

  async clearAll(): Promise<void> {
    try {
      await this.ensureDirectory();

      const files = await fs.readdir(this.storageDir);
      const metricsFiles = files.filter((f) =>
        f.startsWith('cache-metrics-'),
      );

      await Promise.all(
        metricsFiles.map((file) =>
          fs.unlink(path.join(this.storageDir, file)).catch(() => {
            // Ignore errors
          }),
        ),
      );
    } catch (error) {
      console.error('[FileMetricsStore] Clear all error:', error);
      // Fail gracefully - don't throw
    }
  }

  /**
   * Get file path for a cache instance
   */
  private getFilePath(cacheId: string): string {
    return path.join(this.storageDir, `cache-metrics-${cacheId}.json`);
  }

  /**
   * Ensure storage directory exists
   */
  private async ensureDirectory(): Promise<void> {
    try {
      await fs.mkdir(this.storageDir, { recursive: true });
    } catch {
      // Directory exists or can't be created
    }
  }
}
