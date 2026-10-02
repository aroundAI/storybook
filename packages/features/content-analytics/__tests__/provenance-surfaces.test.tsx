/**
 * @vitest-environment happy-dom
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  ANALYTICS_PLATFORMS,
  type ObservedCoverageRow,
  capabilityFor,
} from '@kit/clickhouse';

import { CoverageStrip } from '../src/components/coverage-strip';
import { MetricCards } from '../src/components/metric-cards';
import { AnalyticsCard } from '../src/components/overview/analytics-card';
import { PlatformFilter } from '../src/components/platform-filter';
import { TAB_FAMILIES } from '../src/lib/provenance';
import {
  channelRef,
  coverageResult,
  renderWithCoverage,
} from './helpers/coverage';

/**
 * FILM-1705, rendered: the chip the card shell draws, the dimmed card, the
 * filter's third state, the strip, and the MetricCards that stop drawing a
 * number nothing measured.
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

const seeded = coverageResult({
  rows: [
    row('video_metrics', 'youtube'),
    row('video_traffic_sources', 'youtube'),
  ],
  channels: [
    channelRef('youtube', { name: 'Seed Studio' }),
    channelRef('tiktok', { name: '@seedstudio' }),
    channelRef('facebook', { name: 'Seed Studio Page' }),
  ],
});

const chipOf = (container: HTMLElement) =>
  container.querySelector<HTMLButtonElement>('[data-test="provenance-chip"]');

function TrafficCard() {
  return (
    <AnalyticsCard
      title={'Where views came from'}
      metricFamily={'traffic_sources'}
      claim={{ figure: '42%', sentence: 'Search led.' }}
      data-test={'traffic'}
    />
  );
}

describe('the shell draws the chip', () => {
  it('from the matrix and the window’s coverage, with the explanation behind it', () => {
    const { container } = renderWithCoverage(<TrafficCard />, {
      result: seeded,
    });

    const chip = chipOf(container)!;

    expect(chip.textContent).toBe('YouTube only');
    expect(chip.dataset.coverage).toBe('covered');

    fireEvent.click(chip);

    const details = document.querySelector(
      '[data-test="provenance-chip-details"]',
    )!;

    expect(details.textContent).toContain(
      capabilityFor('traffic_sources', 'tiktok').note,
    );
    expect(details.textContent).toContain(
      capabilityFor('traffic_sources', 'instagram').note,
    );
  });

  it('dims — never blanks — a card none of whose platforms is selected', () => {
    const { container } = renderWithCoverage(<TrafficCard />, {
      result: seeded,
      selectedPlatforms: ['tiktok'],
    });

    const card = container.querySelector('[data-test="traffic"]')!;

    expect(card.getAttribute('data-dimmed')).toBe('true');
    expect(
      container.querySelector('[data-test="card-dimmed-reason"]')?.textContent,
    ).toContain(capabilityFor('traffic_sources', 'tiktok').note);
    // The figure it does cover is still there.
    expect(
      container.querySelector('[data-test="card-figure"]')?.textContent,
    ).toBe('42%');
  });

  it('is not dimmed while a selected platform is one it covers', () => {
    const { container } = renderWithCoverage(<TrafficCard />, {
      result: seeded,
      selectedPlatforms: ['youtube', 'tiktok'],
    });

    expect(
      container
        .querySelector('[data-test="traffic"]')!
        .getAttribute('data-dimmed'),
    ).toBeNull();
  });
});

describe('the platform filter', () => {
  it('offers an unavailable platform dimmed, with its reason, and still selectable', () => {
    const onChange = vi.fn();

    render(
      <PlatformFilter
        selected={['youtube']}
        onChange={onChange}
        available={['youtube', 'tiktok']}
        reasons={{
          instagram:
            'Instagram: not connected. Connect a channel in settings to include it.',
        }}
      />,
    );

    fireEvent.click(screen.getByText('Platforms'));

    const instagram = document.querySelector(
      '[data-test="platform-filter-instagram"]',
    )!;

    expect(instagram.getAttribute('data-available')).toBe('false');
    expect(instagram.className).toContain('opacity-60');
    expect(instagram.textContent).toContain(
      'Instagram: not connected. Connect a channel in settings to include it.',
    );

    fireEvent.click(instagram.querySelector('button[role="checkbox"]')!);

    expect(onChange).toHaveBeenCalledWith(['youtube', 'instagram']);
  });

  it('selects every platform with All, available or not', () => {
    const onChange = vi.fn();

    render(
      <PlatformFilter
        selected={['youtube']}
        onChange={onChange}
        available={['youtube']}
      />,
    );

    fireEvent.click(screen.getByText('Platforms'));
    fireEvent.click(screen.getByText('All'));

    expect(onChange).toHaveBeenCalledWith([...ANALYTICS_PLATFORMS]);
  });
});

describe('the strip', () => {
  it('says, per platform, what the page shows and why', () => {
    const { container } = renderWithCoverage(
      <CoverageStrip families={TAB_FAMILIES.overview} />,
      { result: seeded },
    );

    const kinds = [
      ...container.querySelectorAll<HTMLElement>('[data-kind]'),
    ].map((item) => [item.dataset.test, item.dataset.kind]);

    expect(kinds).toEqual([
      ['coverage-strip-youtube', 'covered'],
      ['coverage-strip-tiktok', 'no_data_in_window'],
      ['coverage-strip-instagram', 'not_connected'],
      // Supported since FILM-1720: connected, and empty in the window.
      ['coverage-strip-facebook', 'no_data_in_window'],
      // Supported since FILM-1727, and not connected in this seed.
      ['coverage-strip-twitter', 'not_connected'],
    ]);
  });

  it('says why once on a project with no connections', () => {
    const { container } = renderWithCoverage(
      <CoverageStrip families={TAB_FAMILIES.overview} />,
      { result: coverageResult({ rows: [], channels: [] }) },
    );

    expect(
      container.querySelector('[data-test="coverage-strip-summary"]')
        ?.textContent,
    ).toMatch(/No channels are connected/);
  });
});

describe('the MetricCards', () => {
  const totals = {
    views: 1000,
    likes: 100,
    comments: 10,
    shares: 5,
    watchTimeSeconds: null,
    subscribersGained: null,
    // Not measured (FILM-1726): a 0 here would be a measured $0.
    revenueCents: null,
    contentCount: 3,
  };

  it('stop drawing a number for what was not measured, and carry a chip each', () => {
    const { container } = renderWithCoverage(
      <MetricCards
        data={totals}
        previousData={null}
        isLoading={false}
        viewsScope={null}
      />,
      { result: seeded },
    );

    for (const key of ['watchTime', 'subscribers', 'revenue']) {
      const card = container.querySelector(`[data-test="metric-card-${key}"]`)!;

      expect(card.querySelector('[data-test="metric-value"]')).toBeNull();
      expect(
        card.querySelector('[data-test="metric-not-measured"]')?.textContent,
      ).toBe('Not measured');
    }

    expect(
      container.querySelectorAll('[data-test="provenance-chip"]'),
    ).toHaveLength(7);
    expect(
      chipOf(container.querySelector('[data-test="metric-card-revenue"]')!)
        ?.textContent,
    ).toBe('YouTube only');
  });

  it('say views are not measured when no row behind the total has one', () => {
    const { container } = render(
      <MetricCards
        data={{ ...totals, views: null }}
        previousData={null}
        isLoading={false}
        viewsScope={null}
      />,
    );
    const views = container.querySelector('[data-test="metric-card-views"]')!;

    expect(views.querySelector('[data-test="metric-value"]')).toBeNull();
    expect(
      views.querySelector('[data-test="metric-not-measured"]')?.textContent,
    ).toBe('Not measured');
  });

  it('render without a chip on a page with no coverage provider', () => {
    const { container } = render(
      <MetricCards
        data={totals}
        previousData={null}
        isLoading={false}
        viewsScope={null}
      />,
    );

    expect(chipOf(container)).toBeNull();
  });
});
