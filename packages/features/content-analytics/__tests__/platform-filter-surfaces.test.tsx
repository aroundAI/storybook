/**
 * @vitest-environment happy-dom
 */
import { cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { ANALYTICS_PLATFORMS } from '@kit/clickhouse';
import type { MetricFamily, ObservedCoverageRow } from '@kit/clickhouse';

import { PlatformSwitcher } from '../src/components/deep-dive/platform-switcher';
import { MetricCards } from '../src/components/metric-cards';
import { AnalyticsCard } from '../src/components/overview/analytics-card';
import { NO_PLATFORM_SELECTED } from '../src/lib/platform-selection';
import { coverageStrip, platformCoverage } from '../src/lib/provenance';
import { PlatformSelectionSchema } from '../src/lib/schemas/platforms.schema';
import { ScopeSchema } from '../src/lib/schemas/traffic.schema';
import {
  channelRef,
  coverageResult,
  renderWithCoverage,
} from './helpers/coverage';

/**
 * FILM-1709, rendered: what the page says about a figure once the platform
 * filter reaches it — the chip names the selected platforms, a card the
 * selection leaves nothing dims with a reason, the headline figures do the
 * same, and an absence reads the same on a card as on the strip.
 */
afterEach(cleanup);

const row = (
  table: ObservedCoverageRow['table'],
  platform: string,
): ObservedCoverageRow => ({
  table,
  platform,
  rows: 10,
  latestDate: '2026-09-29',
  metricSources: [],
});

const PROJECT = '11111111-1111-4111-8111-111111111111';

const seeded = coverageResult({
  rows: [row('video_metrics', 'youtube'), row('video_metrics', 'instagram')],
  channels: [
    channelRef('youtube', { name: 'Seed Studio' }),
    channelRef('tiktok', { name: '@seedstudio' }),
    channelRef('instagram', { name: '@seed.studio' }),
  ],
});

const byTest = (container: HTMLElement, id: string) =>
  container.querySelector<HTMLElement>(`[data-test="${id}"]`);

function ViewsCard() {
  return (
    <AnalyticsCard
      title={'Views'}
      metricFamily={'engagement'}
      claim={{ figure: '165', sentence: 'Views in the window.' }}
      data-test={'views'}
    />
  );
}

describe('the selection, at the action boundary', () => {
  it('takes analytics platforms, at least one', () => {
    expect(PlatformSelectionSchema.parse(['youtube', 'tiktok'])).toEqual([
      'youtube',
      'tiktok',
    ]);
    expect(PlatformSelectionSchema.safeParse([]).success).toBe(false);
    // Not an analytics platform: never sent to a ClickHouse query.
    expect(PlatformSelectionSchema.safeParse(['linkedin']).success).toBe(false);
  });

  it('is a list in the Deep Dive scope, every choice kept', () => {
    expect(
      ScopeSchema.parse({
        projectId: PROJECT,
        platforms: ['tiktok', 'instagram'],
      }).platforms,
    ).toEqual(['tiktok', 'instagram']);
    expect(
      ScopeSchema.safeParse({ projectId: PROJECT, platforms: [] }).success,
    ).toBe(false);
  });
});

describe('a card under the filter', () => {
  it('names the selected platforms on its chip, and only those', () => {
    const { container } = renderWithCoverage(<ViewsCard />, {
      result: seeded,
      selectedPlatforms: ['youtube', 'instagram'],
    });

    const chip = byTest(container, 'provenance-chip')!;

    // Instagram's engagement is derived in the matrix, so the suffix stays.
    expect(chip.textContent).toBe('YouTube + Instagram · partly derived');
    expect(byTest(container, 'views')!.dataset.dimmed).toBeUndefined();
  });

  it('says the strip’s own sentence when the one selected platform has no data', () => {
    const { container } = renderWithCoverage(<ViewsCard />, {
      result: seeded,
      selectedPlatforms: ['tiktok'],
    });
    const strip = coverageStrip(
      {
        windowLabel: '2026-09-01 to 2026-09-30',
        cellsFor: (family) => seeded.matrix[family],
        channels: seeded.channels,
        observed: true,
      },
      ['engagement'],
    );
    const tiktok = strip.items.find((item) => item.platform === 'tiktok')!;

    expect(tiktok.kind).toBe('no_data_in_window');
    expect(byTest(container, 'card-coverage-note')!.textContent).toBe(
      tiktok.sentence,
    );
    expect(tiktok.sentence).toBe(
      'TikTok: connected (@seedstudio), but no data for 2026-09-01 to 2026-09-30.',
    );
  });

  it('dims, never blanks, when no platform is selected', () => {
    const { container } = renderWithCoverage(<ViewsCard />, {
      result: seeded,
      selectedPlatforms: [],
    });

    expect(byTest(container, 'views')!.dataset.dimmed).toBe('true');
    expect(byTest(container, 'card-dimmed-reason')!.textContent).toBe(
      NO_PLATFORM_SELECTED,
    );
    expect(byTest(container, 'card-figure')!.textContent).toBe('165');
  });
});

describe('the MetricCards under the filter', () => {
  const totals = {
    views: 300,
    likes: 10,
    comments: 1,
    shares: 1,
    watchTimeSeconds: null,
    subscribersGained: null,
    revenueCents: 0,
    contentCount: 1,
  };

  it('dim a card the selection cannot cover, with the reason', () => {
    const { container } = renderWithCoverage(
      <MetricCards
        data={totals}
        previousData={null}
        isLoading={false}
        viewsScope={null}
      />,
      { result: seeded, selectedPlatforms: ['tiktok'] },
    );

    const watch = byTest(container, 'metric-card-watchTime')!;
    const views = byTest(container, 'metric-card-views')!;

    expect(watch.dataset.dimmed).toBe('true');
    expect(byTest(watch, 'metric-dimmed-reason')!.textContent).toBeTruthy();
    expect(views.dataset.dimmed).toBeUndefined();
    expect(byTest(views, 'metric-value')!.textContent).toBe('300');
  });

  it('draw no zero for figures nobody asked for', () => {
    const { container } = renderWithCoverage(
      <MetricCards
        data={null}
        previousData={null}
        isLoading={false}
        viewsScope={null}
        noFigureReason={'No platform selected'}
      />,
      { result: seeded, selectedPlatforms: [] },
    );

    expect(
      container.querySelectorAll('[data-test="metric-value"]'),
    ).toHaveLength(0);

    const views = byTest(container, 'metric-card-views')!;

    expect(byTest(views, 'metric-unmeasured')!.textContent).toBe(
      'No platform selected',
    );
    expect(views.dataset.dimmed).toBe('true');
    expect(byTest(views, 'metric-dimmed-reason')!.textContent).toBe(
      NO_PLATFORM_SELECTED,
    );
  });
});

describe('the Deep Dive switcher, as a view of the page’s selection', () => {
  it('names a two-platform selection instead of narrowing it to one', () => {
    const { container } = renderWithCoverage(
      <PlatformSwitcher value={['youtube', 'instagram']} onChange={() => {}} />,
    );
    const trigger = byTest(container, 'deep-dive-platform-switcher')!;

    expect(trigger.textContent).toBe('YouTube + Instagram');
    expect(trigger.dataset.selection).toBe('youtube,instagram');
  });

  it('reads all platforms, or the one', () => {
    const all = renderWithCoverage(
      <PlatformSwitcher value={[...ANALYTICS_PLATFORMS]} onChange={() => {}} />,
    );

    expect(
      byTest(all.container, 'deep-dive-platform-switcher')!.textContent,
    ).toBe('All platforms');
    cleanup();

    const one = renderWithCoverage(
      <PlatformSwitcher value={['tiktok']} onChange={() => {}} />,
    );

    expect(
      byTest(one.container, 'deep-dive-platform-switcher')!.textContent,
    ).toBe('TikTok');
  });
});

describe('platform coverage, unchanged by the selection', () => {
  it('is a fact about the window, not about what is selected', () => {
    const view = {
      windowLabel: 'w',
      cellsFor: (family: MetricFamily) => seeded.matrix[family],
      channels: seeded.channels,
      observed: true,
    };

    expect(platformCoverage(view, ['engagement'], 'youtube').kind).toBe(
      'covered',
    );
  });
});
