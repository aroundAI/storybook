import { describe, expect, it } from 'vitest';

import type { InstagramInsightsResult } from '../src/providers/instagram/types';
import type { TikTokAnalyticsResult } from '../src/providers/tiktok/types';
import type { YouTubeAnalyticsResult } from '../src/providers/youtube/types';
import {
  accountsReachedDelta,
  buildAudienceRows,
  buildRetentionPoints,
  buildSnapshotDeltaRow,
  buildSnapshotRow,
  buildYouTubeDailyRows,
  buildYouTubeRevenueRows,
  computeSnapshotDelta,
  computeYouTubeWindow,
  latestDataDate,
  reelsAttention,
  shouldWriteMetricRow,
  snapshotDeltaMetricDate,
} from '../src/server/ingest';
import { getSyncSchedule } from '../src/server/schedule';

/** FILM-1722's aggregates, not measured: every row that predates them. */
const ALL_SURFACE_UNMEASURED = {
  all_surface_views: null,
  all_surface_likes: null,
  all_surface_comments: null,
};

const baseline = {
  snapshot_date: '2026-01-14',
  views: 1000,
  likes: 100,
  comments: 50,
  shares: 20,
  saves: 10,
  watch_time_seconds: 5000,
  subscribers_gained: 5,
  accounts_reached: 4000,
  reposts: 3,
  ...ALL_SURFACE_UNMEASURED,
};

describe('computeSnapshotDelta', () => {
  it('returns the difference against the baseline', () => {
    const delta = computeSnapshotDelta(
      {
        views: 1500,
        likes: 130,
        comments: 55,
        shares: 25,
        saves: 12,
        watch_time_seconds: 6200,
        subscribers_gained: 8,
        accounts_reached: 5200,
        reposts: 7,
        ...ALL_SURFACE_UNMEASURED,
      },
      baseline,
    );

    expect(delta).toEqual({
      views: 500,
      likes: 30,
      comments: 5,
      shares: 5,
      saves: 2,
      watch_time_seconds: 1200,
      subscribers_gained: 3,
      accounts_reached: 1200,
      reposts: 4,
      ...ALL_SURFACE_UNMEASURED,
    });
  });

  it('clamps negative deltas to zero when platforms restate downward', () => {
    const delta = computeSnapshotDelta(
      {
        views: 900, // spam-filtered below baseline
        likes: 130,
        comments: 40,
        shares: 25,
        saves: 12,
        watch_time_seconds: 6200,
        subscribers_gained: 8,
        accounts_reached: 5200,
        reposts: 7,
        ...ALL_SURFACE_UNMEASURED,
      },
      baseline,
    );

    expect(delta.views).toBe(0);
    expect(delta.comments).toBe(0);
    expect(delta.likes).toBe(30);
  });

  it('returns current totals unchanged without a baseline', () => {
    const current = {
      views: 42,
      likes: 4,
      comments: 2,
      shares: 1,
      saves: 0,
      watch_time_seconds: 300,
      subscribers_gained: 1,
      accounts_reached: 40,
      reposts: 1,
      ...ALL_SURFACE_UNMEASURED,
    };

    expect(computeSnapshotDelta(current, null)).toEqual(current);
  });

  // Migration 017: an unmeasured counter's day is null, never 0 — whether
  // today's figure is missing or the baseline recorded none.
  it('keeps an unmeasured counter null, never 0', () => {
    const current = {
      views: 1500,
      likes: 130,
      comments: 55,
      shares: 25,
      saves: 12,
      watch_time_seconds: null,
      subscribers_gained: null,
      accounts_reached: 5200,
      reposts: 7,
      ...ALL_SURFACE_UNMEASURED,
    };

    const delta = computeSnapshotDelta(current, baseline);
    expect(delta.watch_time_seconds).toBeNull();
    expect(delta.subscribers_gained).toBeNull();
    expect(delta.saves).toBe(2);

    const fromUnmeasured = computeSnapshotDelta(
      { ...current, watch_time_seconds: 6200 },
      { ...baseline, watch_time_seconds: null },
    );
    expect(fromUnmeasured.watch_time_seconds).toBeNull();
  });

  // FILM-1712: reposts is a counter like saves, null for a Story and on the
  // first day after migration 018 (the baseline recorded none).
  it('adds reposts as a counter, and keeps them null when not measured', () => {
    const current = {
      views: 1500,
      likes: 130,
      comments: 55,
      shares: 25,
      saves: 12,
      watch_time_seconds: 6200,
      subscribers_gained: 8,
      accounts_reached: 5200,
      reposts: 7,
      ...ALL_SURFACE_UNMEASURED,
    };

    expect(computeSnapshotDelta(current, baseline).reposts).toBe(4);
    expect(
      computeSnapshotDelta({ ...current, reposts: null }, baseline).reposts,
    ).toBeNull();
    expect(
      computeSnapshotDelta(current, { ...baseline, reposts: null }).reposts,
    ).toBeNull();
  });
});

// FILM-1712 part B: accounts reached is a unique count, so its daily figure
// is "first-time viewers that day", and not measured stays null, never 0.
describe('accountsReachedDelta', () => {
  it("is the day's increase over the baseline snapshot", () => {
    expect(accountsReachedDelta(5200, baseline)).toBe(1200);
  });

  it("is null when today's figure is missing", () => {
    expect(accountsReachedDelta(null, baseline)).toBeNull();
  });

  it('is the lifetime figure when there is no baseline, as for every counter', () => {
    expect(accountsReachedDelta(4000, null)).toBe(4000);
  });

  it('is null when the baseline recorded no reach, so one day cannot absorb the lifetime', () => {
    expect(
      accountsReachedDelta(4000, { ...baseline, accounts_reached: null }),
    ).toBeNull();
  });

  it('clamps a downward restatement of the estimate to 0', () => {
    expect(accountsReachedDelta(3950, baseline)).toBe(0);
  });
});

describe('computeYouTubeWindow', () => {
  const now = new Date('2026-06-15T12:00:00Z');

  it('starts 3 days before the last ingested data date', () => {
    const { startDate, endDate } = computeYouTubeWindow({
      lastDataDate: '2026-06-14',
      publishedAt: '2026-05-01T00:00:00Z',
      now,
    });

    expect(startDate.toISOString()).toBe('2026-06-11T00:00:00.000Z');
    expect(endDate).toBe(now);
  });

  it('falls back to 3 days before now on first sync', () => {
    const { startDate } = computeYouTubeWindow({
      publishedAt: '2026-05-01T00:00:00Z',
      now,
    });

    expect(startDate.toISOString()).toBe('2026-06-12T12:00:00.000Z');
  });

  it('never starts before the publish date', () => {
    const { startDate } = computeYouTubeWindow({
      publishedAt: '2026-06-14T08:00:00Z',
      now,
    });

    expect(startDate.toISOString()).toBe('2026-06-14T08:00:00.000Z');
  });
});

describe('latestDataDate', () => {
  const day = (date: string) => ({
    date,
    views: 0,
    likes: 0,
    comments: 0,
    shares: 0,
    estimatedMinutesWatched: 0,
    averageViewDuration: 0,
    subscribersGained: 0,
    dislikes: 0,
    averageViewPercentage: 0,
    subscribersLost: 0,
  });

  it('finds the latest date regardless of order', () => {
    expect(
      latestDataDate([day('2026-06-14'), day('2026-06-12'), day('2026-06-13')]),
    ).toBe('2026-06-14');
  });

  it('returns null for an empty breakdown', () => {
    expect(latestDataDate([])).toBeNull();
  });
});

describe('buildYouTubeDailyRows', () => {
  it('maps daily metrics to per-day rows keyed by the data date', () => {
    const rows = buildYouTubeDailyRows({
      projectId: '550e8400-e29b-41d4-a716-446655440000',
      videoId: 'publish-1',
      dailyData: [
        {
          date: '2026-06-13',
          views: 100,
          likes: 10,
          comments: 5,
          shares: 2,
          estimatedMinutesWatched: 30,
          averageViewDuration: 18,
          subscribersGained: 1,
          dislikes: 0,
          averageViewPercentage: 40,
          subscribersLost: 0,
        },
        {
          date: '2026-06-14',
          views: 250,
          likes: 20,
          comments: 8,
          shares: 4,
          estimatedMinutesWatched: 75.5,
          averageViewDuration: 18.1,
          subscribersGained: 3,
          dislikes: 1,
          averageViewPercentage: 41,
          subscribersLost: 1,
        },
      ],
    });

    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      video_id: 'publish-1',
      platform: 'youtube',
      metric_date: '2026-06-13',
      views: 100,
      watch_time_seconds: 1800,
      metric_source: 'analytics_api',
      extra_metrics: '{}',
    });
    expect(rows[1]).toMatchObject({
      metric_date: '2026-06-14',
      watch_time_seconds: 4530,
      // No raw payload on any day: extra_metrics is no longer written (FILM-1712).
      extra_metrics: '{}',
    });
  });

  // KB-50. This writer and the Reporting ingest share one ReplacingMergeTree
  // key, and the later row replaces the whole row — so engaged views survive
  // only if this writer carries them too. Null, never 0, where YouTube did
  // not report them.
  describe('engaged views', () => {
    const day = (date: string, engagedViews?: number | null) => ({
      date,
      views: 10,
      likes: 0,
      comments: 0,
      shares: 0,
      estimatedMinutesWatched: 0,
      averageViewDuration: 0,
      subscribersGained: 0,
      dislikes: 0,
      averageViewPercentage: 0,
      subscribersLost: 0,
      engagedViews,
    });

    const build = (dailyData: ReturnType<typeof day>[]) =>
      buildYouTubeDailyRows({
        projectId: '550e8400-e29b-41d4-a716-446655440000',
        videoId: 'publish-1',
        dailyData,
      }).map((r) => [r.metric_date, r.engaged_views]);

    it('carries the reported figure', () => {
      expect(build([day('2026-09-20', 330)])).toEqual([['2026-09-20', 330]]);
    });

    it('keeps a reported zero as zero', () => {
      expect(build([day('2026-09-20', 0)])).toEqual([['2026-09-20', 0]]);
    });

    it('is null when the day has no reported figure', () => {
      expect(
        build([day('2026-09-20', null), day('2026-09-21', undefined)]),
      ).toEqual([
        ['2026-09-20', null],
        ['2026-09-21', null],
      ]);
    });

    it('is null before the metric existed (2025-04-24), whatever the API says', () => {
      expect(build([day('2025-04-23', 7), day('2025-04-24', 9)])).toEqual([
        ['2025-04-23', null],
        ['2025-04-24', 9],
      ]);
    });
  });

  // KB-94. Same key, same rule: the Reporting ingest writes dislikes,
  // subscribers lost and average percentage viewed, so this writer must too,
  // or its row lands later and replaces those figures with the column default.
  it('carries the columns the Reporting ingest also writes (KB-94)', () => {
    const [row] = buildYouTubeDailyRows({
      projectId: '550e8400-e29b-41d4-a716-446655440000',
      videoId: 'publish-1',
      dailyData: [
        {
          date: '2026-09-20',
          views: 401,
          likes: 20,
          comments: 3,
          shares: 1,
          estimatedMinutesWatched: 300,
          averageViewDuration: 45,
          subscribersGained: 5,
          dislikes: 2,
          averageViewPercentage: 45.5,
          subscribersLost: 1,
          engagedViews: 331,
        },
      ],
    });

    expect(row).toMatchObject({
      dislikes: 2,
      avg_view_percentage: 45.5,
      subscribers_lost: 1,
      subscribers_gained: 5,
      // YouTube has no saves metric (KB-114): not measured, never 0.
      saves: null,
    });
  });
});

// KB-111. TikTok and Instagram report none of these four; a 0 was pooled
// with YouTube's figures as if measured.
describe('buildYouTubeRevenueRows (FILM-1726)', () => {
  const dailyRevenue = [
    { date: '2026-03-01', estimatedRevenue: 1234 },
    { date: '2026-03-02', estimatedRevenue: 0 },
  ];

  it('writes each measured day, a measured zero included, in USD cents', () => {
    expect(
      buildYouTubeRevenueRows({
        projectId: 'proj',
        videoId: 'pub',
        revenueAccess: 'authorised',
        dailyRevenue,
      }),
    ).toEqual([
      {
        project_id: 'proj',
        video_id: 'pub',
        platform: 'youtube',
        metric_date: '2026-03-01',
        revenue_cents: 1234,
      },
      {
        project_id: 'proj',
        video_id: 'pub',
        platform: 'youtube',
        metric_date: '2026-03-02',
        revenue_cents: 0,
      },
    ]);
  });

  it('writes nothing unless the read was authorised: no row is not measured', () => {
    for (const revenueAccess of [
      'scope_missing',
      'account_type_gated',
      'unavailable',
    ] as const) {
      expect(
        buildYouTubeRevenueRows({
          projectId: 'proj',
          videoId: 'pub',
          revenueAccess,
          dailyRevenue,
        }),
        revenueAccess,
      ).toEqual([]);
    }
  });
});

describe('buildSnapshotDeltaRow', () => {
  it('writes the four columns neither platform measures as null, not 0', () => {
    const row = buildSnapshotDeltaRow({
      projectId: '550e8400-e29b-41d4-a716-446655440000',
      videoId: 'publish-tt',
      platform: 'tiktok',
      metricDate: '2026-09-20',
      delta: {
        views: 1000,
        likes: 50,
        comments: 4,
        shares: 2,
        saves: 3,
        watch_time_seconds: 0,
        subscribers_gained: 7,
        accounts_reached: 90,
        reposts: 6,
        ...ALL_SURFACE_UNMEASURED,
      },
    });

    expect(row).toMatchObject({
      views: 1000,
      metric_source: 'snapshot_delta',
      subscribers_lost: null,
      avg_view_duration_seconds: null,
      avg_view_percentage: null,
      dislikes: null,
    });
  });

  // KB-114. TikTok reports no saves, watch time or per-video follower gains.
  // Instagram reports saves; its watch time and follows are never requested.
  const delta = {
    views: 1000,
    likes: 50,
    comments: 4,
    shares: 2,
    saves: 3,
    watch_time_seconds: 0,
    subscribers_gained: 7,
    accounts_reached: 90,
    reposts: 6,
    ...ALL_SURFACE_UNMEASURED,
  };
  const build = (platform: 'tiktok' | 'instagram') =>
    buildSnapshotDeltaRow({
      projectId: '550e8400-e29b-41d4-a716-446655440000',
      videoId: `publish-${platform}`,
      platform,
      metricDate: '2026-09-20',
      delta,
    });

  it('writes TikTok saves, watch time and follower gains as null', () => {
    expect(build('tiktok')).toMatchObject({
      saves: null,
      watch_time_seconds: null,
      subscribers_gained: null,
    });
  });

  // FILM-1712: Reels watch time is requested and stored (milliseconds,
  // confirmed on a live account); follows still do not exist for Reels.
  it('keeps Instagram saves and watch time, and writes follower gains as null', () => {
    expect(build('instagram')).toMatchObject({
      saves: 3,
      watch_time_seconds: delta.watch_time_seconds,
      subscribers_gained: null,
    });
    expect(build('instagram').watch_time_seconds).not.toBeNull();
  });

  // FILM-1712 part B: only Instagram reports per-post reach we can read.
  it("keeps Instagram accounts reached and writes TikTok's as null", () => {
    expect(build('instagram').accounts_reached).toBe(90);
    expect(build('tiktok').accounts_reached).toBeNull();
  });

  // FILM-1712: reposts_count is a Media node field TikTok has no match for.
  it("keeps Instagram reposts and writes TikTok's as null", () => {
    expect(build('instagram').reposts).toBe(6);
    expect(build('tiktok').reposts).toBeNull();
  });
});

// KB-151. Lifetime figures Meta computes itself: they go to the snapshot as
// reported, never into a day's delta and never derived from the total.
describe('reelsAttention', () => {
  const reel = (avgWatchTimeMs: number | null, reelsSkipRate: number | null) =>
    ({
      mediaId: 'reel',
      mediaType: 'VIDEO',
      mediaProductType: 'REELS',
      totals: {
        views: 221,
        reach: 121,
        totalInteractions: 0,
        likes: 0,
        comments: 0,
        saved: 0,
        shares: 0,
        watchTimeMs: 749_526,
        avgWatchTimeMs,
        reelsSkipRate,
        reposts: null,
        allSurfaceViews: null,
        allSurfaceLikes: null,
        allSurfaceComments: null,
      },
    }) satisfies InstagramInsightsResult;

  it("stores Meta's average, not total ÷ views (FILM-1712's live Reel)", () => {
    const attention = reelsAttention('instagram', reel(6194, 37.5));

    // 749,526 ÷ 221 is 3,391: the figure that must not appear.
    expect(attention).toEqual({
      ig_reels_avg_watch_time_ms: 6194,
      ig_reels_skip_rate: 37.5,
    });
  });

  it('is null, not 0, where Meta omits either', () => {
    expect(reelsAttention('instagram', reel(null, null))).toEqual({
      ig_reels_avg_watch_time_ms: null,
      ig_reels_skip_rate: null,
    });
    expect(reelsAttention('instagram', reel(0, 0))).toEqual({
      ig_reels_avg_watch_time_ms: 0,
      ig_reels_skip_rate: 0,
    });
  });

  // The writer is where KB-151's average was lost: the provider had it.
  it('reaches the snapshot row the sync inserts, beside the counters', () => {
    const row = buildSnapshotRow({
      projectId: '550e8400-e29b-41d4-a716-446655440000',
      videoId: 'publish-ig',
      platform: 'instagram',
      snapshotDate: '2026-10-01',
      totals: {
        views: 221,
        likes: 0,
        comments: 0,
        shares: 0,
        saves: 0,
        watch_time_seconds: 750,
        subscribers_gained: null,
        accounts_reached: 121,
        reposts: null,
        ...ALL_SURFACE_UNMEASURED,
      },
      analytics: reel(6194, 37.5),
    });

    expect(row).toMatchObject({
      platform: 'instagram',
      views: 221,
      watch_time_seconds: 750,
      ig_reels_avg_watch_time_ms: 6194,
      ig_reels_skip_rate: 37.5,
    });
  });

  it('is null on TikTok, which reports neither', () => {
    expect(
      reelsAttention('tiktok', {
        videoId: 'tt',
        totals: { views: 1, likes: 0, comments: 0, shares: 0 },
      } as unknown as TikTokAnalyticsResult),
    ).toEqual({ ig_reels_avg_watch_time_ms: null, ig_reels_skip_rate: null });
  });
});

describe('buildRetentionPoints / buildAudienceRows', () => {
  const projectId = '550e8400-e29b-41d4-a716-446655440000';

  const youtubeAnalytics = {
    videoId: 'yt-1',
    period: { startDate: '2026-06-01', endDate: '2026-06-14' },
    totals: {} as YouTubeAnalyticsResult['totals'],
    dailyData: [],
    retention: {
      points: [
        { elapsedVideoTimeRatio: 0, audienceWatchRatio: 1 },
        { elapsedVideoTimeRatio: 0.5, audienceWatchRatio: 0.4 },
      ],
    },
    demographics: {
      ageGroups: [{ ageGroup: 'age18-24', viewPercentage: 40 }],
      genders: [{ gender: 'female', viewPercentage: 55 }],
    },
    geography: [
      { country: 'US', views: 700, watchTimeMinutes: 100, viewPercentage: 70 },
    ],
    subscribedStatus: { subscribed: 300, notSubscribed: 700 },
  } as unknown as YouTubeAnalyticsResult;

  it('maps retention curve points', () => {
    const points = buildRetentionPoints({
      projectId,
      videoId: 'publish-1',
      analytics: youtubeAnalytics,
    });

    expect(points).toHaveLength(2);
    expect(points[1]).toMatchObject({
      video_id: 'publish-1',
      elapsed_ratio: 0.5,
      audience_watch_ratio: 0.4,
    });
  });

  it('maps YouTube audience dimensions including subscribed status', () => {
    const rows = buildAudienceRows({
      projectId,
      videoId: 'publish-1',
      platform: 'youtube',
      analytics: youtubeAnalytics,
    });

    const dimensions = rows.map((r) => `${r.dimension}:${r.key}`);
    expect(dimensions).toContain('age_group:age18-24');
    expect(dimensions).toContain('gender:female');
    expect(dimensions).toContain('country:US');
    expect(dimensions).toContain('follower_status:subscribed');

    const country = rows.find((r) => r.dimension === 'country')!;
    expect(country.views).toBe(700);
    expect(country.percentage).toBe(70);
  });
});

describe('snapshot delta write rules', () => {
  const now = new Date('2026-06-15T12:00:00Z');

  it('writes to today with a baseline', () => {
    const input = {
      hasBaseline: true,
      publishedAt: '2026-01-01T00:00:00Z',
      now,
    };
    expect(shouldWriteMetricRow(input)).toBe(true);
    expect(snapshotDeltaMetricDate(input)).toBe('2026-06-15');
  });

  it('attributes a fresh video without baseline to its publish date', () => {
    const input = {
      hasBaseline: false,
      publishedAt: '2026-06-15T02:00:00Z',
      now,
    };
    expect(shouldWriteMetricRow(input)).toBe(true);
    expect(snapshotDeltaMetricDate(input)).toBe('2026-06-15');
  });

  it('writes no metric row for an adopted old video without baseline', () => {
    expect(
      shouldWriteMetricRow({
        hasBaseline: false,
        publishedAt: '2026-05-01T00:00:00Z',
        now,
      }),
    ).toBe(false);
  });
});

describe('getSyncSchedule tiers', () => {
  const daysAgo = (days: number) =>
    new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  it('syncs 30-90 day old videos daily as first_quarter', () => {
    const schedule = getSyncSchedule(daysAgo(45));
    expect(schedule.frequency).toBe('daily');
    expect(schedule.ageCategory).toBe('first_quarter');
  });

  it('syncs videos older than 90 days weekly', () => {
    const schedule = getSyncSchedule(daysAgo(120));
    expect(schedule.frequency).toBe('weekly');
    expect(schedule.ageCategory).toBe('after_90_days');
  });
});

describe('Instagram audience rows (FILM-1712)', () => {
  it('stores age and gender as separate dimensions, gender as TikTok names it', () => {
    const rows = buildAudienceRows({
      projectId: '550e8400-e29b-41d4-a716-446655440000',
      videoId: 'ig-1',
      platform: 'instagram',
      analytics: {
        audience: {
          countries: [{ country: 'US', count: 60 }],
          cities: [],
          ages: [{ ageGroup: '25-34', count: 70 }],
          genders: [
            { gender: 'F', count: 55 },
            { gender: 'M', count: 40 },
            { gender: 'U', count: 5 },
          ],
        },
      } as unknown as Parameters<typeof buildAudienceRows>[0]['analytics'],
    });

    expect(rows.map((row) => [row.dimension, row.key, row.views])).toEqual([
      ['country', 'US', 60],
      ['age_group', '25-34', 70],
      ['gender', 'female', 55],
      ['gender', 'male', 40],
      ['gender', 'other', 5],
    ]);
  });
});

// FILM-1722: the all-surface aggregates are counters in columns of their own.
// They never feed views, likes or comments, and are null when not measured.
describe('Instagram all-surface aggregates (FILM-1722)', () => {
  const lifetime = {
    views: 1500,
    likes: 130,
    comments: 55,
    shares: 25,
    saves: 12,
    watch_time_seconds: 6200,
    subscribers_gained: 8,
    accounts_reached: 5200,
    reposts: 7,
    ...ALL_SURFACE_UNMEASURED,
    all_surface_views: 2400,
    all_surface_likes: 170,
    all_surface_comments: 61,
  };
  const before = {
    ...baseline,
    all_surface_views: 1600,
    all_surface_likes: 120,
    all_surface_comments: 52,
  };

  it('adds each as a counter, leaving views, likes and comments alone', () => {
    expect(computeSnapshotDelta(lifetime, before)).toMatchObject({
      views: 500,
      likes: 30,
      comments: 5,
      all_surface_views: 800,
      all_surface_likes: 50,
      all_surface_comments: 9,
    });
  });

  it('keeps one null when today or the baseline did not measure it', () => {
    expect(
      computeSnapshotDelta({ ...lifetime, all_surface_views: null }, before)
        .all_surface_views,
    ).toBeNull();
    expect(
      computeSnapshotDelta(lifetime, { ...before, all_surface_likes: null })
        .all_surface_likes,
    ).toBeNull();
  });

  it("writes Instagram's to the row and TikTok's as null", () => {
    const build = (platform: 'tiktok' | 'instagram') =>
      buildSnapshotDeltaRow({
        projectId: 'p',
        videoId: 'v',
        platform,
        metricDate: '2026-10-01',
        delta: computeSnapshotDelta(lifetime, before),
      });

    expect(build('instagram')).toMatchObject({
      views: 500,
      all_surface_views: 800,
      all_surface_likes: 50,
      all_surface_comments: 9,
    });
    expect(build('tiktok')).toMatchObject({
      all_surface_views: null,
      all_surface_likes: null,
      all_surface_comments: null,
    });
  });
});
