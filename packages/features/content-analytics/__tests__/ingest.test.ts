import { describe, expect, it } from 'vitest';

import type { YouTubeAnalyticsResult } from '../src/providers/youtube/types';
import {
  buildAudienceRows,
  buildRetentionPoints,
  buildSnapshotDeltaRow,
  buildYouTubeDailyRows,
  computeSnapshotDelta,
  computeYouTubeWindow,
  latestDataDate,
  shouldWriteMetricRow,
  snapshotDeltaMetricDate,
} from '../src/server/ingest';
import { getSyncSchedule } from '../src/server/schedule';

const baseline = {
  snapshot_date: '2026-01-14',
  views: 1000,
  likes: 100,
  comments: 50,
  shares: 20,
  saves: 10,
  watch_time_seconds: 5000,
  subscribers_gained: 5,
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
    };

    expect(computeSnapshotDelta(current, null)).toEqual(current);
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
      extraMetricsJson: '{"retention":true}',
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
      extra_metrics: '{"retention":true}',
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
        extraMetricsJson: '{}',
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
      extraMetricsJson: '{}',
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
      },
      extraMetricsJson: '{}',
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
  // Instagram reports saves and follows, and we never request watch time.
  const delta = {
    views: 1000,
    likes: 50,
    comments: 4,
    shares: 2,
    saves: 3,
    watch_time_seconds: 0,
    subscribers_gained: 7,
  };
  const build = (platform: 'tiktok' | 'instagram') =>
    buildSnapshotDeltaRow({
      projectId: '550e8400-e29b-41d4-a716-446655440000',
      videoId: `publish-${platform}`,
      platform,
      metricDate: '2026-09-20',
      delta,
      extraMetricsJson: '{}',
    });

  it('writes TikTok saves, watch time and follower gains as null', () => {
    expect(build('tiktok')).toMatchObject({
      saves: null,
      watch_time_seconds: null,
      subscribers_gained: null,
    });
  });

  it('keeps Instagram saves and follows, and writes its watch time as null', () => {
    expect(build('instagram')).toMatchObject({
      saves: 3,
      watch_time_seconds: null,
      subscribers_gained: 7,
    });
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
