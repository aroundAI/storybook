import { describe, expect, it } from 'vitest';

import {
  type VideoLogCellRow,
  checkpointFigure,
  checkpointState,
  isPartial,
  parseUtcTimestamp,
  qualityStates,
} from '../src/lib/video-log-cells';
import {
  DEFAULT_VIDEO_LOG_VIEW,
  VIDEO_LOG_PAGE_SIZE,
  nextVideoLogSort,
  videoLogPage,
  videoLogRangeLabel,
  videoLogRequest,
} from '../src/lib/video-log-paging';

const NOW = new Date('2026-09-20T12:00:00Z');

function row(overrides: Partial<VideoLogCellRow> = {}): VideoLogCellRow {
  return {
    publishedAt: '2025-01-01 00:00:00',
    viewsAtAge: { 30: 500, 90: 900 },
    matureAt: { 30: true, 90: true },
    predatesIngestAt: { 30: false, 90: false },
    ingestLagDays: 0,
    lifetimeViews: 1200,
    impressions: 10_000,
    ctr: 0.05,
    avgViewDurationSeconds: 120,
    avgViewPercentage: 42,
    ...overrides,
  };
}

describe('checkpointState — the four states, in order (FILM-1615)', () => {
  it('shows the figure for a mature checkpoint with data', () => {
    expect(checkpointState(row(), 30, NOW)).toEqual({
      kind: 'figure',
      value: 500,
    });
  });

  it('shows a real zero as a figure when data exists', () => {
    expect(checkpointState(row({ viewsAtAge: { 30: 0 } }), 30, NOW)).toEqual({
      kind: 'figure',
      value: 0,
    });
  });

  it('never shows a zero for a video with no metrics at all (EDD F-1)', () => {
    expect(
      checkpointState(
        row({ ingestLagDays: null, viewsAtAge: { 30: 0 } }),
        30,
        NOW,
      ),
    ).toEqual({ kind: 'no-data' });
  });

  it('marks a checkpoint whose window closed before ingest began', () => {
    expect(
      checkpointState(
        row({ ingestLagDays: 40, predatesIngestAt: { 30: true } }),
        30,
        NOW,
      ),
    ).toEqual({ kind: 'predates', lagDays: 40 });
  });

  it('says how long until an immature checkpoint is known', () => {
    expect(
      checkpointState(
        row({
          publishedAt: '2026-09-02 00:00:00',
          matureAt: { 30: false },
        }),
        30,
        NOW,
      ),
    ).toEqual({ kind: 'immature', ageDays: 18, daysToGo: 12 });
  });

  it('puts "not old enough" before "no data": a young video has no answer yet either way', () => {
    expect(
      checkpointState(
        row({
          publishedAt: '2026-09-15 00:00:00',
          matureAt: { 30: false },
          ingestLagDays: null,
        }),
        30,
        NOW,
      ).kind,
    ).toBe('immature');
  });

  it('puts "no data" before "predates ingest"', () => {
    expect(
      checkpointState(
        row({ ingestLagDays: null, predatesIngestAt: { 30: true } }),
        30,
        NOW,
      ).kind,
    ).toBe('no-data');
  });

  it('treats an unparseable publish date as immature, with no age', () => {
    expect(
      checkpointState(
        row({ publishedAt: 'not a date', matureAt: { 30: false } }),
        30,
        NOW,
      ),
    ).toEqual({ kind: 'immature', ageDays: null, daysToGo: 30 });
  });
});

describe('checkpointFigure — the CSV cell', () => {
  // The scheduled raw export has nowhere to put a reason, so its only
  // honest options are the figure or a blank. It used to test `matureAt`
  // alone, which let two kinds of missing data through as `0`: measured
  // against real rows, "no views", "nothing was ever collected" and "this
  // can never be known" all exported the same 0.
  it('gives the figure when there is one, zero included', () => {
    expect(checkpointFigure(row(), 30, NOW)).toBe(500);
    expect(checkpointFigure(row({ viewsAtAge: { 30: 0 } }), 30, NOW)).toBe(0);
  });

  it('blanks a video that has never had a metric ingested', () => {
    expect(
      checkpointFigure(
        row({ ingestLagDays: null, viewsAtAge: { 30: 0 } }),
        30,
        NOW,
      ),
    ).toBeNull();
  });

  it('blanks a window that closed before ingest began', () => {
    expect(
      checkpointFigure(
        row({ ingestLagDays: 40, predatesIngestAt: { 30: true } }),
        30,
        NOW,
      ),
    ).toBeNull();
  });

  it('blanks a checkpoint the video is not old enough for', () => {
    expect(
      checkpointFigure(row({ matureAt: { 30: false } }), 30, NOW),
    ).toBeNull();
  });
});

describe('qualityStates (EDD F-3)', () => {
  it('returns values when there is data behind them', () => {
    const states = qualityStates(row());

    expect(states.ctr).toEqual({ kind: 'value', value: 0.05 });
    expect(states.avgViewDuration).toEqual({ kind: 'value', value: 120 });
    expect(states.lifetimeViews).toEqual({ kind: 'value', value: 1200 });
  });

  it('refuses a CTR over no impressions', () => {
    expect(qualityStates(row({ impressions: 0, ctr: 0 })).ctr).toEqual({
      kind: 'none',
      reason: 'no-impressions',
    });
  });

  it('refuses an impressions count when none were recorded, as its CTR does', () => {
    // Reach lives in its own table and is filled only from YouTube's reach
    // reports, so "none recorded" and "zero recorded" sum to the same 0 and
    // cannot be told apart. Shipped as `0` beside a CTR reading "No
    // impressions recorded" — one absence, two contradictory answers.
    expect(qualityStates(row({ impressions: 0, ctr: 0 })).impressions).toEqual({
      kind: 'none',
      reason: 'no-impressions',
    });
  });

  it('keeps a measured impressions count', () => {
    expect(qualityStates(row({ impressions: 20_000 })).impressions).toEqual({
      kind: 'value',
      value: 20_000,
    });
  });

  it('refuses an average of exactly zero over views that exist', () => {
    // Viewers who watched zero seconds did not watch: the platform did not
    // report the metric, which is not a measurement of nothing.
    const states = qualityStates(
      row({
        lifetimeViews: 5_000,
        avgViewDurationSeconds: 0,
        avgViewPercentage: 0,
      }),
    );

    expect(states.avgViewDuration).toEqual({
      kind: 'none',
      reason: 'not-reported',
    });
    expect(states.avgViewPercentage).toEqual({
      kind: 'none',
      reason: 'not-reported',
    });
  });

  it('refuses an average view duration or percentage over no views', () => {
    const states = qualityStates(row({ lifetimeViews: 0 }));

    expect(states.avgViewDuration).toEqual({
      kind: 'none',
      reason: 'no-views',
    });
    expect(states.avgViewPercentage).toEqual({
      kind: 'none',
      reason: 'no-views',
    });
    // A real zero of lifetime views is still a figure.
    expect(states.lifetimeViews).toEqual({ kind: 'value', value: 0 });
  });

  it('shows nothing as measured for a video with no metrics at all', () => {
    const states = qualityStates(row({ ingestLagDays: null }));

    for (const state of Object.values(states)) {
      expect(state).toEqual({ kind: 'none', reason: 'no-data' });
    }
  });
});

describe('isPartial', () => {
  it('flags a row whose analytics began more than a day late', () => {
    expect(isPartial({ ingestLagDays: 2 })).toBe(true);
    expect(isPartial({ ingestLagDays: 1 })).toBe(false);
    expect(isPartial({ ingestLagDays: 0 })).toBe(false);
  });

  it('does not call "no data" partial — it has its own state', () => {
    expect(isPartial({ ingestLagDays: null })).toBe(false);
  });
});

describe('parseUtcTimestamp (EDD F-4)', () => {
  it("reads ClickHouse's zoneless timestamp as UTC, not local time", () => {
    expect(parseUtcTimestamp('2026-01-01 20:00:00')?.toISOString()).toBe(
      '2026-01-01T20:00:00.000Z',
    );
  });

  it('accepts an ISO timestamp too', () => {
    expect(parseUtcTimestamp('2026-01-01T20:00:00Z')?.toISOString()).toBe(
      '2026-01-01T20:00:00.000Z',
    );
  });

  it('honours an explicit offset rather than reading it as UTC', () => {
    expect(parseUtcTimestamp('2026-01-02T01:30:00+05:30')?.toISOString()).toBe(
      '2026-01-01T20:00:00.000Z',
    );
  });

  it('returns null for anything unparseable', () => {
    expect(parseUtcTimestamp('not a date')).toBeNull();
  });
});

describe('Video Log paging', () => {
  it('asks for one row more than a page, from the page offset', () => {
    expect(videoLogRequest({ ...DEFAULT_VIDEO_LOG_VIEW, page: 2 })).toEqual({
      orderBy: 'published_at',
      orderDirection: 'desc',
      limit: VIDEO_LOG_PAGE_SIZE + 1,
      offset: 2 * VIDEO_LOG_PAGE_SIZE,
    });
  });

  it('shows a page and says whether another follows', () => {
    const full = Array.from({ length: VIDEO_LOG_PAGE_SIZE + 1 }, (_, i) => i);

    expect(videoLogPage(full)).toEqual({
      rows: full.slice(0, VIDEO_LOG_PAGE_SIZE),
      hasMore: true,
    });
    expect(videoLogPage(full.slice(0, VIDEO_LOG_PAGE_SIZE)).hasMore).toBe(
      false,
    );
  });

  it('flips the direction on the same column and returns to the first page', () => {
    expect(
      nextVideoLogSort({ ...DEFAULT_VIDEO_LOG_VIEW, page: 3 }, 'published_at'),
    ).toEqual({ orderBy: 'published_at', orderDirection: 'asc', page: 0 });
  });

  it('starts a new column where a reader expects', () => {
    expect(nextVideoLogSort(DEFAULT_VIDEO_LOG_VIEW, 'title')).toEqual({
      orderBy: 'title',
      orderDirection: 'asc',
      page: 0,
    });
    expect(nextVideoLogSort(DEFAULT_VIDEO_LOG_VIEW, 'lifetime_views')).toEqual({
      orderBy: 'lifetime_views',
      orderDirection: 'desc',
      page: 0,
    });
  });

  it('labels the rows a page holds', () => {
    expect(videoLogRangeLabel(1, 100)).toBe('Rows 101–200');
    expect(videoLogRangeLabel(0, 7)).toBe('Rows 1–7');
  });
});
