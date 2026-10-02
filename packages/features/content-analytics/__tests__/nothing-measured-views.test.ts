import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PerVideoTotals } from '@kit/clickhouse';

import {
  getContentList,
  getSeasonAnalytics,
} from '../src/server/aggregation-queries';

/**
 * KB-167: a total over nothing measured read as 0 views. A season with no
 * episodes or no publishes, and a publish with no rows yet, showed 0 —
 * "nobody watched" — where nothing was measured. Each is null now; a
 * publish whose rows counted 0 views still reads 0.
 */
const state: {
  episodes: unknown[];
  publishes: unknown[];
  totals: Map<string, PerVideoTotals>;
} = { episodes: [], publishes: [], totals: new Map() };

const PUBLISH = {
  id: 'yt',
  platform: 'youtube',
  episode_id: 'ep-1',
  title: 'YouTube cut',
  published_at: '2026-09-01T00:00:00Z',
  episodes: { id: 'ep-1', title: 'Episode 1', thumbnail_url: null },
};

function builder(table: string) {
  const rows =
    table === 'publishes'
      ? state.publishes
      : table === 'episodes'
        ? state.episodes
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
    single: async () => ({
      data: { id: 'season-1', number: 1, name: 'Season 1' },
      error: null,
    }),
    maybeSingle: async () => ({
      data: { id: 'project-1', account_id: 'account-1' },
      error: null,
    }),
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

function measuredZero(): PerVideoTotals {
  return {
    views: 0,
    likes: 0,
    comments: 0,
    shares: 0,
    saves: 0,
    watch_time_seconds: 0,
    revenue_cents: 0,
    subscribers_gained: 0,
    measured: {
      saves: false,
      watch_time_seconds: true,
      subscribers_gained: true,
    },
  };
}

beforeEach(() => {
  state.episodes = [{ id: 'ep-1', title: 'Episode 1', number: 1 }];
  state.publishes = [PUBLISH];
  state.totals = new Map();
});

describe('season views, when nothing was measured (KB-167)', () => {
  it('a season with no episodes has no views, not 0', async () => {
    state.episodes = [];

    expect((await getSeasonAnalytics('season-1'))?.totalViews).toBeNull();
  });

  it('a season with no publishes has no views, nor has each episode', async () => {
    state.publishes = [];

    const season = await getSeasonAnalytics('season-1');

    expect(season?.totalViews).toBeNull();
    expect(season?.episodes[0]?.views).toBeNull();
    expect(season?.episodes[0]?.engagement).toBeNull();
  });

  it('a season whose publish counted 0 views reads 0', async () => {
    state.totals.set('yt', measuredZero());

    expect((await getSeasonAnalytics('season-1'))?.totalViews).toBe(0);
  });
});

describe('the content list, for a publish with no rows yet (KB-167)', () => {
  it('gives it no views and no engagement rate, not 0', async () => {
    const [item] = await getContentList('project-1');

    expect(item?.views).toBeNull();
    expect(item?.engagementRate).toBeNull();
  });

  it('keeps a measured 0', async () => {
    state.totals.set('yt', measuredZero());

    const [item] = await getContentList('project-1');

    expect(item?.views).toBe(0);
  });
});
