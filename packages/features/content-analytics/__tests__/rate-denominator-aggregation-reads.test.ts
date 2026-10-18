import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { recordViewsDenominator } from '@kit/clickhouse';
import type { PerVideoTotals } from '@kit/clickhouse';

import { assembleDigest, localDay } from '../src/lib/daily-digest';
import { NO_VIDEO_FIGURES } from '../src/lib/daily-figures';
import {
  getContentList,
  getEpisodeAnalytics,
  getProjectAnalytics,
  getSeasonAnalytics,
} from '../src/server/aggregation-queries';

/**
 * FILM-1732: the episode, season, project and content-list reads return
 * each engagement rate with what it divided by — the same figure as
 * before, and a record of the platforms that contributed rows over the
 * window their totals were counted over.
 */
const state: {
  publishes: unknown[];
  totals: Map<string, PerVideoTotals>;
} = { publishes: [], totals: new Map() };

const SINGLE: Record<string, unknown> = {
  episodes: {
    id: 'ep-1',
    title: 'Episode 1',
    number: 1,
    season_id: 'season-1',
    project_id: 'project-1',
  },
  seasons: { id: 'season-1', number: 1, name: 'Season 1' },
  projects: { id: 'project-1', name: 'Project' },
};

function builder(table: string) {
  const rows =
    table === 'publishes'
      ? state.publishes
      : table === 'episodes'
        ? [{ id: 'ep-1', title: 'Episode 1', number: 1 }]
        : table === 'seasons'
          ? [{ id: 'season-1', number: 1, name: 'Season 1' }]
          : [];

  const chain = {
    select: () => chain,
    eq: () => chain,
    is: () => chain,
    in: () => chain,
    not: () => chain,
    gte: () => chain,
    lte: () => chain,
    order: () => chain,
    range: async (from: number) => ({
      data: from === 0 ? rows : [],
      error: null,
    }),
    single: async () => ({ data: SINGLE[table], error: null }),
    maybeSingle: async () => ({
      data: { id: 'project-1', account_id: 'account-1' },
      error: null,
    }),
    then: (resolve: (value: unknown) => void) =>
      resolve({ data: rows, error: null }),
  };

  return chain;
}

vi.mock('@kit/supabase/server-client', () => ({
  getSupabaseServerClient: () => ({
    from: builder,
    rpc: async () => ({ data: true, error: null }),
  }),
}));

vi.mock('@kit/clickhouse/server', () => ({
  queryAudienceRows: async () => [],
  queryDailyTimeSeries: async () => [],
  queryDailyTimeSeriesByPlatform: async () => [],
  queryPlatformBreakdown: async () => [],
  queryTotalsByVideoIds: async () => state.totals,
  queryVideoMetricSums: async () => [],
}));

function totals(
  figures: Pick<PerVideoTotals, 'views' | 'likes' | 'comments' | 'shares'>,
): PerVideoTotals {
  return {
    ...figures,
    saves: 0,
    watch_time_seconds: 0,
    revenue_cents: null,
    subscribers_gained: 0,
    measured: {
      saves: false,
      watch_time_seconds: false,
      subscribers_gained: false,
      shares: true,
    },
  };
}

const publish = (id: string, platform: string, publishedAt: string) => ({
  id,
  platform,
  episode_id: 'ep-1',
  title: id,
  published_at: publishedAt,
  episodes: { id: 'ep-1', title: 'Episode 1', thumbnail_url: null },
});

// Read on 2026-10-02: lifetime totals of a 2026-08-01 publish cross
// YouTube's change of 2026-08-27.
const READ_ON = '2026-10-02';
const LIFETIME = { from: '2026-08-01', to: READ_ON };

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(`${READ_ON}T12:00:00Z`));

  state.publishes = [
    publish('yt', 'youtube', '2026-08-01T09:00:00Z'),
    publish('fb', 'facebook', '2026-08-10T09:00:00Z'),
  ];
  state.totals = new Map([
    ['yt', totals({ views: 1000, likes: 50, comments: 30, shares: 20 })],
    // Facebook stores NULL views (FILM-1720 option A).
    ['fb', totals({ views: null, likes: 7, comments: 1, shares: 2 })],
  ]);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('episode analytics records its engagement rate (FILM-1732)', () => {
  it('keeps the figure and records both platforms over the lifetime window', async () => {
    const analytics = await getEpisodeAnalytics('ep-1');

    // (50 + 7 + 30 + 1 + 20 + 2) / 1000, Facebook's views adding nothing.
    expect(analytics?.engagementRate?.value).toBeCloseTo(11, 10);
    expect(analytics?.engagementRate?.denominator).toEqual(
      recordViewsDenominator({
        platforms: ['youtube', 'facebook'],
        window: LIFETIME,
      }),
    );
    expect(
      analytics?.engagementRate?.denominator.crosses.map((c) => c.date),
    ).toEqual(['2026-08-27']);
    expect(
      analytics?.engagementRate?.denominator.platforms.find(
        (part) => part.platform === 'facebook',
      ),
    ).toEqual({
      platform: 'facebook',
      inDenominator: false,
      reason: 'no_single_view_definition',
    });
  });

  it('records the date filter as the window when there is one', async () => {
    const analytics = await getEpisodeAnalytics('ep-1', {
      start: new Date('2026-09-01T00:00:00Z'),
      end: new Date('2026-09-30T00:00:00Z'),
    });

    expect(analytics?.engagementRate?.denominator.window).toEqual({
      from: '2026-09-01',
      to: '2026-09-30',
    });
    expect(analytics?.engagementRate?.denominator.crosses).toEqual([]);
  });

  it('leaves out a platform with no rows', async () => {
    state.totals.delete('fb');

    const analytics = await getEpisodeAnalytics('ep-1');

    expect(analytics?.engagementRate?.value).toBe(10);
    expect(
      analytics?.engagementRate?.denominator.platforms.map((p) => p.platform),
    ).toEqual(['youtube']);
  });
});

describe('season and project analytics record their averages (FILM-1732)', () => {
  it('records the season average over its episodes platforms', async () => {
    const season = await getSeasonAnalytics('season-1');
    const record = recordViewsDenominator({
      platforms: ['youtube', 'facebook'],
      window: LIFETIME,
    });

    expect(season?.avgEngagementRate?.value).toBeCloseTo(11, 10);
    expect(season?.avgEngagementRate?.denominator).toEqual(record);
    expect(season?.episodes[0]?.engagement?.denominator).toEqual(record);
  });

  it('reads a ninety-day project window across the change', async () => {
    const project = await getProjectAnalytics('project-1', {
      startDate: new Date('2026-07-05T00:00:00Z'),
      endDate: new Date('2026-10-02T00:00:00Z'),
    });

    expect(project?.avgEngagementRate?.value).toBeCloseTo(11, 10);
    expect(project?.avgEngagementRate?.denominator.window).toEqual({
      from: '2026-07-05',
      to: '2026-10-02',
    });
  });

  it('records the project average over its seasons platforms', async () => {
    const project = await getProjectAnalytics('project-1');

    expect(project?.avgEngagementRate?.value).toBeCloseTo(11, 10);
    expect(project?.avgEngagementRate?.denominator).toEqual(
      recordViewsDenominator({
        platforms: ['youtube', 'facebook'],
        window: LIFETIME,
      }),
    );
  });

  it('a season with no publishes has no average to record: not measured, not 0 (KB-194)', async () => {
    state.publishes = [];

    const season = await getSeasonAnalytics('season-1');

    expect(season?.avgEngagementRate).toBeNull();
  });
});

describe('the content list records each row (FILM-1732)', () => {
  it('records a row over its own platform, from its publish date to today', async () => {
    const list = await getContentList('project-1');
    const youtube = list.find((item) => item.publishId === 'yt');
    const facebook = list.find((item) => item.publishId === 'fb');

    expect(youtube?.engagementRate).toEqual({
      value: 10,
      denominator: recordViewsDenominator({
        platforms: ['youtube'],
        window: LIFETIME,
      }),
    });
    // No views to divide by: no rate, so no record (KB-153).
    expect(facebook?.engagementRate).toBeNull();
  });
});

describe('the morning digest’s engagement rate is the content list’s (FILM-1736)', () => {
  it('for the same rows, to the figure', async () => {
    state.totals = new Map([
      ['yt', totals({ views: 1003, likes: 51, comments: 30, shares: 20 })],
      ['fb', totals({ views: null, likes: 7, comments: 1, shares: 2 })],
    ]);
    const list = await getContentList('project-1');
    const digest = assembleDigest({
      projectId: 'project-1',
      day: localDay(READ_ON, 'UTC'),
      storeOff: null,
      freshness: [],
      channels: [],
      channelFigures: [],
      publishes: list.map((item) => ({
        id: item.publishId,
        episodeId: item.episodeId,
        title: item.publishTitle,
        episodeTitle: item.episodeTitle,
        platform: item.platform,
        contentType: 'full',
        connectionId: null,
        url: null,
        publishedAt: item.publishedAt,
        shortsGroup: null,
      })),
      // Both moved on the day, so both are listed
      videoDay: list.map((item) => ({
        publishId: item.publishId,
        date: READ_ON,
        platform: item.platform,
        ...NO_VIDEO_FIGURES,
        likes: 1,
        source: 'analytics_api' as const,
      })),
      videoLifetime: [],
      engagementCounts: { day: new Map(), lifetime: state.totals },
      viewsAtAge: new Map(),
      retentionCurves: new Map(),
      traffic: [],
      audience: null,
      comments: [],
      trendComments: [],
      reactions: [],
      commentsDisclosure: null,
      posts: [],
      scheduledThrough: [],
      revenue: { rows: [], access: [] },
    });
    const digestRate = (id: string) =>
      digest.videos.find((v) => v.publishId === id)!.engagementRate.lifetime
        .percent;
    const listRate = (id: string) =>
      list.find((item) => item.publishId === id)!.engagementRate?.value ?? null;

    // (51 + 30 + 20) / 1003 × 100 = 10.0698
    expect(listRate('yt')).toBeCloseTo(10.0698, 4);
    expect(digestRate('yt')).toBe(Math.round(listRate('yt')! * 100) / 100);
    expect(listRate('fb')).toBeNull();
    expect(digestRate('fb')).toBeNull();
  });
});
