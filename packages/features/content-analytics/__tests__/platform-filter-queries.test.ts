import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AnalyticsPlatform } from '@kit/clickhouse';

import {
  getContentList,
  getProjectAnalytics,
  getProjectAudienceData,
  getProjectDailyMetrics,
} from '../src/server/aggregation-queries';

/**
 * FILM-1709: the dashboard's project reads narrow by platform in their
 * queries, so a deselected platform leaves every figure it was in.
 *
 * The fake PostgREST below applies `.in()` the way the server does — a
 * read that forgets to pass the selection gets every platform's rows back,
 * and the figures here do not move. Views by hand: YouTube 120, TikTok
 * 300, Instagram 45; every platform 465.
 */

const PUBLISHES = [
  { id: 'p-yt', platform: 'youtube', episode_id: 'e1', title: 'yt' },
  { id: 'p-tt', platform: 'tiktok', episode_id: 'e1', title: 'tt' },
  { id: 'p-ig', platform: 'instagram', episode_id: 'e2', title: 'ig' },
];

const VIEWS: Record<string, number> = { 'p-yt': 120, 'p-tt': 300, 'p-ig': 45 };

const TABLES: Record<string, Record<string, unknown>[]> = {
  projects: [{ id: 'project-1', name: 'Project', account_id: 'account-1' }],
  seasons: [{ id: 's1', number: 1, name: 'Season 1' }],
  episodes: [
    { id: 'e1', title: 'Episode 1', number: 1 },
    { id: 'e2', title: 'Episode 2', number: 2 },
  ],
  publishes: PUBLISHES.map((publish) => ({
    ...publish,
    published_at: '2026-09-10T00:00:00Z',
    episodes: { id: publish.episode_id, title: 'Episode', thumbnail_url: null },
  })),
};

const calls: {
  inPlatform: Array<{ table: string; values: string[] }>;
  clickHouse: Array<{ name: string; platforms: unknown }>;
} = { inPlatform: [], clickHouse: [] };

/** A PostgREST-shaped builder that applies `.in()` on columns its rows carry. */
function builder(table: string) {
  let rows = [...(TABLES[table] ?? [])];

  const chain = {
    select: () => chain,
    eq: () => chain,
    is: () => chain,
    not: () => chain,
    gte: () => chain,
    lte: () => chain,
    order: () => chain,
    in: (column: string, values: string[]) => {
      if (column === 'platform') calls.inPlatform.push({ table, values });
      rows = rows.filter(
        (row) => !(column in row) || values.includes(String(row[column])),
      );
      return chain;
    },
    range: async (from: number, to: number) => ({
      data: rows.slice(from, to + 1),
      error: null,
    }),
    single: async () => ({ data: rows[0] ?? null, error: null }),
    maybeSingle: async () => ({ data: rows[0] ?? null, error: null }),
  };

  return chain;
}

vi.mock('@kit/supabase/server-client', () => ({
  getSupabaseServerClient: () => ({
    from: (table: string) => builder(table),
    rpc: async () => ({ data: true, error: null }),
  }),
}));

const platformOf = (id: string) =>
  PUBLISHES.find((publish) => publish.id === id)!.platform;

const totals = (views: number) => ({
  views,
  likes: 0,
  comments: 0,
  shares: 0,
  saves: 0,
  watch_time_seconds: 0,
  revenue_cents: 0,
  subscribers_gained: 0,
});

vi.mock('@kit/clickhouse/server', () => ({
  queryTotalsByVideoIds: async (ids: string[]) =>
    new Map(ids.map((id) => [id, totals(VIEWS[id] ?? 0)])),
  queryPlatformBreakdown: async (filters: { platforms?: string[] }) => {
    calls.clickHouse.push({
      name: 'queryPlatformBreakdown',
      platforms: filters.platforms,
    });
    return PUBLISHES.filter(
      (publish) =>
        !filters.platforms || filters.platforms.includes(publish.platform),
    ).map((publish) => ({
      platform: publish.platform,
      ...totals(VIEWS[publish.id]!),
    }));
  },
  queryDailyTimeSeriesByPlatform: async (filters: { platforms?: string[] }) => {
    calls.clickHouse.push({
      name: 'queryDailyTimeSeriesByPlatform',
      platforms: filters.platforms,
    });
    return [];
  },
  queryDailyTimeSeries: async () => [],
  queryAudienceRows: async (input: {
    videoIds: string[];
    dimension: string;
  }) =>
    input.dimension === 'country'
      ? input.videoIds.map((videoId) => ({
          videoId,
          key: platformOf(videoId) === 'instagram' ? 'BR' : 'US',
          views: VIEWS[videoId]!,
          percentage: 0,
        }))
      : [],
}));

beforeEach(() => {
  calls.inPlatform = [];
  calls.clickHouse = [];
});

const viewsFor = async (platforms?: AnalyticsPlatform[]) =>
  (await getProjectAnalytics('project-1', { platforms }))!.totalViews;

describe('the headline figures follow the platform filter (FILM-1709)', () => {
  it('sums every platform to the three single-platform totals', async () => {
    const all = await viewsFor(['youtube', 'tiktok', 'instagram']);
    const singles = [
      await viewsFor(['youtube']),
      await viewsFor(['tiktok']),
      await viewsFor(['instagram']),
    ];

    expect(all).toBe(465);
    expect(singles).toEqual([120, 300, 45]);
    expect(singles.reduce<number>((sum, views) => sum + (views ?? 0), 0)).toBe(
      all,
    );
  });

  it('takes a deselected platform out of the headline Views', async () => {
    expect(await viewsFor(['youtube', 'instagram'])).toBe(165);
  });

  it('narrows the publishes in the query, and the platform split in ClickHouse', async () => {
    const analytics = await getProjectAnalytics('project-1', {
      platforms: ['youtube', 'instagram'],
    });

    expect(calls.inPlatform).toContainEqual({
      table: 'publishes',
      values: ['youtube', 'instagram'],
    });
    expect(calls.clickHouse).toContainEqual({
      name: 'queryPlatformBreakdown',
      platforms: ['youtube', 'instagram'],
    });
    expect(analytics!.platformTotals.map((p) => p.platform).sort()).toEqual([
      'instagram',
      'youtube',
    ]);
  });

  it('counts only episodes with a publish on a selected platform', async () => {
    const tiktokOnly = await getProjectAnalytics('project-1', {
      platforms: ['tiktok'],
    });

    expect(tiktokOnly!.contentCount).toBe(1);
  });

  it('asks for the daily series by platform, in the query', async () => {
    await getProjectDailyMetrics('project-1', { platforms: ['tiktok'] });

    expect(calls.clickHouse).toContainEqual({
      name: 'queryDailyTimeSeriesByPlatform',
      platforms: ['tiktok'],
    });
  });

  it('builds the audience splits from the selected platforms’ videos alone', async () => {
    const all = await getProjectAudienceData('project-1', {});
    const instagram = await getProjectAudienceData('project-1', {
      platforms: ['instagram'],
    });

    expect(Object.keys(all!.geography!).sort()).toEqual(['BR', 'US']);
    expect(instagram!.geography).toEqual({ BR: 100 });
  });

  it('lists the selected platforms’ content only', async () => {
    const list = await getContentList('project-1', { platforms: ['tiktok'] });

    expect(list.map((item) => item.publishId)).toEqual(['p-tt']);
  });
});
