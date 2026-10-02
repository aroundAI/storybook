import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * FILM-1732: no rate over views is computed without recording which
 * definitions of a view it divided by. Every division by a views value
 * lives in `lib/measures.ts`, beside `recordViewsDenominator`, or in a file
 * below that says why it is not a rate of another event over views. A new
 * one fails here until it is recorded or argued out. A class guard, as
 * `engagement-rate-one-definition.test.ts` is for the formula.
 */

const REPO = path.resolve(__dirname, '../../..');
const ROOTS = ['packages', 'apps'];
const SKIP = new Set(['node_modules', '__tests__', '.next', 'dist', '.turbo']);
const HOME = path.join('packages', 'clickhouse', 'src', 'lib', 'measures.ts');

/**
 * Something divided by an expression that ends in a views value, wrapped
 * in calls or not: `x / views`, `sum(likes) / sum(views)`,
 * `x / nullIf(sum(d.views), 0)`, `x / Math.max(1, stats.views)`.
 */
const DIVIDED_BY_VIEWS =
  /[\w)\]!]\s*\/\s*\(?\s*(?:[\w.]+\(\s*(?:[^(),;]+,\s*)?)*[\w.?!]*(?:views|Views|VIEWS)\b(?![\w(])/g;

/**
 * A helper that divides, handed views as its divisor: `ratio(likes, views)`,
 * `safeDivide(x, totalViews)`, ClickHouse's `divide(sum(likes), sum(views))`.
 * The name says it divides; `recorded…` helpers return the record with the
 * rate, so they are the recording path itself.
 */
const HELPER_OVER_VIEWS =
  /\b(?!recorded)\w*(?:[Rr]atio|[Dd]ivide|[Dd]iv|[Rr]ate|[Pp]ercent|[Pp]ct|Rpm|rpm)\w*\s*\((?:[^()]|\([^()]*\))*?,\s*(?:[\w.]+\(\s*)*[\w.?!]*(?:views|Views|VIEWS)\b(?![\w(])/g;

/**
 * A division by an interpolated value in SQL: `v_shares / ${denominator}`.
 * What `${…}` holds cannot be read here, so it counts until it is listed
 * with a reason, whatever it names. A space before the slash, as SQL
 * writes a division and a path (`/home/${slug}`) never does.
 */
const DIVIDED_BY_INTERPOLATION = /[\w)\]]\s+\/\s*\$\{[^}]*\}/g;

/**
 * Comments say "views" without dividing by them, and so does an import
 * path. Strings stay: a rate written as SQL in a string is still a rate.
 */
function code(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, ''))
    .replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1')
    .replace(/(\bfrom\s*|\bimport\s*\(?\s*)(['"])[^'"\n]*\2/g, "$1''");
}

function divisionsByViews(source: string): string[] {
  const text = code(source);

  return [
    ...(text.match(DIVIDED_BY_VIEWS) ?? []),
    ...(text.match(HELPER_OVER_VIEWS) ?? []),
    ...(text.match(DIVIDED_BY_INTERPOLATION) ?? []),
  ];
}

const at = (...parts: string[]) => path.join(...parts);
const ANALYTICS = at('packages', 'features', 'content-analytics', 'src');

/**
 * Divisions by views that are not a rate of another event over views,
 * each with how many and why (FILM-1732 notes §2, "Considered and out of
 * scope"). A count, so a second division in a listed file still fails.
 */
const NOT_A_RATE_OVER_VIEWS: Record<string, { count: number; why: string }> = {
  [at(ANALYTICS, 'components', 'analytics-enhancement-cards.tsx')]: {
    count: 1,
    why: 'One language’s views over another’s: views over views.',
  },
  [at(ANALYTICS, 'components', 'language-analytics-cards.tsx')]: {
    count: 1,
    why: 'A language’s share of views.',
  },
  [at(ANALYTICS, 'components', 'episode-analytics.tsx')]: {
    count: 1,
    why: 'On-screen copy stating the formula; the figure beside it is recorded.',
  },
  [at(ANALYTICS, 'components', 'season-overview.tsx')]: {
    count: 1,
    why: 'A bar’s width: an episode’s views over the top episode’s.',
  },
  [at(ANALYTICS, 'components', 'overview', 'platform-split-card.tsx')]: {
    count: 1,
    why: 'A platform’s share of views.',
  },
  [at(ANALYTICS, 'components', 'deep-dive', 'median-views-card.tsx')]: {
    count: 1,
    why: 'Change in median views: views over views.',
  },
  [at(ANALYTICS, 'components', 'deep-dive', 'deep-dive-tab.tsx')]: {
    count: 1,
    why: 'A traffic bucket’s share of views.',
  },
  [at(ANALYTICS, 'server', 'aggregation-queries.ts')]: {
    count: 1,
    why: 'A device’s share of views.',
  },
  [at(ANALYTICS, 'server', 'language-analytics.ts')]: {
    count: 1,
    why: 'Change in views against the previous period: views over views.',
  },
  [at(ANALYTICS, 'server', 'reporting', 'csv-parsers.ts')]: {
    count: 2,
    why: 'View-weighted averages: views are the weights.',
  },
  [at(ANALYTICS, 'providers', 'youtube', 'youtube-analytics.ts')]: {
    count: 2,
    why: 'View-weighted averages: views are the weights.',
  },
  [at(ANALYTICS, 'lib', 'watched-metrics.ts')]: {
    count: 1,
    why: 'A view-weighted average: views are the weights.',
  },
  [at('packages', 'clickhouse', 'src', 'queries-detail.ts')]: {
    count: 1,
    why: 'A view-weighted average: views are the weights.',
  },
  [at('packages', 'clickhouse', 'src', 'queries-advanced.ts')]: {
    count: 5,
    why:
      'The back catalogue’s share of views; and the four genome stage rates ' +
      '(FILM-1717, SEGMENT_MEASURE_SQL), divided by an interpolated `${sum}`: ' +
      'v_views or v_engaged as genomeViewsDenominator chose. Their record is ' +
      'recordCohortViewsDenominator, returned with the genome and each ' +
      'Signal Surface stage.',
  },
  [at('packages', 'clickhouse', 'src', 'lib', 'traffic-groups.ts')]: {
    count: 3,
    why: 'Traffic groups’ shares of views.',
  },
  [at('packages', 'clickhouse', 'src', 'lib', 'segment-stats.ts')]: {
    count: 3,
    why:
      'Spread: the best video’s views over the median’s; and pooledRpmCents, ' +
      'declared and delegating to rpmCents, whose callers carry rpmDenominator.',
  },
  [at('packages', 'clickhouse', 'scripts', 'verify-queries.ts')]: {
    count: 1,
    why: 'The FILM-1732 integration step checking RPM beside its record.',
  },
  [at(ANALYTICS, 'lib', 'revenue-by-currency.ts')]: {
    count: 3,
    why: 'RPM, ads RPM and a top item’s RPM, each returned beside its rpmDenominator.',
  },
  [at(ANALYTICS, 'lib', 'segment-revenue.ts')]: {
    count: 2,
    why: 'Segment RPM, declared and pooled; its row carries rpmDenominator.',
  },
  [at(ANALYTICS, 'server', 'segment-actions.ts')]: {
    count: 1,
    why: 'A segment row’s RPM, set beside segmentRpmDenominator.',
  },
  [at('packages', 'clickhouse', 'src', 'lib', 'cohort-growth.ts')]: {
    count: 1,
    why: 'Cohort growth between medians: FILM-1715’s own criterion.',
  },
  [at(
    'apps',
    'vendor-sandbox',
    'src',
    'social',
    'vendors',
    'google',
    'analytics.ts',
  )]: {
    count: 4,
    why: 'The sandbox’s fake YouTube Analytics API, answering as the vendor does.',
  },
};

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    if (SKIP.has(name)) return [];
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return sources(full);
    return /\.(ts|tsx)$/.test(name) && !/\.(test|spec)\.tsx?$/.test(name)
      ? [full]
      : [];
  });
}

describe('every rate over views is recorded (FILM-1732)', () => {
  it('finds a planted bare division by views', () => {
    expect(
      divisionsByViews('const rate = (stats.likes / stats.views) * 100;'),
    ).toHaveLength(1);
    expect(
      divisionsByViews('const rpm = (cents / totalViews) * 1000;'),
    ).toHaveLength(1);
    expect(divisionsByViews('const r = a /\n    entry.views;')).toHaveLength(1);
  });

  it('finds a rate written as SQL in a string', () => {
    expect(
      divisionsByViews('const sql = `SELECT sum(likes) / sum(views) FROM t`;'),
    ).toHaveLength(1);
    expect(
      divisionsByViews("const sql = 'likes / nullIf(sum(d.views), 0) AS r';"),
    ).toHaveLength(1);
    expect(
      divisionsByViews('const sql = `divide(sum(likes), sum(views)) AS r`;'),
    ).toHaveLength(1);
    expect(
      divisionsByViews('const sql = `if(v > 0, v_shares / ${sum}, NULL)`;'),
    ).toHaveLength(1);
    expect(divisionsByViews('page.goto(`/home/${slug}/analytics`);')).toEqual(
      [],
    );
  });

  it('finds a rate through a helper that divides', () => {
    expect(divisionsByViews('const r = ratio(likes, views);')).toHaveLength(1);
    expect(
      divisionsByViews('const r = safeDivide(total.likes, total.views) * 100;'),
    ).toHaveLength(1);
    expect(
      divisionsByViews('const r = percentOf(sum(a, b), stats.views);'),
    ).toHaveLength(1);
    expect(
      divisionsByViews('const r = recordedEngagementRatePercent(t, d);'),
    ).toEqual([]);
  });

  it('does not read an import path or a comment as a division', () => {
    expect(
      divisionsByViews(
        [
          "import { addViews } from '../lib/views';",
          "const m = await import('../lib/views');",
          '// (likes + comments) / views',
          '/* ratio(likes, views) */',
        ].join('\n'),
      ),
    ).toEqual([]);
  });

  it('divides by views only in lib/measures.ts, or where listed with a reason', () => {
    const found = Object.fromEntries(
      ROOTS.flatMap((root) => sources(path.join(REPO, root)))
        .map((file) => path.relative(REPO, file))
        .filter((file) => file !== HOME)
        .map(
          (file) =>
            [
              file,
              divisionsByViews(readFileSync(path.join(REPO, file), 'utf8'))
                .length,
            ] as const,
        )
        .filter(([, count]) => count > 0),
    );

    expect(found).toEqual(
      Object.fromEntries(
        Object.entries(NOT_A_RATE_OVER_VIEWS).map(([file, { count }]) => [
          file,
          count,
        ]),
      ),
    );
  });

  it('has its home beside the record builder', () => {
    expect(readFileSync(path.join(REPO, HOME), 'utf8')).toMatch(
      /export function recordViewsDenominator/,
    );
  });
});
