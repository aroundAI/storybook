import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PerVideoTotals } from '@kit/clickhouse';

import {
  getEpisodeAnalytics,
  getProjectAnalytics,
  getSeasonAnalytics,
} from '../src/server/aggregation-queries';

/**
 * KB-192: with no metric rows, the analytics page read Likes, Comments and
 * Shares as 0 beside a Views card that said Not measured. Each total was
 * summed from 0 while views was summed from null. Every count now follows
 * views: null until a row is read, a measured 0 still 0.
 */
const state: {
  publishes: unknown[];
  totals: Map<string, PerVideoTotals>;
} = { publishes: [], totals: new Map() };

const PUBLISH = {
  id: 'yt',
  platform: 'youtube',
  episode_id: 'ep-1',
  published_at: '2026-09-01T00:00:00Z',
};

const ROWS: Record<string, () => unknown[]> = {
  publishes: () => state.publishes,
  episodes: () => [{ id: 'ep-1', title: 'Episode 1', number: 1 }],
  seasons: () => [{ id: 'season-1', number: 1, name: 'Season 1' }],
};

function builder(table: string) {
  const chain = {
    select: () => chain,
    eq: () => chain,
    is: () => chain,
    in: () => chain,
    order: () => chain,
    range: async (from: number) => ({
      data: from === 0 ? (ROWS[table]?.() ?? []) : [],
      error: null,
    }),
    single: async () => ({
      data: {
        id: 'row-1',
        number: 1,
        name: 'Row 1',
        title: 'Episode 1',
        project_id: 'project-1',
      },
      error: null,
    }),
    // getEpisodeAnalytics reads its publishes without paging.
    then: (resolve: (value: unknown) => void) =>
      resolve({ data: state.publishes, error: null }),
  };

  return chain;
}

vi.mock('@kit/supabase/server-client', () => ({
  getSupabaseServerClient: () => ({ from: builder }),
}));

vi.mock('../src/server/scope-access', () => ({
  assertProjectAccess: async () => undefined,
}));

vi.mock('@kit/clickhouse/server', () => ({
  queryAudienceRows: async () => [],
  queryDailyTimeSeries: async () => [],
  queryDailyTimeSeriesByPlatform: async () => [],
  queryPlatformBreakdown: async () => [],
  queryTotalsByVideoIds: async () => state.totals,
}));

function measured(counts: {
  likes: number;
  comments: number;
  shares: number;
  sharesMeasured?: boolean;
}): PerVideoTotals {
  return {
    views: 10,
    likes: counts.likes,
    comments: counts.comments,
    shares: counts.shares,
    saves: 0,
    watch_time_seconds: 0,
    revenue_cents: 0,
    subscribers_gained: 0,
    measured: {
      saves: false,
      watch_time_seconds: true,
      subscribers_gained: true,
      shares: counts.sharesMeasured ?? true,
    },
  };
}

const counts = (scope: {
  totalLikes: number | null;
  totalComments: number | null;
  totalShares: number | null;
}) => ({
  likes: scope.totalLikes,
  comments: scope.totalComments,
  shares: scope.totalShares,
});

const NOT_MEASURED = { likes: null, comments: null, shares: null };

const READERS = {
  episode: () => getEpisodeAnalytics('ep-1'),
  season: () => getSeasonAnalytics('season-1'),
  project: () => getProjectAnalytics('project-1'),
};

beforeEach(() => {
  state.publishes = [PUBLISH];
  state.totals = new Map();
});

describe.each(Object.entries(READERS))(
  'the %s totals, for likes, comments and shares (KB-192)',
  (_scope, read) => {
    it('are not measured, not 0, when the publish has no rows', async () => {
      const scope = await read();

      expect(scope && counts(scope)).toEqual(NOT_MEASURED);
    });

    it('are not measured, not 0, when nothing is published', async () => {
      state.publishes = [];

      const scope = await read();

      expect(scope && counts(scope)).toEqual(NOT_MEASURED);
    });

    it('keep a measured 0 as 0', async () => {
      state.totals.set('yt', measured({ likes: 0, comments: 0, shares: 0 }));

      const scope = await read();

      expect(scope && counts(scope)).toEqual({
        likes: 0,
        comments: 0,
        shares: 0,
      });
    });

    it('are the figures a row measured', async () => {
      state.totals.set('yt', measured({ likes: 12, comments: 3, shares: 2 }));

      const scope = await read();

      expect(scope && counts(scope)).toEqual({
        likes: 12,
        comments: 3,
        shares: 2,
      });
    });

    it('leave shares not measured where only X was read (FILM-1727)', async () => {
      state.totals.set(
        'yt',
        measured({ likes: 4, comments: 1, shares: 0, sharesMeasured: false }),
      );

      const scope = await read();

      expect(scope && counts(scope)).toEqual({
        likes: 4,
        comments: 1,
        shares: null,
      });
    });
  },
);
