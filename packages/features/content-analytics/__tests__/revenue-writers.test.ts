import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Every writer of a `revenue_cents`, bound to what it may write (KB-12).
 *
 * ClickHouse's `video_metrics.revenue_cents` has **no currency column**, and
 * is not getting one. Every figure read from it — the account dashboard's
 * "Est. Revenue", the scheduled reports, the raw export's `Revenue (USD)`
 * column — is printed as dollars on the strength of one fact: nothing but
 * dollars is ever written there. Today that is true twice over. Every
 * ingest path writes a literal `0`, and the only revenue the platform APIs
 * give us is YouTube's, fetched without a `currency` parameter, which the
 * API answers in USD.
 *
 * The one door a non-USD figure has is a person: the manual revenue form
 * writes `revenue_records` in Postgres, with its currency beside it, and no
 * path copies those rows to ClickHouse.
 *
 * A comment saying so would rot the day someone adds a writer. This reads
 * the source instead: a new assignment to a `revenue_cents` property
 * anywhere fails here until it is listed with the store it writes to and
 * why its currency is known.
 */
const REPO = resolve(__dirname, '../../../..');

/** Everything that ships or seeds. Not one package: a writer can be added anywhere. */
const SCANNED = ['packages', 'apps/web'];

const SKIPPED = [
  'node_modules',
  '.next',
  '.turbo',
  'dist',
  'coverage',
  '__tests__',
  // DDL, and SQL: neither assigns a property.
  'migrations',
  'supabase',
];

/** Fixtures for `pnpm --filter @kit/clickhouse verify`, against a local server. */
const FIXTURES = ['packages/clickhouse/scripts/verify-queries.ts'];

type Store =
  /** `video_metrics` — no currency column, read as USD everywhere. */
  | 'clickhouse'
  /** `revenue_records` — `currency` is written beside the figure. */
  | 'postgres'
  /** A query result or an in-memory row being reshaped; writes nothing. */
  | 'none';

const WRITERS: Record<string, Array<{ value: string; store: Store }>> = {
  'packages/clickhouse/src/queries.ts': [
    // Empty-result defaults and `Number(...)` casts of a SELECT.
    { value: '0', store: 'none' },
    { value: 'Number(row.revenue_cents)', store: 'none' },
  ],
  'packages/features/content-analytics/src/server/aggregation-queries.ts': [
    { value: '0', store: 'none' },
  ],
  'packages/features/content-analytics/src/server/ingest.ts': [
    { value: '0', store: 'clickhouse' },
  ],
  'packages/features/content-analytics/src/server/reporting/report-ingest.ts': [
    { value: '0', store: 'clickhouse' },
  ],
  'packages/features/content-analytics/src/server/analytics-sync-cron.ts': [
    // The snapshot-delta metric row, and the TikTok/Instagram normalizers.
    { value: '0', store: 'clickhouse' },
    // YouTube's estimate, normalized — on its way to `revenue_records`
    // below and to nothing in ClickHouse.
    { value: 'data.totals.estimatedRevenue ?? 0', store: 'none' },
    { value: 'data.ad_revenue_cents', store: 'none' },
    { value: 'data.red_revenue_cents', store: 'none' },
    { value: 'Math.max(0, uncategorized)', store: 'none' },
    // …written with `currency: 'USD'`, asserted below.
    { value: 'write.revenueCents', store: 'postgres' },
  ],
  'packages/features/content-analytics/src/server/revenue-actions.ts': [
    // The manual form: any currency, stored beside the figure.
    { value: 'revenueCents', store: 'postgres' },
  ],
  'apps/web/scripts/local-analytics-fixture.ts': [
    { value: '0', store: 'clickhouse' },
  ],
};

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);

    if (statSync(path).isDirectory()) {
      return SKIPPED.includes(entry) ? [] : sourceFiles(path);
    }

    return /\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry) ? [path] : [];
  });
}

/** Every `revenue_cents: <value>` in the file that is not a type member. */
function revenueCentsAssignments(source: string): string[] {
  return [...source.matchAll(/\brevenue_cents:\s*([^\n]+)/g)]
    .map((match) =>
      match[1]!
        .replace(/\s*\/\/.*$/, '')
        .replace(/\s*\}?,?\s*$/, '')
        .trim(),
    )
    .filter((value) => !/^(number|string)\b[^,]*;?$/.test(value));
}

function found(): Record<string, string[]> {
  const entries = SCANNED.flatMap((dir) => sourceFiles(join(REPO, dir)))
    .map((path): [string, string[]] => [
      relative(REPO, path),
      [...new Set(revenueCentsAssignments(readFileSync(path, 'utf8')))].sort(),
    ])
    .filter(([file, values]) => values.length > 0 && !FIXTURES.includes(file));

  return Object.fromEntries(entries);
}

describe('writers of revenue_cents', () => {
  it('are exactly the ones whose currency is accounted for', () => {
    // If this fails you have added, moved or changed a `revenue_cents`
    // write. ClickHouse has no currency column and its figures are shown
    // as dollars: a new ClickHouse writer must write USD or zero, and
    // anything else belongs in `revenue_records` with its currency.
    expect(found()).toEqual(
      Object.fromEntries(
        Object.entries(WRITERS).map(([file, writers]) => [
          file,
          writers.map(({ value }) => value).sort(),
        ]),
      ),
    );
  });

  it('write nothing but a literal zero to ClickHouse', () => {
    const toClickHouse = Object.values(WRITERS)
      .flat()
      .filter(({ store }) => store === 'clickhouse')
      .map(({ value }) => value);

    // Widening this to YouTube's estimate is legitimate — it is USD, see
    // the next test — but it is a decision, so it is made here on purpose.
    expect([...new Set(toClickHouse)]).toEqual(['0']);
  });

  it('ask YouTube for revenue without a currency, which it answers in USD', () => {
    const provider = readFileSync(
      join(
        REPO,
        'packages/features/content-analytics/src/providers/youtube/youtube-analytics.ts',
      ),
      'utf8',
    );

    expect(provider).toContain("'estimatedRevenue'");
    expect(provider).not.toMatch(/\bcurrency\b/);
  });

  it('stamp every synced revenue_records row as USD', () => {
    const sync = readFileSync(
      join(
        REPO,
        'packages/features/content-analytics/src/server/analytics-sync-cron.ts',
      ),
      'utf8',
    );

    expect(sync).toMatch(
      /revenue_cents: write\.revenueCents,\s*currency: 'USD',\s*source: 'api' as const,/,
    );
    expect(sync.match(/\bcurrency:/g)).toHaveLength(1);
  });
});
