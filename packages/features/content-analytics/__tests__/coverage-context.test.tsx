/**
 * @vitest-environment happy-dom
 */
import type { ReactNode } from 'react';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ANALYTICS_PLATFORMS,
  CAPABILITY_MATRIX,
  type CoverageMatrix,
  METRIC_FAMILIES,
  type MetricFamily,
  foldObservedCoverage,
} from '@kit/clickhouse';

import {
  COVERAGE_WINDOW_SETTLE_MS,
  CoverageProvider,
  useCoverage,
} from '../src/components/coverage-context';
import type { CoverageMatrixResult } from '../src/lib/coverage';

/**
 * FILM-1704 §4: coverage is fetched once per page and handed to every card
 * through context. A card asks `useCoverage(family)` and issues no query of
 * its own; capability paints before the observed half arrives; and a date
 * picker moving through intermediate values does not re-scan five tables
 * for each one.
 */

const action = vi.hoisted(() => vi.fn());

vi.mock('../src/server/coverage-actions', () => ({
  getCoverageMatrixAction: action,
}));

const projectId = '00000000-0000-4000-8000-0000000000a1';

function resultFor(window: { from: string; to: string }): CoverageMatrixResult {
  const matrix: CoverageMatrix = foldObservedCoverage(
    [
      {
        table: 'video_traffic_sources',
        platform: 'youtube',
        rows: 7,
        latestDate: window.to,
        metricSources: [],
      },
    ],
    CAPABILITY_MATRIX,
    { connectedPlatforms: ['youtube', 'tiktok'], asOf: window.to },
  );

  return { window, matrix, channels: [], observed: true };
}

/** A stand-in card: renders each platform's cell as text. */
function Probe({ family, id }: { family: MetricFamily; id: string }) {
  const coverage = useCoverage(family);

  return (
    <ul data-test={id} data-window={coverage.windowLabel}>
      {ANALYTICS_PLATFORMS.map((platform) => {
        const cell = coverage.platforms[platform];

        return (
          <li key={platform} data-test={`${id}-${platform}`}>
            {cell === null
              ? 'unknown'
              : cell === 'pending'
                ? 'pending'
                : cell.kind}
          </li>
        );
      })}
    </ul>
  );
}

function cellText(id: string, platform: string) {
  return screen.getByText(
    (_, element) => element?.getAttribute('data-test') === `${id}-${platform}`,
  ).textContent;
}

function renderWith(children: ReactNode, client = new QueryClient()) {
  const utils = render(
    <QueryClientProvider client={client}>{children}</QueryClientProvider>,
  );

  return {
    ...utils,
    rerender: (next: ReactNode) =>
      utils.rerender(
        <QueryClientProvider client={client}>{next}</QueryClientProvider>,
      ),
  };
}

const page = (from: string, to: string, children: ReactNode) => (
  <CoverageProvider
    scope={{ projectId }}
    from={from}
    to={to}
    windowLabel={`${from} to ${to}`}
  >
    {children}
  </CoverageProvider>
);

describe('CoverageProvider', () => {
  beforeEach(() => {
    action.mockReset();
    action.mockImplementation(async (input: { from: string; to: string }) =>
      resultFor({ from: input.from, to: input.to }),
    );
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('a card for every family, and a repeat, share one request', async () => {
    const families = [...METRIC_FAMILIES, 'engagement'] as MetricFamily[];

    expect(families).toHaveLength(METRIC_FAMILIES.length + 1);

    renderWith(
      page(
        '2026-09-01',
        '2026-09-30',
        families.map((family, index) => (
          <Probe key={index} family={family} id={`card-${index}`} />
        )),
      ),
    );

    // The fixture covers traffic sources on YouTube; find that card by name.
    const traffic = `card-${families.indexOf('traffic_sources')}`;

    await waitFor(() => expect(cellText(traffic, 'youtube')).toBe('covered'));
    expect(action).toHaveBeenCalledOnce();
    expect(action).toHaveBeenCalledWith({
      scope: { projectId },
      from: '2026-09-01',
      to: '2026-09-30',
    });
  });

  it('paints capability before the observed half resolves', () => {
    action.mockImplementation(() => new Promise(() => {}));

    renderWith(
      page(
        '2026-09-01',
        '2026-09-30',
        <Probe family="traffic_sources" id="traffic" />,
      ),
    );

    // Synchronously, on first render: no waiting on a five-table scan.
    expect(cellText('traffic', 'instagram')).toBe('unsupported');
    expect(cellText('traffic', 'tiktok')).toBe('not_ingested');
    expect(cellText('traffic', 'youtube')).toBe('pending');
  });

  it('settles every state once the request returns', async () => {
    renderWith(
      page(
        '2026-09-01',
        '2026-09-30',
        <>
          <Probe family="traffic_sources" id="traffic" />
          <Probe family="engagement" id="engagement" />
        </>,
      ),
    );

    await waitFor(() => expect(cellText('traffic', 'youtube')).toBe('covered'));
    expect(cellText('engagement', 'tiktok')).toBe('no_data_in_window');
    expect(cellText('engagement', 'instagram')).toBe('not_connected');
  });

  it('a failed request leaves capability standing and the rest unknown, not empty', async () => {
    action.mockRejectedValue(new Error('ClickHouse timed out'));

    renderWith(
      page(
        '2026-09-01',
        '2026-09-30',
        <Probe family="traffic_sources" id="traffic" />,
      ),
      new QueryClient({ defaultOptions: { queries: { retry: false } } }),
    );

    await waitFor(() => expect(cellText('traffic', 'youtube')).toBe('unknown'));
    expect(cellText('traffic', 'instagram')).toBe('unsupported');
  });

  it('a date picker passing through intermediate ranges asks once for where it lands', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });

    const view = renderWith(
      page('2026-09-01', '2026-09-30', <Probe family="engagement" id="e" />),
    );

    await waitFor(() => expect(action).toHaveBeenCalledTimes(1));

    // Each click of a range calendar emits a range: five of them, quickly.
    for (const from of [
      '2026-08-01',
      '2026-08-02',
      '2026-08-03',
      '2026-08-04',
    ]) {
      view.rerender(page(from, from, <Probe family="engagement" id="e" />));
      await act(() =>
        vi.advanceTimersByTimeAsync(COVERAGE_WINDOW_SETTLE_MS / 4),
      );
    }
    view.rerender(
      page('2026-08-04', '2026-08-20', <Probe family="engagement" id="e" />),
    );
    await act(() => vi.advanceTimersByTimeAsync(COVERAGE_WINDOW_SETTLE_MS * 2));

    await waitFor(() => expect(action).toHaveBeenCalledTimes(2));
    expect(action).toHaveBeenLastCalledWith({
      scope: { projectId },
      from: '2026-08-04',
      to: '2026-08-20',
    });
  });

  it('returning to a window already seen is served from the cache', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });

    const view = renderWith(
      page('2026-09-01', '2026-09-30', <Probe family="engagement" id="e" />),
    );

    await waitFor(() => expect(action).toHaveBeenCalledTimes(1));

    view.rerender(
      page('2026-08-01', '2026-08-31', <Probe family="engagement" id="e" />),
    );
    await act(() => vi.advanceTimersByTimeAsync(COVERAGE_WINDOW_SETTLE_MS * 2));
    await waitFor(() => expect(action).toHaveBeenCalledTimes(2));

    view.rerender(
      page('2026-09-01', '2026-09-30', <Probe family="engagement" id="e" />),
    );
    await act(() => vi.advanceTimersByTimeAsync(COVERAGE_WINDOW_SETTLE_MS * 2));

    await waitFor(() =>
      expect(cellText('e', 'tiktok')).toBe('no_data_in_window'),
    );
    expect(action).toHaveBeenCalledTimes(2);
  });

  it("Deep Dive's own provider describes Deep Dive's window, not the header's", async () => {
    renderWith(
      page(
        '2026-09-01',
        '2026-09-30',
        <>
          <Probe family="engagement" id="header" />
          <CoverageProvider
            scope={{ projectId }}
            from="2025-09-28"
            to="2026-09-26"
            windowLabel="the last 52 complete weeks"
          >
            <Probe family="engagement" id="deep-dive" />
          </CoverageProvider>
        </>,
      ),
    );

    await waitFor(() => expect(action).toHaveBeenCalledTimes(2));

    expect(
      screen
        .getByText((_, el) => el?.getAttribute('data-test') === 'deep-dive')
        .getAttribute('data-window'),
    ).toBe('the last 52 complete weeks');
    expect(action).toHaveBeenCalledWith({
      scope: { projectId },
      from: '2025-09-28',
      to: '2026-09-26',
    });
  });

  it('a card outside any provider is a mistake, said so', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(() => renderWith(<Probe family="engagement" id="orphan" />)).toThrow(
      /CoverageProvider/,
    );
  });
});
