/**
 * @vitest-environment happy-dom
 */
import type { ReactNode } from 'react';

import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { type FormatFamily, resolveConfidence } from '@kit/clickhouse';

import {
  LanguageComparisonChart,
  ShortsROICard,
} from '../src/components/analytics-enhancement-cards';
import {
  ContentTypeCard,
  LanguagePerformanceCard,
  PlatformLanguageMatrix,
} from '../src/components/language-analytics-cards';
import { GeographyHeatmapCard } from '../src/components/language-insights-cards';
import { LanguageTrendChart } from '../src/components/language-trend-chart';
import { CAUSAL_VOCABULARY } from '../src/components/overview/card-claim';
import { TopShortsCard } from '../src/components/shorts-geography-cards';
import { TagMediansCard } from '../src/components/taxonomy/tag-medians-card';
import type {
  ContentTypeComparison,
  LanguagePerformance,
} from '../src/server/language-analytics';
import { renderWithCoverage } from './helpers/coverage';

// `@kit/ui` does not resolve its React runtime from this package's test
// environment; the other component tests stub it the same way.
//
// The charts are SVG with no layout under happy-dom, so recharts is stood
// in for: containers render their children, and a ReferenceLine leaves a
// marker carrying its `x`, so the line the chart draws can be read.
vi.mock('recharts', () => {
  const container = ({ children }: { children?: ReactNode }) => (
    <div>{children}</div>
  );
  const nothing = () => null;

  return {
    Area: nothing,
    AreaChart: container,
    Bar: container,
    BarChart: container,
    CartesianGrid: nothing,
    Cell: nothing,
    Legend: nothing,
    ReferenceLine: ({ x }: { x?: string }) => (
      <i data-test="reference-line" data-x={x} />
    ),
    ResponsiveContainer: container,
    Tooltip: nothing,
    XAxis: nothing,
    YAxis: nothing,
  };
});
vi.mock('@kit/ui/progress', () => ({ Progress: () => <div /> }));
vi.mock('@kit/ui/skeleton', () => ({ Skeleton: () => <div /> }));
vi.mock('@kit/ui/utils', () => ({
  cn: (...classes: unknown[]) => classes.filter(Boolean).join(' '),
}));

afterEach(cleanup);

/** This repo tags elements with `data-test`, not `data-testid`. */
function byTest(id: string, within: ParentNode = document): HTMLElement {
  const element = within.querySelector<HTMLElement>(`[data-test="${id}"]`);
  if (!element) throw new Error(`no [data-test="${id}"]`);
  return element;
}

function row(
  language: string | null,
  views: number,
  mature: number | null,
): LanguagePerformance {
  return {
    language,
    views,
    viewsChange: 0,
    likes: 0,
    comments: 0,
    shares: 0,
    engagement: 0,
    revenueCents: 0,
    contentCount: 1,
    videoCount: mature ?? 2,
    checkpoint:
      mature === null
        ? null
        : {
            days: 30,
            medianViews: views,
            matureVideoCount: mature,
            confidence: resolveConfidence(mature),
          },
  };
}

// The unlabelled bucket has the most views, as it does on most projects.
const ROWS = [
  row(null, 5000, 40),
  row('en', 1000, 20),
  row('es', 700, 2),
  row('hi', 0, null),
];

describe('LanguagePerformanceCard (FILM-1702)', () => {
  // KB-167: with no previous period measured there is nothing to compare,
  // so no arrow and no "0.0%" beside the views.
  it('draws no change for a language with no previous period', () => {
    renderWithCoverage(
      <LanguagePerformanceCard
        data={[{ ...row('en', 1000, 20), viewsChange: null }]}
      />,
    );

    const english = byTest('language-row-en');

    expect(english.querySelector('[data-test="language-row-change"]')).toBe(
      null,
    );
    expect(english.textContent).toContain('No previous period to compare');
  });

  it('draws a measured change', () => {
    renderWithCoverage(
      <LanguagePerformanceCard
        data={[{ ...row('en', 1000, 20), viewsChange: 25 }]}
      />,
    );

    expect(
      byTest('language-row-change', byTest('language-row-en')).textContent,
    ).toBe('25.0%');
  });

  it('names the unlabelled bucket, and not as a language', () => {
    renderWithCoverage(<LanguagePerformanceCard data={ROWS} />);

    const notSet = byTest('language-row-__not_set__');

    expect(byTest('language-row-name', notSet).textContent).toBe(
      'Language not set',
    );
    expect(byTest('language-row-views', notSet).textContent).toBe('5.0K');
  });

  it('names the dimension it is grouped by', () => {
    const { rerender } = renderWithCoverage(
      <LanguagePerformanceCard data={ROWS} />,
    );

    expect(byTest('language-dimension-label-performance').textContent).toBe(
      'By content language',
    );

    rerender(<LanguagePerformanceCard data={ROWS} dimension="channel" />);

    expect(byTest('language-dimension-label-performance').textContent).toBe(
      'By channel target language',
    );
    expect(
      byTest('language-row-name', byTest('language-row-__not_set__'))
        .textContent,
    ).toBe('No channel target');
  });

  it('dims a thin language and shows its n, rather than hiding it', () => {
    renderWithCoverage(<LanguagePerformanceCard data={ROWS} />);

    const spanish = byTest('language-row-es');

    expect(spanish.className).toContain('opacity-60');
    expect(byTest('language-row-checkpoint', spanish).textContent).toBe(
      '700 median at 30 days · 2 of 2 videos · too few to report',
    );
    expect(byTest('language-row-en').className).not.toContain('opacity-60');
  });

  it('says so when no video has reached the checkpoint, instead of a zero median', () => {
    renderWithCoverage(<LanguagePerformanceCard data={ROWS} />);

    const hindi = byTest('language-row-hi');

    expect(hindi.className).toContain('opacity-60');
    expect(byTest('language-row-checkpoint', hindi).textContent).toBe(
      '2 videos, none 30 days old yet',
    );
  });

  it('never crowns the unlabelled bucket as the top language', () => {
    renderWithCoverage(<LanguagePerformanceCard data={ROWS} />);

    expect(byTest('language-row-__not_set__').textContent).not.toContain('Top');
    expect(byTest('language-row-en').textContent).toContain('Top');
  });
});

describe('PlatformLanguageMatrix (FILM-1702)', () => {
  const entry = (language: string | null, engagementRate: number) => ({
    platform: 'youtube',
    language,
    views: 100,
    likes: 0,
    comments: 0,
    shares: 0,
    engagementRate,
    revenueCents: 0,
    contentCount: 1,
  });

  it('heads each column with the language name, not only a flag', () => {
    renderWithCoverage(
      <PlatformLanguageMatrix data={[entry('es', 1), entry(null, 9)]} />,
    );

    expect(byTest('matrix-language-es').textContent).toContain('Spanish');
    expect(byTest('matrix-language-__not_set__').textContent).toBe(
      'Language not set',
    );
  });

  it('does not name the unlabelled column as the best combination', () => {
    const { container } = renderWithCoverage(
      <PlatformLanguageMatrix data={[entry('es', 1), entry(null, 9)]} />,
    );

    expect(container.textContent).toContain('Best: Spanish on YouTube');
    expect(container.textContent).not.toContain('Best: Language not set');
  });
});

describe('TagMediansCard, language rows (FILM-1702)', () => {
  it('names the not-set segment instead of rendering a row with no name', () => {
    render(
      <TagMediansCard
        segmentNoun="language"
        rows={[
          {
            segment: '',
            videoCount: 40,
            matureVideoCount: 40,
            medianViews: 900,
            meanViews: 900,
            spread: null,
            confidence: 'reportable',
          },
        ]}
      />,
    );

    expect(byTest('tag-medians-segment').textContent).toBe('Language not set');
  });
});

describe('LanguageTrendChart, view-definition boundaries (FILM-1722 via FILM-1707)', () => {
  const day = (date: string, views: number) => ({
    date,
    viewsByLanguage: { en: views },
  });

  it('marks a range that crosses 27 Aug 2026, on the last drawn day before it', () => {
    const { container } = renderWithCoverage(
      <LanguageTrendChart
        data={[
          day('2026-08-20', 100),
          day('2026-08-26', 100),
          day('2026-08-28', 300),
        ]}
      />,
    );

    const marks = container.querySelectorAll(
      '[data-test="view-definition-mark"]',
    );

    expect(marks).toHaveLength(1);
    expect(marks[0]!.getAttribute('data-date')).toBe('2026-08-27');
    expect(marks[0]!.textContent).toContain('changed what counts as a view');
    expect(byTest('reference-line', container).getAttribute('data-x')).toBe(
      '2026-08-26',
    );
  });

  it('marks nothing over a range wholly after the change', () => {
    const { container } = renderWithCoverage(
      <LanguageTrendChart
        data={[day('2026-09-01', 100), day('2026-09-20', 200)]}
      />,
    );

    expect(
      container.querySelectorAll('[data-test="view-definition-mark"]'),
    ).toHaveLength(0);
    expect(
      container.querySelectorAll('[data-test="reference-line"]'),
    ).toHaveLength(0);
  });
});

describe('the Language tab on the one shell (FILM-1707)', () => {
  const side = (
    family: FormatFamily,
    views: number,
    engagement: number,
    contentCount: number,
  ) => ({
    family,
    views,
    likes: 0,
    comments: 0,
    shares: 0,
    engagement,
    revenueCents: 0,
    subscribersGained: 0,
    contentCount,
  });

  const contentType: ContentTypeComparison = {
    families: [
      side('short_vertical', 600, 4, 6),
      side('long_horizontal', 900, 2, 3),
    ],
    unclassified: 0,
    durationUnknown: 0,
  };

  const cards = [
    ['language performance', <LanguagePerformanceCard key="p" data={ROWS} />],
    ['matrix', <PlatformLanguageMatrix key="m" data={[]} />],
    ['content type', <ContentTypeCard key="c" data={contentType} />],
    [
      'trend',
      <LanguageTrendChart
        key="t"
        data={[{ date: '2026-09-01', viewsByLanguage: { en: 5 } }]}
      />,
    ],
    ['comparison', <LanguageComparisonChart key="l" data={ROWS} />],
    ['shorts ROI', <ShortsROICard key="r" contentTypeData={contentType} />],
    ['top shorts', <TopShortsCard key="s" data={[]} />],
    [
      'geography',
      <GeographyHeatmapCard
        key="g"
        data={[
          {
            language: 'es',
            countries: [{ country: 'MX', percentage: 60, views: 6 }],
          },
        ]}
      />,
    ],
  ] as const;

  it.each(cards)('the %s card is an AnalyticsCard with a chip', (_, card) => {
    const { container } = renderWithCoverage(card);

    const shell = container.querySelector('[data-card-shell="analytics"]');

    expect(shell).not.toBeNull();
    expect(shell!.getAttribute('data-metric-family')).toMatch(
      /^(engagement|geography|engagement,revenue)$/,
    );
    expect(byTest('provenance-chip', container)).toBeTruthy();
  });

  it.each(cards)('the %s claim asserts no cause', (_, card) => {
    const { container } = renderWithCoverage(card);
    const sentence = container.querySelector('[data-test="card-sentence"]');

    expect(sentence?.textContent).toBeTruthy();
    expect(sentence!.textContent).not.toMatch(CAUSAL_VOCABULARY);
  });

  it('gives no ratio, rather than a zero, when one side has no videos', () => {
    const { container } = renderWithCoverage(
      <ShortsROICard
        contentTypeData={{
          ...contentType,
          families: [side('short_vertical', 600, 4, 6)],
        }}
      />,
    );

    expect(container.querySelector('[data-test="card-figure"]')).toBeNull();
    expect(byTest('card-no-figure', container).textContent).toBe(
      'No ratio yet.',
    );
  });
});
