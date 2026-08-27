import { describe, expect, it } from 'vitest';

import {
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
