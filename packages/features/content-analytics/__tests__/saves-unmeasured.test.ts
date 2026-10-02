import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PerVideoTotals } from '@kit/clickhouse';

import {
  getContentList,
  getProjectAnalytics,
  getSeasonAnalytics,
} from '../src/server/aggregation-queries';

/**
 * KB-162: a season's saves, the project's saves summed from them, and the
 * content list's saves added each publish's saves as a number, so a TikTok
 * publish — which reports none (KB-114) — counted as 0 saves and an
 * all-TikTok season read "0 saves". Each now sums only what was measured,
 * and is null when nothing was.
 */
const state: { totals: Map<string, PerVideoTotals> } = { totals: new Map() };

const PUBLISHES = [
  {
    id: 'tt',
    platform: 'tiktok',
    episode_id: 'ep-1',
    title: 'TikTok cut',
    published_at: '2026-09-01T00:00:00Z',
    episodes: { id: 'ep-1', title: 'Episode 1', thumbnail_url: null },
  },
  {
    id: 'ig',
    platform: 'instagram',
    episode_id: 'ep-1',
    title: 'Reel',
    published_at: '2026-09-02T00:00:00Z',
    episodes: { id: 'ep-1', title: 'Episode 1', thumbnail_url: null },
  },
];

function builder(table: string) {
  const rows =
    table === 'publishes'
      ? PUBLISHES
      : table === 'episodes'
        ? [{ id: 'ep-1', title: 'Episode 1', number: 1 }]
        : table === 'seasons'
          ? [{ id: 'season-1', number: 1, name: 'Season 1' }]
          : [];
  const row =
    table === 'projects'
      ? { id: 'project-1', name: 'Project', account_id: 'account-1' }
      : { id: 'season-1', number: 1, name: 'Season 1' };

  const chain = {
    select: () => chain,
    eq: () => chain,
    is: () => chain,
    in: () => chain,
    not: () => chain,
    gte: () => chain,
    lte: () => chain,
    order: () => chain,
    // One page, then empty: the paged readers stop on a short page.
    range: async (from: number) => ({
      data: from === 0 ? rows : [],
      error: null,
    }),
    single: async () => ({ data: row, error: null }),
    maybeSingle: async () => ({ data: row, error: null }),
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
}));

function stats(saves: number | null): PerVideoTotals {
  return {
    views: 100,
    likes: 10,
    comments: 1,
    shares: 1,
    // ClickHouse's shape: an unmeasured sum reads 0, and the flag says so.
    saves: saves ?? 0,
    watch_time_seconds: 0,
    revenue_cents: 0,
    subscribers_gained: 0,
    measured: {
      shares: true,
      saves: saves !== null,
      watch_time_seconds: false,
      subscribers_gained: false,
    },
  };
}

beforeEach(() => {
  state.totals = new Map();
});

describe('season, project and content-list saves, where no platform measured them (KB-162)', () => {
  it('gives no saves for TikTok publishes alone, not 0', async () => {
    state.totals.set('tt', stats(null));

    expect((await getSeasonAnalytics('season-1'))?.totalSaves).toBeNull();
    expect((await getProjectAnalytics('project-1'))?.totalSaves).toBeNull();
    expect(
      (await getContentList('project-1')).find(
        (item) => item.publishId === 'tt',
      )?.saves,
    ).toBeNull();
  });

  it('sums only the saves that were measured', async () => {
    state.totals.set('tt', stats(null));
    state.totals.set('ig', stats(3));

    expect((await getSeasonAnalytics('season-1'))?.totalSaves).toBe(3);
    expect((await getProjectAnalytics('project-1'))?.totalSaves).toBe(3);

    const list = await getContentList('project-1');
    expect(list.find((item) => item.publishId === 'ig')?.saves).toBe(3);
    expect(list.find((item) => item.publishId === 'tt')?.saves).toBeNull();
  });

  it('keeps a measured 0', async () => {
    state.totals.set('ig', stats(0));

    expect((await getSeasonAnalytics('season-1'))?.totalSaves).toBe(0);
  });
});
