import { describe, expect, it } from 'vitest';

import {
  UNMEASURED_REASON_TEXT,
  WATCHED_METRICS,
  WATCHED_METRIC_KEYS,
  allPublishedAfter,
  baselineWindow,
  daysBetween,
  foldCtr,
  foldNetSubscribers,
  foldTrafficShare,
  foldViewWeighted,
  foldViewsAtAge,
  formatWatchedValue,
  isWatchedMetricKey,
  perDay,
  resultWindow,
  stampFold,
} from '../src/lib/watched-metrics';

describe('the watched-metric registry', () => {
  it('defines every key, and nothing else resolves as one', () => {
    expect(Object.keys(WATCHED_METRICS).sort()).toEqual(
      [...WATCHED_METRIC_KEYS].sort(),
    );
    expect(isWatchedMetricKey('ctr')).toBe(true);
    expect(isWatchedMetricKey('retired_metric')).toBe(false);
    // Prototype keys must not pass: `in` would accept these.
    expect(isWatchedMetricKey('constructor')).toBe(false);
    expect(isWatchedMetricKey('toString')).toBe(false);
  });

  it('leaves only views at 30 days unwindowed', () => {
    const unwindowed = WATCHED_METRIC_KEYS.filter(
      (key) => !WATCHED_METRICS[key].windowed,
    );

    expect(unwindowed).toEqual(['views_at_30d']);
  });
});

describe('foldViewsAtAge', () => {
  it('takes the median of mature videos, ignoring immature ones', () => {
    const fold = foldViewsAtAge([
      { views: 100, mature: true, predatesIngest: false },
      { views: 900, mature: true, predatesIngest: false },
      { views: 300, mature: true, predatesIngest: false },
      { views: 0, mature: false, predatesIngest: false },
    ]);

    expect(fold).toEqual({ status: 'measured', value: 300, coveredVideos: 3 });
  });

  it('averages the middle pair for an even count', () => {
    const fold = foldViewsAtAge([
      { views: 100, mature: true, predatesIngest: false },
      { views: 400, mature: true, predatesIngest: false },
    ]);

    expect(fold).toMatchObject({ value: 250 });
  });

  it('is not swayed by one breakout video, as a mean would be', () => {
    const fold = foldViewsAtAge([
      { views: 100, mature: true, predatesIngest: false },
      { views: 120, mature: true, predatesIngest: false },
      { views: 50_000, mature: true, predatesIngest: false },
    ]);

    expect(fold).toMatchObject({ value: 120 });
  });

  it('says none are mature rather than reporting zero', () => {
    expect(
      foldViewsAtAge([{ views: 40, mature: false, predatesIngest: false }]),
    ).toEqual({
      status: 'unmeasured',
      reason: 'none_mature',
    });
  });

  it('says there is no data when there are no rows at all', () => {
    expect(foldViewsAtAge([])).toEqual({
      status: 'unmeasured',
      reason: 'no_data',
    });
  });
});

describe('foldCtr', () => {
  it('weights by impressions, not by views', () => {
    // 1,000 impressions at 10% and 9,000 at 2%: 280 clicks in 10,000
    // impressions is 2.8%. A plain mean of the two rates would say 6%.
    const fold = foldCtr([
      { impressions: 1_000, impressionsCtr: 0.1 },
      { impressions: 9_000, impressionsCtr: 0.02 },
    ]);

    expect(fold.status).toBe('measured');
    expect(fold.status === 'measured' && fold.value).toBeCloseTo(0.028, 10);
  });

  it('counts only videos that had impressions as covered', () => {
    const fold = foldCtr([
      { impressions: 500, impressionsCtr: 0.05 },
      { impressions: 0, impressionsCtr: 0 },
    ]);

    expect(fold).toMatchObject({ coveredVideos: 1 });
  });

  it('is unmeasured, not 0%, when nothing had an impression', () => {
    expect(foldCtr([{ impressions: 0, impressionsCtr: 0 }])).toEqual({
      status: 'unmeasured',
      reason: 'no_data',
    });
  });
});

describe('foldViewWeighted', () => {
  it('weights each video by its views in the window', () => {
    // 90 views at 30s and 10 at 130s: 4,000s over 100 views is 40s.
    const fold = foldViewWeighted([
      { value: 30, views: 90 },
      { value: 130, views: 10 },
    ]);

    expect(fold).toEqual({ status: 'measured', value: 40, coveredVideos: 2 });
  });

  it('is unmeasured when the videos had no views in the window', () => {
    expect(foldViewWeighted([{ value: 0, views: 0 }])).toEqual({
      status: 'unmeasured',
      reason: 'no_data',
    });
  });

  // KB-111. A TikTok video does not measure average percentage viewed; its
  // views weighted against a 0 turned 45.5% into a "measured" 13%.
  it('leaves out a video whose platform does not measure the figure', () => {
    expect(
      foldViewWeighted([
        { value: 45.5, views: 400 },
        { value: null, views: 1000 },
      ]),
    ).toEqual({ status: 'measured', value: 45.5, coveredVideos: 1 });
  });

  it('is unmeasured when no video measures the figure', () => {
    expect(foldViewWeighted([{ value: null, views: 1000 }])).toEqual({
      status: 'unmeasured',
      reason: 'no_data',
    });
  });
});

describe('foldTrafficShare', () => {
  const rows = [
    { source: 'RELATED_VIDEO', videoId: 'a', views: 60 },
    { source: 'SUBSCRIBER', videoId: 'a', views: 20 },
    { source: 'YT_SEARCH', videoId: 'b', views: 15 },
    // END_SCREEN is deliberately not browse+suggested (FILM-1605).
    { source: 'END_SCREEN', videoId: 'b', views: 5 },
  ];

  it('shares a group of the pooled views, through the FILM-1605 taxonomy', () => {
    expect(foldTrafficShare(rows, 'browse_suggested')).toEqual({
      status: 'measured',
      value: 0.8,
      coveredVideos: 2,
    });
    expect(foldTrafficShare(rows, 'search')).toMatchObject({ value: 0.15 });
  });

  it('is unmeasured when the videos have no traffic rows', () => {
    expect(foldTrafficShare([], 'search')).toEqual({
      status: 'unmeasured',
      reason: 'no_data',
    });
  });
});

describe('foldNetSubscribers', () => {
  it('sums gained minus lost across the videos with data', () => {
    expect(
      foldNetSubscribers([
        { gained: 30, lost: 4 },
        { gained: 2, lost: 5 },
      ]),
    ).toEqual({ status: 'measured', value: 23, coveredVideos: 2 });
  });

  it('can be negative, which is a result and not an error', () => {
    expect(foldNetSubscribers([{ gained: 1, lost: 6 }])).toMatchObject({
      value: -5,
    });
  });

  it('is unmeasured when no video has data, rather than a net of zero', () => {
    expect(foldNetSubscribers([])).toEqual({
      status: 'unmeasured',
      reason: 'no_data',
    });
  });

  // KB-111. Instagram reports gains and no losses: its "net" would be gains.
  it('leaves out a video whose losses were not measured', () => {
    expect(
      foldNetSubscribers([
        { gained: 30, lost: 4 },
        { gained: 50, lost: null },
      ]),
    ).toEqual({ status: 'measured', value: 26, coveredVideos: 1 });
  });

  it('is unmeasured when no video measured its losses', () => {
    expect(foldNetSubscribers([{ gained: 50, lost: null }])).toEqual({
      status: 'unmeasured',
      reason: 'no_data',
    });
  });
});

describe('stampFold', () => {
  it('stamps a measured fold with its unit, window and coverage', () => {
    const window = { start: '2026-07-01', end: '2026-08-29' };

    expect(
      stampFold(
        'ctr',
        { status: 'measured', value: 0.04, coveredVideos: 3 },
        window,
        5,
        12,
      ),
    ).toEqual({
      status: 'measured',
      metric: 'ctr',
      value: 0.04,
      unit: 'ratio',
      window,
      coveredVideos: 3,
      totalVideos: 5,
      daysWithData: 12,
      // 2026-07-01 to 2026-08-29 inclusive.
      windowDays: 60,
    });
  });

  it('carries the reason through for an unmeasured fold', () => {
    expect(
      stampFold(
        'views_at_30d',
        { status: 'unmeasured', reason: 'none_mature' },
        null,
        2,
        null,
      ),
    ).toEqual({
      status: 'unmeasured',
      metric: 'views_at_30d',
      reason: 'none_mature',
      window: null,
    });
  });
});

describe('snapshot windows', () => {
  it('puts the baseline in the days before the start, excluding the start day', () => {
    expect(baselineWindow('2026-07-01', 60)).toEqual({
      start: '2026-05-02',
      end: '2026-06-30',
    });
  });

  it('gives the baseline exactly windowDays days', () => {
    const window = baselineWindow('2026-03-01', 30);

    expect(daysBetween(window.start, window.end) + 1).toBe(30);
  });

  it('puts the result from the start day to the end day', () => {
    expect(resultWindow('2026-07-01', '2026-09-13')).toEqual({
      start: '2026-07-01',
      end: '2026-09-13',
    });
  });

  it('reports the days that actually elapsed, not the planned window', () => {
    expect(daysBetween('2026-07-01', '2026-09-13')).toBe(74);
  });

  it('is not thrown by a daylight-saving change', () => {
    expect(daysBetween('2026-03-01', '2026-04-01')).toBe(31);
  });
});

describe('formatWatchedValue', () => {
  it('formats each unit', () => {
    expect(formatWatchedValue(0.0283, 'ratio')).toBe('2.8%');
    expect(formatWatchedValue(47.25, 'percent')).toBe('47.3%');
    expect(formatWatchedValue(95.4, 'seconds')).toBe('1:35');
    expect(formatWatchedValue(23, 'subscribers')).toBe('+23');
    expect(formatWatchedValue(-5, 'subscribers')).toBe('-5');
    expect(formatWatchedValue(12345.6, 'views')).toBe('12,346');
  });
});

describe('UNMEASURED_REASON_TEXT', () => {
  it('explains every reason', () => {
    for (const reason of [
      'no_linked_videos',
      'no_data',
      'none_mature',
      'unknown_metric',
    ] as const) {
      expect(UNMEASURED_REASON_TEXT[reason].length).toBeGreaterThan(0);
    }
  });
});

describe('coverage is stated, not implied (C1-C3)', () => {
  it('leaves out a video whose 30 days closed before ingest began', () => {
    // Its 0 is not a measured zero: no data exists for that window at all.
    const fold = foldViewsAtAge([
      { views: 400, mature: true, predatesIngest: false },
      { views: 600, mature: true, predatesIngest: false },
      { views: 0, mature: true, predatesIngest: true },
    ]);

    expect(fold).toEqual({ status: 'measured', value: 500, coveredVideos: 2 });
  });

  it('says so when every mature video predates ingest', () => {
    expect(
      foldViewsAtAge([{ views: 0, mature: true, predatesIngest: true }]),
    ).toEqual({ status: 'unmeasured', reason: 'predates_ingest' });
  });

  it('explains the new reason in words', () => {
    expect(UNMEASURED_REASON_TEXT.predates_ingest.length).toBeGreaterThan(0);
  });

  it('marks sums and rates, so a sum is never compared across unequal windows unmarked', () => {
    expect(WATCHED_METRICS.subscribers_net.kind).toBe('sum');
    for (const key of WATCHED_METRIC_KEYS.filter(
      (k) => k !== 'subscribers_net',
    )) {
      expect(WATCHED_METRICS[key].kind).toBe('rate');
    }
  });

  it('gives a sum per day of data, keeping the raw sum', () => {
    expect(perDay(30, 12)).toBeCloseTo(2.5, 10);
  });

  it('has no per-day value without days of data', () => {
    expect(perDay(30, 0)).toBeNull();
  });

  it('records no day coverage for an age-bounded metric', () => {
    expect(
      stampFold(
        'views_at_30d',
        { status: 'measured', value: 500, coveredVideos: 2 },
        null,
        3,
        null,
      ),
    ).toMatchObject({ daysWithData: null, windowDays: null });
  });
});

describe('allPublishedAfter (FILM-1610 review 5)', () => {
  const window = { start: '2026-06-01', end: '2026-06-30' };

  it('is true when every video was published after the window', () => {
    expect(
      allPublishedAfter(
        ['2026-07-01T00:30:00Z', '2026-07-09T12:00:00Z'],
        window,
      ),
    ).toBe(true);
  });

  it('is false when any video existed within or before the window', () => {
    expect(
      allPublishedAfter(
        ['2026-07-01T00:30:00Z', '2026-06-30T23:00:00Z'],
        window,
      ),
    ).toBe(false);
    expect(allPublishedAfter(['2026-01-01T00:00:00Z'], window)).toBe(false);
  });

  it('does not assume a video with no publish time is late', () => {
    expect(allPublishedAfter(['2026-07-01T00:00:00Z', null], window)).toBe(
      false,
    );
  });

  it('is false with no videos, which has its own reason', () => {
    expect(allPublishedAfter([], window)).toBe(false);
  });
});
