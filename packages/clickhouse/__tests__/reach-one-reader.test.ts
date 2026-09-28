import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Unique-account figures do not add up (cross-platform reach design,
 * approved 2026-09-28): not across posts, channels or platforms, where one
 * person would be counted twice. `src/reach.ts` holds the only readers, each
 * for one channel or one post. This fails any other source file that
 * aggregates `accounts_reached` in SQL or reads `channel_windows` — a class
 * guard, not a per-site one.
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

const HOME = path.join('packages', 'clickhouse', 'src', 'reach.ts');

/** Any SQL aggregate over the column: sum, avg, sumIf, uniq, max… */
const AGGREGATED =
  /(?<![.\w])(sum|avg|sumIf|avgIf|max|min|uniq\w*|quantile\w*|any\w*)\s*\([^)]*accounts_reached/i;

/** A read of the per-window table. */
const READS_WINDOWS = /FROM\s+channel_windows\b/i;

/**
 * Files outside `reach.ts` allowed to touch it, each with why. Nothing here
 * reads a reach figure for display.
 */
const ALLOWED: Record<string, string> = {
  // `argMax(tuple(accounts_reached), fetched_at).1`: the one post's latest
  // snapshot, the next day's baseline — not an aggregate across posts.
  [path.join('packages', 'clickhouse', 'src', 'queries.ts')]: 'baseline',
  // Which `as_of` days are complete: counts window rows, reads no figure.
  [path.join('packages', 'clickhouse', 'src', 'queries-advanced.ts')]:
    'capture bookkeeping',
};

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

export function breaksTheRule(source: string): string[] {
  return [
    AGGREGATED.test(source) && 'aggregates accounts_reached',
    READS_WINDOWS.test(source) && 'reads channel_windows',
  ].filter((reason): reason is string => Boolean(reason));
}

describe('unique reach has one reader (cross-platform reach design)', () => {
  const files = ROOTS.flatMap((root) => sourceFiles(path.join(REPO, root)));

  it('finds the source it is checking', () => {
    expect(files.length).toBeGreaterThan(500);
    expect(files.some((f) => f.endsWith(HOME))).toBe(true);
  });

  it('no file but src/reach.ts aggregates accounts_reached or reads channel_windows', () => {
    const offenders = files
      .map((file) => [path.relative(REPO, file), file] as const)
      .filter(([rel]) => rel !== HOME && !(rel in ALLOWED))
      .flatMap(([rel, file]) =>
        breaksTheRule(readFileSync(file, 'utf8')).map(
          (reason) => `${rel}: ${reason}`,
        ),
      );

    expect(
      offenders,
      'read unique reach through src/reach.ts, one channel or one post at a time',
    ).toEqual([]);
  });

  it('flags the shapes it guards against', () => {
    expect(
      breaksTheRule('SELECT sum(accounts_reached) FROM video_metrics'),
    ).toEqual(['aggregates accounts_reached']);
    expect(breaksTheRule('SELECT * FROM channel_windows FINAL')).toEqual([
      'reads channel_windows',
    ]);
    expect(
      breaksTheRule('accounts_reached: input.delta.accounts_reached'),
    ).toEqual([]);
    // TypeScript's Math.max is the delta clamp, not a SQL aggregate.
    expect(
      breaksTheRule('Math.max(0, current - baseline.accounts_reached)'),
    ).toEqual([]);
  });
});
