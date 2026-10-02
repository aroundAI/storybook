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

/** Something divided by an expression that ends in a views value. */
const DIVIDED_BY_VIEWS =
  /[\w)\]!]\s*\/\s*\(?\s*[\w.?!]*(?:views|Views|VIEWS)\b(?![\w(])/g;

/** Comments and quoted strings say "views" without dividing by them. */
function code(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, ''))
    .replace(/(^|[^:'"`])\/\/[^\n]*/g, '$1')
    .replace(/'(?:[^'\\\n]|\\.)*'/g, "''")
    .replace(/"(?:[^"\\\n]|\\.)*"/g, '""');
}

function divisionsByViews(source: string): string[] {
  return code(source).match(DIVIDED_BY_VIEWS) ?? [];
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
    count: 1,
    why: 'The back catalogue’s share of views.',
  },
  [at('packages', 'clickhouse', 'src', 'lib', 'traffic-groups.ts')]: {
    count: 3,
    why: 'Traffic groups’ shares of views.',
  },
  [at('packages', 'clickhouse', 'src', 'lib', 'segment-stats.ts')]: {
    count: 1,
    why: 'Spread: the best video’s views over the median’s.',
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

  it('does not read an import path, a comment or a string as a division', () => {
    expect(
      divisionsByViews(
        [
          "import { addViews } from '../lib/views';",
          '// (likes + comments) / views',
          "const label = 'per 1,000 / views';",
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
