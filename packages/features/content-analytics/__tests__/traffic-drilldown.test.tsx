/**
 * @vitest-environment happy-dom
 */
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { type TrafficSourceRow, groupTrafficRows } from '@kit/clickhouse';

import { BackCatalogCard } from '../src/components/deep-dive/back-catalog-card';
import { MedianViewsCard } from '../src/components/deep-dive/median-views-card';
import {
  TrafficBreakdownCard,
  TrafficShareCard,
  trafficBreakdownDetails,
} from '../src/components/deep-dive/traffic-share-card';
import { AnalyticsCard } from '../src/components/overview/analytics-card';
import { renderWithCoverage } from './helpers/coverage';

/**
 * FILM-1708. The drill-down and the chart tooltips, rendered.
 *
 * Window of two weeks, 2,000 views:
 *   browse_suggested  RELATED_VIDEO 900 + SUBSCRIBER 300  = 1,200  60.0%
 *   search            YT_SEARCH 700                        =   700  35.0%
 *   playlists         PLAYLIST 5                           =     5   0.25%
 *   other             TS_44 95                             =    95   4.75%
 * Playlists is 5 of 1,000 in week two: 0.5%, which draws at 0.4px and is
 * floored to 2px — its label must still say 0.5%.
 */
afterEach(cleanup);

const row = (
  bucket: string,
  source: string,
  views: number,
): TrafficSourceRow => ({
  bucket,
  source,
  views,
  watchTimeMinutes: 0,
});

const buckets = groupTrafficRows([
  row('2026-08-02', 'RELATED_VIDEO', 500),
  row('2026-08-02', 'SUBSCRIBER', 100),
  row('2026-08-02', 'YT_SEARCH', 350),
  row('2026-08-02', 'TS_44', 50),
  row('2026-08-09', 'RELATED_VIDEO', 400),
  row('2026-08-09', 'SUBSCRIBER', 200),
  row('2026-08-09', 'YT_SEARCH', 350),
  row('2026-08-09', 'TS_44', 45),
  row('2026-08-09', 'PLAYLIST', 5),
]);

function renderBreakdown() {
  return renderWithCoverage(
    <AnalyticsCard
      title={'Where views came from'}
      metricFamily={'traffic_sources'}
      platforms={['youtube']}
      claim={{
        figure: '60%',
        sentence: 'Browse + Suggested was the largest source.',
      }}
      details={trafficBreakdownDetails(buckets, ['From YouTube Analytics.'])}
      data-test={'breakdown'}
    >
      <TrafficBreakdownCard buckets={buckets} />
    </AnalyticsCard>,
  );
}

const shares = (elements: Element[]) =>
  elements.map((element) => Number(element.getAttribute('data-share')));

describe('the drill-down', () => {
  it('expands each group into the codes observed, summing to the group', () => {
    const { container, getByRole } = renderBreakdown();

    fireEvent.click(getByRole('button', { name: 'Details' }));

    const groups = [
      ...container.querySelectorAll('[data-test="traffic-drilldown-group"]'),
    ];

    expect(groups.map((g) => g.getAttribute('data-group'))).toEqual([
      'browse_suggested',
      'search',
      'playlists',
      'other',
    ]);
    expect(shares(groups)).toEqual([0.6, 0.35, 5 / 2000, 95 / 2000]);

    for (const group of groups) {
      const codes = [
        ...group.querySelectorAll('[data-test="traffic-drilldown-source"]'),
      ];
      const sum = shares(codes).reduce((a, b) => a + b, 0);

      expect(sum).toBeCloseTo(Number(group.getAttribute('data-share')), 12);
    }

    const browse = groups[0]!;

    expect(browse.textContent).toContain('RELATED_VIDEO45.0%');
    expect(browse.textContent).toContain('SUBSCRIBER15.0%');
    // A member of the taxonomy that did not occur is not listed as zero.
    expect(browse.textContent).not.toContain('NOTIFICATION');
  });

  it('shows the unrecognised code, marked as such', () => {
    const { container } = renderBreakdown();
    const ts44 = container.querySelector('[data-source="TS_44"]');

    expect(ts44).not.toBeNull();
    expect(ts44!.getAttribute('data-recognised')).toBe('false');
    expect(ts44!.textContent).toContain('unrecognised code');
    expect(
      container
        .querySelector('[data-source="PLAYLIST"]')!
        .getAttribute('data-recognised'),
    ).toBe('true');
  });

  it('keeps the matrix note above the codes', () => {
    const { container } = renderBreakdown();

    expect(
      container.querySelector('[data-test="traffic-drilldown"]')!.textContent,
    ).toMatch(/^From YouTube Analytics\./);
  });
});

describe('chart hover detail', () => {
  it('replaces every title attribute with a labelled, focusable mark', () => {
    const { container } = render(
      <>
        <TrafficBreakdownCard buckets={buckets} />
        <TrafficShareCard
          buckets={buckets.map((b) => ({
            bucket: b.bucket,
            totalViews: b.totalViews,
            browseSuggestedViews: b.groups[0]!.views,
            share: b.groups[0]!.share,
          }))}
        />
        <BackCatalogCard
          buckets={[
            {
              bucket: '2026-08',
              totalViews: 10,
              backCatalogViews: 1,
              share: 0.1,
            },
          ]}
        />
        <MedianViewsCard
          buckets={[
            {
              bucket: '2026-08',
              videoCount: 2,
              medianViews: 10,
              p25Views: 5,
              p75Views: 15,
              meanViews: 10,
            },
          ]}
        />
      </>,
    );

    expect(container.querySelectorAll('[title]')).toHaveLength(0);

    const marks = [...container.querySelectorAll('[role="img"]')];

    expect(marks.length).toBeGreaterThan(0);
    expect(marks.every((mark) => mark.getAttribute('aria-label'))).toBe(true);
  });

  it('gives each chart one tab stop, and arrows move through the marks', () => {
    const { container } = render(<TrafficBreakdownCard buckets={buckets} />);
    const chart = container.querySelector(
      '[data-test="traffic-breakdown-bars"]',
    )!;
    const stops = () => [...chart.querySelectorAll('[tabindex="0"]')];

    expect(stops()).toHaveLength(1);

    const first = stops()[0] as HTMLElement;

    first.focus();
    fireEvent.keyDown(first, { key: 'ArrowUp' });
    expect(document.activeElement?.getAttribute('data-group')).toBe('search');
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowRight' });
    expect(document.activeElement?.getAttribute('data-bucket')).toBe(
      '2026-08-09',
    );
    expect(stops()).toHaveLength(1);
  });

  it('reports a floored slice’s true share, not its drawn one', () => {
    const { container } = render(<TrafficBreakdownCard buckets={buckets} />);
    const slice = container.querySelector(
      '[data-test="traffic-slice"][data-bucket="2026-08-09"][data-group="playlists"]',
    ) as HTMLElement;

    // Drawn at the 2px floor — 2.5% of the 80px stack — while it is 0.5%.
    expect(slice.style.height).toBe('2.5%');
    expect(slice.getAttribute('aria-label')).toBe(
      '2026-08-09 — Playlists: 0.5% of 1,000 views',
    );
    expect(Number(slice.getAttribute('data-share'))).toBe(0.005);
  });
});
