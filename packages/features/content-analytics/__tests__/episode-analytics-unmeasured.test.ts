import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PerVideoTotals } from '@kit/clickhouse';

import { getEpisodeAnalytics } from '../src/server/aggregation-queries';

/**
 * KB-149: TikTok reports no watch time or follower gain, and Instagram no
 * follower gain, so ClickHouse holds NULL for them. The episode totals summed those
 * NULLs as 0, and the page showed "Watch Time 0m" and "Subscribers 0" —
 * a measurement the data does not support. Null is "cannot measure".
 */
const state: {
  publishes: { id: string; platform: string }[];
  totals: Map<string, PerVideoTotals>;
} = { publishes: [], totals: new Map() };

function builder(table: string) {
  const chain = {
    select: () => chain,
    eq: () => chain,
    single: async () => ({
      data: {
        id: 'episode-1',
        title: 'Episode',
        number: 1,
        season_id: null,
        project_id: 'project-1',
      },
      error: null,
    }),
    then: (resolve: (value: unknown) => void) =>
      resolve({
        data: table === 'publishes' ? state.publishes : [],
        error: null,
      }),
  };

  return chain;
}

vi.mock('@kit/supabase/server-client', () => ({
  getSupabaseServerClient: () => ({ from: builder }),
}));

vi.mock('@kit/clickhouse/server', () => ({
  queryAudienceRows: async () => [],
  queryDailyTimeSeries: async () => [],
  queryDailyTimeSeriesByPlatform: async () => [],
  queryPlatformBreakdown: async () => [],
  queryTotalsByVideoIds: async () => state.totals,
}));

/** ClickHouse's shape: a sum over only NULLs comes back as 0, unmeasured. */
function stats(
  platform: 'youtube' | 'tiktok',
  figures: { watch: number; subscribers: number; saves: number },
): PerVideoTotals {
  const youtube = platform === 'youtube';

  return {
    views: 100,
    likes: 10,
    comments: 2,
    shares: 1,
    revenue_cents: 0,
    watch_time_seconds: youtube ? figures.watch : 0,
    subscribers_gained: youtube ? figures.subscribers : 0,
    saves: youtube ? 0 : figures.saves,
    measured: {
      saves: !youtube,
      watch_time_seconds: youtube,
      subscribers_gained: youtube,
    },
  };
}

beforeEach(() => {
  state.publishes = [];
  state.totals = new Map();
});

describe('episode analytics, for figures a platform does not measure (KB-149)', () => {
  it('gives no watch time, follower gain or saves for a TikTok-only episode, not 0', async () => {
    state.publishes = [{ id: 'tt', platform: 'tiktok' }];
    state.totals.set('tt', {
      ...stats('tiktok', { watch: 0, subscribers: 0, saves: 7 }),
      measured: {
        saves: false,
        watch_time_seconds: false,
        subscribers_gained: false,
      },
    });

    const analytics = await getEpisodeAnalytics('episode-1');

    expect(analytics?.avgWatchTimeSeconds).toBeNull();
    expect(analytics?.subscribersGained).toBeNull();
    expect(analytics?.totalSaves).toBeNull();
    expect(analytics?.platformBreakdown[0]?.saves).toBeNull();
    // What TikTok does measure still counts.
    expect(analytics?.totalViews).toBe(100);
  });

  it('keeps a YouTube episode’s measured watch time and follower gain', async () => {
    state.publishes = [{ id: 'yt', platform: 'youtube' }];
    state.totals.set(
      'yt',
      stats('youtube', { watch: 600, subscribers: 4, saves: 0 }),
    );

    const analytics = await getEpisodeAnalytics('episode-1');

    expect(analytics?.avgWatchTimeSeconds).toBe(600);
    expect(analytics?.subscribersGained).toBe(4);
  });

  it('averages watch time over the publishes that measured it, not every publish', async () => {
    // Dividing by both publishes would halve YouTube's figure: the TikTok
    // publish would count as a video nobody watched.
    state.publishes = [
      { id: 'yt', platform: 'youtube' },
      { id: 'tt', platform: 'tiktok' },
    ];
    state.totals.set(
      'yt',
      stats('youtube', { watch: 600, subscribers: 4, saves: 0 }),
    );
    state.totals.set(
      'tt',
      stats('tiktok', { watch: 0, subscribers: 0, saves: 7 }),
    );

    const analytics = await getEpisodeAnalytics('episode-1');

    expect(analytics?.avgWatchTimeSeconds).toBe(600);
    expect(analytics?.subscribersGained).toBe(4);
    expect(analytics?.totalSaves).toBe(7);
  });
});
