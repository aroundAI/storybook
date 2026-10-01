import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * FILM-1707: all six tabs use one card shell, and `@kit/ui/card` no longer
 * appears in the analytics feature's card layer.
 *
 * The card layer is everything a tab mounts: the modules reachable, by
 * relative import, from each tab's entry component. Walked rather than
 * listed, so a card added under a tab is checked without anyone adding it
 * here. The MetricCards above the tabs keep their compact shell (with
 * FILM-1705's chip) and are not a tab's.
 */
const COMPONENTS = resolve(__dirname, '../src/components');

const TAB_ENTRIES = {
  overview: 'overview/overview-grid.tsx',
  content: 'content/content-grid.tsx',
  'content (table)': 'content-table-panel.tsx',
  audience: 'audience/audience-grid.tsx',
  'deep-dive': 'deep-dive/deep-dive-tab.tsx',
  'video-log': 'video-log/video-log-tab.tsx',
  language: 'language-tab.tsx',
  insights: 'ai-insights.tsx',
} as const;

const IMPORT = /(?:import|export)\s[^'"]*?from\s+['"](\.[^'"]+)['"]/g;

function resolveModule(from: string, specifier: string): string | null {
  const base = resolve(dirname(from), specifier);

  for (const candidate of [
    base,
    `${base}.tsx`,
    `${base}.ts`,
    `${base}/index.tsx`,
    `${base}/index.ts`,
  ]) {
    if (existsSync(candidate) && /\.tsx?$/.test(candidate)) return candidate;
  }

  return null;
}

/** Every module under `components/` a tab's entry reaches. */
function cardLayer(entry: string): string[] {
  const seen = new Set<string>();
  const queue = [resolve(COMPONENTS, entry)];

  while (queue.length > 0) {
    const file = queue.pop()!;

    if (seen.has(file) || !file.startsWith(COMPONENTS)) continue;

    seen.add(file);

    for (const [, specifier] of readFileSync(file, 'utf8').matchAll(IMPORT)) {
      const next = resolveModule(file, specifier!);

      if (next) queue.push(next);
    }
  }

  return [...seen];
}

const relative = (file: string) => file.slice(COMPONENTS.length + 1);

describe('one card shell on every tab (FILM-1707)', () => {
  it.each(Object.entries(TAB_ENTRIES))(
    'the %s tab mounts no @kit/ui/card',
    (_tab, entry) => {
      const offenders = cardLayer(entry)
        .filter((file) => readFileSync(file, 'utf8').includes('@kit/ui/card'))
        .map(relative);

      expect(offenders).toEqual([]);
    },
  );

  it('nor does the dashboard around them', () => {
    expect(
      readFileSync(resolve(COMPONENTS, 'analytics-dashboard.tsx'), 'utf8'),
    ).not.toContain('@kit/ui/card');
  });

  it.each(Object.entries(TAB_ENTRIES))(
    'the %s tab’s cards are drawn by the shell',
    (_tab, entry) => {
      expect(
        cardLayer(entry).some((file) =>
          file.endsWith('overview/analytics-card.tsx'),
        ),
      ).toBe(true);
    },
  );

  it('walks far enough to have found the cards it checks', () => {
    // A guard on the guard: a walker that stopped at the entry would pass
    // every assertion above while checking nothing.
    expect(cardLayer(TAB_ENTRIES.language).map(relative)).toEqual(
      expect.arrayContaining([
        'language-analytics-cards.tsx',
        'language-trend-chart.tsx',
        'language-insights-cards.tsx',
        'shorts-geography-cards.tsx',
        'analytics-enhancement-cards.tsx',
      ]),
    );
  });
});
