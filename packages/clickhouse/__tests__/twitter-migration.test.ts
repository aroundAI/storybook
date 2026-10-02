import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { ANALYTICS_PLATFORMS } from '../src/lib/data-provenance';
import {
  PLATFORM_ENUM_TYPE,
  PLATFORM_ENUM_VALUES,
} from '../src/lib/platform-enum';
import {
  ENUM_TABLES_AFTER_021,
  PLATFORM_ENUM_AFTER_021,
} from '../src/migrations/021_twitter';

/**
 * FILM-1727: X's value is appended to the platform enum, never renumbering,
 * on every table that carries it, and the query parameter type says the same.
 */

const SRC = resolve(import.meta.dirname, '../src');
const migrations = (name: string) =>
  readFileSync(join(SRC, 'migrations', name), 'utf8');

describe('migration 021 appends twitter', () => {
  it('names X by the value Postgres stores', () => {
    expect(PLATFORM_ENUM_VALUES.twitter).toBe(5);
    expect(ANALYTICS_PLATFORMS).toContain('twitter');
    expect(ANALYTICS_PLATFORMS).not.toContain('x');
  });

  it('keeps every earlier ordinal, facebook included, and adds the next one', () => {
    expect(PLATFORM_ENUM_AFTER_021).toBe(
      "Enum('youtube' = 1, 'tiktok' = 2, 'instagram' = 3, 'facebook' = 4, 'twitter' = 5)",
    );
    expect(migrations('020_facebook.ts')).toContain("'facebook' = 4");
  });

  it('is what a query filter declares for its platforms parameter', () => {
    expect(PLATFORM_ENUM_TYPE).toBe(PLATFORM_ENUM_AFTER_021);
  });

  it('widens all seven tables that carry the enum, channel_windows included', () => {
    const declared = new Set<string>();

    for (const name of [
      '002_metrics_v2.ts',
      '003_reach_and_traffic.ts',
      '004_extended_metrics.ts',
      '016_channel_windows.ts',
    ]) {
      for (const [, table] of migrations(name).matchAll(
        /CREATE TABLE IF NOT EXISTS (\w+) \(\s*(?:[^()]*?\n)*?\s*platform Enum\(/g,
      )) {
        declared.add(table!);
      }
    }

    expect([...ENUM_TABLES_AFTER_021].sort()).toEqual([...declared].sort());
    expect(ENUM_TABLES_AFTER_021).toHaveLength(7);
  });

  it('makes shares nullable on both counter tables and rebuilds the view after', () => {
    const source = migrations('021_twitter.ts');
    const modify = source.indexOf(
      'ALTER TABLE video_metrics MODIFY COLUMN shares Nullable(UInt32)',
    );
    const snapshots = source.indexOf(
      'ALTER TABLE video_snapshots MODIFY COLUMN shares Nullable(UInt32)',
    );
    const view = source.indexOf('CREATE VIEW IF NOT EXISTS video_daily_stats');

    expect(modify).toBeGreaterThan(-1);
    expect(snapshots).toBeGreaterThan(-1);
    expect(view).toBeGreaterThan(Math.max(modify, snapshots));
    expect(source).not.toMatch(/UPDATE\s+shares/);
  });
});
