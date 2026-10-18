import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * FILM-1734, migration 025. `video_traffic_sources` holds two copies of a
 * YouTube day — the Reporting CSV's and the Analytics API's, each under its
 * own `metric_source` — so a reader that sums the table counts that day's
 * views twice. Every read goes through `trafficSourcesOneCopy` in
 * `src/traffic-sources.ts`. A class guard: any other file that selects
 * from the table fails here.
 */
const REPO = path.resolve(__dirname, '../../..');
const ROOTS = ['packages', 'apps'];
const SKIP = new Set([
  'node_modules',
  '__tests__',
  '.next',
  'dist',
  '.turbo',
  'migrations',
  'scripts',
]);
const HOME = path.join('packages', 'clickhouse', 'src', 'traffic-sources.ts');

const READS_TABLE = /FROM\s+video_traffic_sources\b/i;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    if (SKIP.has(entry)) return [];
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.(ts|tsx)$/.test(entry) && !/\.test\.tsx?$/.test(entry)
      ? [full]
      : [];
  });
}

describe('traffic sources are read one copy a day (FILM-1734)', () => {
  const files = ROOTS.flatMap((root) => sourceFiles(path.join(REPO, root)));

  it('finds the source it is checking', () => {
    expect(files.length).toBeGreaterThan(500);
    expect(files.some((file) => file.endsWith(HOME))).toBe(true);
  });

  it('no file but src/traffic-sources.ts selects from video_traffic_sources', () => {
    const offenders = files
      .map((file) => path.relative(REPO, file))
      .filter((rel) => rel !== HOME)
      .filter((rel) =>
        READS_TABLE.test(readFileSync(path.join(REPO, rel), 'utf8')),
      );

    expect(offenders).toEqual([]);
  });

  it('takes the CSV’s copy of a day where it has one, else the Analytics API’s', async () => {
    const { trafficSourcesOneCopy } = await import('../src/traffic-sources');
    const sql = trafficSourcesOneCopy('1 = 1').replace(/\s+/g, ' ');

    expect(sql).toContain(
      "max(metric_source != 'analytics_api') OVER (PARTITION BY video_id, metric_date)",
    );
    expect(sql).toContain(
      "WHERE metric_source != 'analytics_api' OR day_has_csv = 0",
    );
  });
});
