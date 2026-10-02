import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PerVideoTotals } from '@kit/clickhouse';

import { getContentTypeComparison } from '../src/server/language-analytics';

/**
 * KB-162: a format family's follower gain added each video's as a number,
 * so TikTok and Instagram videos — which report none (KB-114) — counted as
 * 0 followers gained, and a family of only them read "0". It sums only what
 * was measured, and is null when nothing was.
 */
const state: { totals: Map<string, PerVideoTotals> } = { totals: new Map() };

function builder(row: unknown) {
  const chain = {
    select: () => chain,
    eq: () => chain,
    in: () => chain,
    order: () => chain,
    range: async () => ({ data: [], error: null }),
    maybeSingle: async () => ({ data: row, error: null }),
  };

  return chain;
}

vi.mock('@kit/supabase/server-client', () => ({
  getSupabaseServerClient: () => ({
    from: () => builder({ account_id: 'account-1' }),
    rpc: async () => ({ data: true, error: null }),
  }),
}));

vi.mock('@kit/clickhouse/server', async () => {
  const pure =
    await vi.importActual<typeof import('@kit/clickhouse')>('@kit/clickhouse');

  return {
    fromDimLanguage: pure.fromDimLanguage,
    // Every video a vertical short, so they land in one family.
    queryVideoLanguages: async () =>
      [...state.totals.keys()].map((videoId) => ({
        videoId,
        episodeId: `episode-${videoId}`,
        platform: videoId.startsWith('yt') ? 'youtube' : 'tiktok',
        contentType: 'short',
        title: videoId,
        language: 'en',
        channelLanguage: 'en',
        assetDurationSeconds: 45,
      })),
    queryTotalsByVideoIds: async () => state.totals,
  };
});

function video(subscribers: number | null): PerVideoTotals {
  return {
    views: 100,
    likes: 1,
    comments: 0,
    shares: 0,
    saves: 0,
    watch_time_seconds: 0,
    revenue_cents: 0,
    // ClickHouse's shape: an unmeasured sum reads 0, and the flag says so.
    subscribers_gained: subscribers ?? 0,
    measured: {
      shares: true,
      saves: false,
      watch_time_seconds: false,
      subscribers_gained: subscribers !== null,
    },
  };
}

beforeEach(() => {
  state.totals = new Map();
});

describe('a format family’s follower gain, where no video measured it (KB-162)', () => {
  it('is null for TikTok shorts alone, not 0', async () => {
    state.totals.set('tt-1', video(null));
    state.totals.set('tt-2', video(null));

    const [family] = (await getContentTypeComparison('project-1')).families;

    expect(family?.subscribersGained).toBeNull();
    expect(family?.views).toBe(200);
  });

  it('sums only the follower gain that was measured, and keeps a measured 0', async () => {
    state.totals.set('yt-1', video(4));
    state.totals.set('yt-0', video(0));
    state.totals.set('tt-1', video(null));

    const [family] = (await getContentTypeComparison('project-1')).families;

    expect(family?.subscribersGained).toBe(4);
  });
});
