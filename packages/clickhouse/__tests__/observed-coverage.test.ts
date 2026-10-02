import { describe, expect, it } from 'vitest';

import {
  ANALYTICS_PLATFORMS,
  CAPABILITY_MATRIX,
  COVERAGE_STALE_AFTER_DAYS,
  METRIC_FAMILIES,
  OBSERVED_COVERAGE_TABLES,
  type ObservedCoverageRow,
  capabilityCoverage,
  coverageAsOf,
  foldObservedCoverage,
  isCoverageStale,
} from '../src/lib/data-provenance';

/**
 * FILM-1704: the fold from observed rows to a `CoverageState`, without a
 * database. The four states are the point — *unsupported*, *not connected*,
 * *no data in this window* and *covered* each mean something different to a
 * creator, and collapsing any two of them is the bug this spec exists for.
 */

const row = (
  overrides: Partial<ObservedCoverageRow> & Pick<ObservedCoverageRow, 'table'>,
): ObservedCoverageRow => ({
  platform: 'youtube',
  rows: 10,
  latestDate: '2026-09-28',
  metricSources: [],
  ...overrides,
});

const AS_OF = '2026-09-30';

describe('foldObservedCoverage', () => {
  // The §7 fixture: every state at once, from one set of rows.
  const matrix = foldObservedCoverage(
    [
      row({ table: 'video_traffic_sources', rows: 120 }),
      row({
        table: 'video_metrics',
        rows: 300,
        metricSources: ['reporting_api'],
      }),
    ],
    CAPABILITY_MATRIX,
    { connectedPlatforms: ['youtube', 'tiktok'], asOf: AS_OF },
  );

  it('YouTube traffic sources with rows in the window are covered', () => {
    expect(matrix.traffic_sources.youtube).toEqual({
      kind: 'covered',
      rows: 120,
      latestDate: '2026-09-28',
      stale: false,
    });
  });

  it('TikTok traffic sources are not ingested, from the matrix alone', () => {
    expect(matrix.traffic_sources.tiktok).toEqual({
      kind: 'not_ingested',
      note: CAPABILITY_MATRIX.traffic_sources.tiktok.note,
    });
  });

  it('Instagram traffic sources are unsupported, from the matrix alone', () => {
    expect(matrix.traffic_sources.instagram).toEqual({
      kind: 'unsupported',
      note: CAPABILITY_MATRIX.traffic_sources.instagram.note,
    });
  });

  it('a connected TikTok with no engagement rows in the window has no data in the window', () => {
    expect(matrix.engagement.tiktok).toEqual({ kind: 'no_data_in_window' });
  });

  it('a platform with no connection is not connected — not "no data"', () => {
    expect(matrix.engagement.instagram).toEqual({ kind: 'not_connected' });
  });

  it('answers every family for every platform', () => {
    expect(Object.keys(matrix).sort()).toEqual([...METRIC_FAMILIES].sort());

    for (const family of METRIC_FAMILIES) {
      expect(Object.keys(matrix[family]).sort()).toEqual(
        [...ANALYTICS_PLATFORMS].sort(),
      );
    }
  });

  it('a project with no connections reads as not connected, never as fifteen failures', () => {
    const empty = foldObservedCoverage([], CAPABILITY_MATRIX, {
      connectedPlatforms: [],
      asOf: AS_OF,
    });

    for (const family of METRIC_FAMILIES) {
      for (const [platform, state] of Object.entries(empty[family])) {
        const level =
          CAPABILITY_MATRIX[family][platform as 'youtube' | 'tiktok'].level;

        expect(state).toEqual(
          level === 'unsupported' || level === 'not_ingested'
            ? expect.objectContaining({ kind: level })
            : { kind: 'not_connected' },
        );
      }
    }
  });

  it('rows that exist win over a missing connection — a disconnected channel keeps its history', () => {
    const folded = foldObservedCoverage(
      [row({ table: 'video_metrics', platform: 'instagram', rows: 4 })],
      CAPABILITY_MATRIX,
      { connectedPlatforms: [], asOf: AS_OF },
    );

    expect(folded.engagement.instagram).toMatchObject({
      kind: 'covered',
      rows: 4,
    });
  });

  it('adds up rows that arrive for the same table and platform', () => {
    const folded = foldObservedCoverage(
      [
        row({ table: 'video_metrics', rows: 3, latestDate: '2026-09-01' }),
        row({ table: 'video_metrics', rows: 4, latestDate: '2026-09-20' }),
      ],
      CAPABILITY_MATRIX,
      { connectedPlatforms: ['youtube'], asOf: AS_OF },
    );

    expect(folded.engagement.youtube).toEqual({
      kind: 'covered',
      rows: 7,
      latestDate: '2026-09-20',
      stale: false,
    });
  });

  describe('channel_daily has no platform column', () => {
    it('credits a resolved platform', () => {
      const folded = foldObservedCoverage(
        [row({ table: 'channel_daily', platform: 'youtube', rows: 30 })],
        CAPABILITY_MATRIX,
        { connectedPlatforms: ['youtube'], asOf: AS_OF },
      );

      expect(folded.channel_totals.youtube).toMatchObject({
        kind: 'covered',
        rows: 30,
      });
    });

    it('never credits an unresolved row to YouTube because that happens to be true today', () => {
      const folded = foldObservedCoverage(
        [row({ table: 'channel_daily', platform: null, rows: 30 })],
        CAPABILITY_MATRIX,
        { connectedPlatforms: ['youtube'], asOf: AS_OF },
      );

      expect(folded.channel_totals.youtube).toEqual({
        kind: 'no_data_in_window',
      });
    });
  });

  it('ignores a platform outside AnalyticsPlatform rather than misfiling it', () => {
    const folded = foldObservedCoverage(
      [row({ table: 'video_metrics', platform: 'facebook', rows: 9 })],
      CAPABILITY_MATRIX,
      { connectedPlatforms: ['youtube'], asOf: AS_OF },
    );

    expect(folded.engagement.youtube).toEqual({ kind: 'no_data_in_window' });
  });

  it('when ClickHouse could not be read, observed cells are null — cannot measure, not empty', () => {
    const folded = foldObservedCoverage(null, CAPABILITY_MATRIX, {
      connectedPlatforms: ['youtube'],
      asOf: AS_OF,
    });

    expect(folded.engagement.youtube).toBeNull();
    // What needs no query is still answered.
    expect(folded.engagement.instagram).toEqual({ kind: 'not_connected' });
    expect(folded.traffic_sources.instagram).toMatchObject({
      kind: 'unsupported',
    });
  });

  it('YouTube revenue is observed in video_revenue_daily: covered with rows, no data without', () => {
    // FILM-1726 made revenue native in its own table. Unread, the cell was
    // null, and the card said "unknown" beside earnings it had.
    expect(CAPABILITY_MATRIX.revenue.youtube.table).toBe('video_revenue_daily');

    const withRows = foldObservedCoverage(
      [row({ table: 'video_revenue_daily', rows: 30 })],
      CAPABILITY_MATRIX,
      { connectedPlatforms: ['youtube'], asOf: AS_OF },
    );
    const without = foldObservedCoverage([], CAPABILITY_MATRIX, {
      connectedPlatforms: ['youtube'],
      asOf: AS_OF,
    });

    expect(withRows.revenue.youtube).toEqual({
      kind: 'covered',
      rows: 30,
      latestDate: '2026-09-28',
      stale: false,
    });
    expect(without.revenue.youtube).toEqual({ kind: 'no_data_in_window' });
  });

  it('a family read from a table outside the six is null once connected — not measured here', () => {
    const folded = foldObservedCoverage(
      [row({ table: 'video_metrics', rows: 5 })],
      CAPABILITY_MATRIX,
      { connectedPlatforms: ['youtube'], asOf: AS_OF },
    );

    // demographics reads video_audience, which this query does not scan.
    expect(CAPABILITY_MATRIX.demographics.youtube.table).toBe('video_audience');
    expect(folded.demographics.youtube).toBeNull();
  });
});

describe('the six tables', () => {
  it('are the ones the spec names', () => {
    expect([...OBSERVED_COVERAGE_TABLES].sort()).toEqual(
      [
        'channel_daily',
        'video_metrics',
        'video_reach_daily',
        'video_retention_curves',
        'video_traffic_sources',
        'video_revenue_daily',
      ].sort(),
    );
  });
});

describe('capabilityCoverage — the half that needs no query', () => {
  it('answers unsupported and not_ingested with the matrix note', () => {
    expect(
      capabilityCoverage(CAPABILITY_MATRIX.traffic_sources.instagram),
    ).toEqual({
      kind: 'unsupported',
      note: CAPABILITY_MATRIX.traffic_sources.instagram.note,
    });
    expect(
      capabilityCoverage(CAPABILITY_MATRIX.traffic_sources.tiktok),
    ).toEqual({
      kind: 'not_ingested',
      note: CAPABILITY_MATRIX.traffic_sources.tiktok.note,
    });
  });

  it('has nothing to say alone where the platform can have data', () => {
    expect(
      capabilityCoverage(CAPABILITY_MATRIX.traffic_sources.youtube),
    ).toBeNull();
    expect(capabilityCoverage(CAPABILITY_MATRIX.engagement.tiktok)).toBeNull();
  });
});

describe('staleness is defined once', () => {
  it('is generous: more than twice the 1-3 day YouTube reporting lag', () => {
    expect(COVERAGE_STALE_AFTER_DAYS).toBeGreaterThan(2 * 3);
  });

  it('does not report healthy ingest, three days behind, as stale', () => {
    expect(isCoverageStale('2026-09-27', '2026-09-30')).toBe(false);
  });

  it('is not stale exactly at the threshold, and is one day past it', () => {
    const at = new Date(Date.UTC(2026, 8, 30));
    const day = (offset: number) =>
      new Date(at.getTime() - offset * 86_400_000).toISOString().slice(0, 10);

    expect(isCoverageStale(day(COVERAGE_STALE_AFTER_DAYS), '2026-09-30')).toBe(
      false,
    );
    expect(
      isCoverageStale(day(COVERAGE_STALE_AFTER_DAYS + 1), '2026-09-30'),
    ).toBe(true);
  });

  it('flags six-week-old newest rows as stale on a covered cell', () => {
    const folded = foldObservedCoverage(
      [row({ table: 'video_metrics', latestDate: '2026-08-19' })],
      CAPABILITY_MATRIX,
      { connectedPlatforms: ['youtube'], asOf: AS_OF },
    );

    expect(folded.engagement.youtube).toMatchObject({
      kind: 'covered',
      stale: true,
    });
  });

  it('measures to the window end, not today, for a window in the past', () => {
    // A March window whose newest row is 29 March is healthy, whatever
    // today is: nothing after 31 March was asked for.
    expect(coverageAsOf('2026-03-31', '2026-09-30')).toBe('2026-03-31');
    expect(coverageAsOf('2026-12-31', '2026-09-30')).toBe('2026-09-30');
    expect(
      isCoverageStale('2026-03-29', coverageAsOf('2026-03-31', AS_OF)),
    ).toBe(false);
  });
});
