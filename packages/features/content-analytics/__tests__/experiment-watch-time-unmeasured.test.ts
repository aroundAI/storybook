import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PerVideoTotals } from '@kit/clickhouse';

import { startExperimentAction } from '../src/server/experiment-actions';

/**
 * KB-162: an experiment's snapshot added each video's watch time as a
 * number, so a TikTok video — which reports none (KB-114) — counted as 0
 * seconds watched, and an all-TikTok experiment's baseline said nobody
 * watched. The snapshot sums only measured watch time, and is null when
 * none was measured.
 */
const state: { perVideo: Map<string, PerVideoTotals> } = {
  perVideo: new Map(),
};

const updates: Array<Record<string, unknown>> = [];

vi.mock('@kit/next/actions', () => ({
  enhanceAction:
    (handler: (data: unknown, user: unknown) => unknown) => (data: unknown) =>
      handler(data, { id: 'u1' }),
}));

vi.mock('@kit/clickhouse/server', () => ({
  queryTotalsByVideoIds: async () => state.perVideo,
}));

vi.mock('@kit/supabase/server-client', () => ({
  getSupabaseServerClient: () => ({
    from: (table: string) => {
      if (table === 'experiment_publishes') {
        return {
          select: () => ({
            eq: async () => ({
              data: [...state.perVideo.keys()].map((id) => ({
                publish_id: id,
              })),
              error: null,
            }),
          }),
        };
      }

      return {
        select: () => ({
          eq: () => ({
            single: async () => ({
              data: {
                id: 'e1',
                account_id: 'a1',
                status: 'planned',
                started_at: null,
                review_window_days: 60,
                metric_watched: null,
              },
              error: null,
            }),
          }),
        }),
        update: (payload: Record<string, unknown>) => {
          updates.push(payload);
          const matched = {
            eq: () => matched,
            in: () => matched,
            is: () => matched,
            select: async () => ({ data: [{ id: 'e1' }], error: null }),
          };
          return matched;
        },
      };
    },
  }),
}));

function video(watch: number | null): PerVideoTotals {
  return {
    views: 100,
    likes: 1,
    comments: 0,
    shares: 0,
    saves: 0,
    // ClickHouse's shape: an unmeasured sum reads 0, and the flag says so.
    watch_time_seconds: watch ?? 0,
    revenue_cents: 0,
    subscribers_gained: 0,
    measured: {
      shares: true,
      saves: false,
      watch_time_seconds: watch !== null,
      subscribers_gained: false,
    },
  };
}

async function baselineWatchTime() {
  await startExperimentAction({ experimentId: 'e1' });
  const baseline = updates[0]!.baseline_metrics as {
    totals: { watchTimeSeconds: number | null; views: number };
  };

  return baseline.totals;
}

beforeEach(() => {
  updates.length = 0;
  state.perVideo = new Map();
});

describe('an experiment snapshot’s watch time, where no video measured it (KB-162)', () => {
  it('is null for TikTok videos alone, not 0', async () => {
    state.perVideo.set('tt-1', video(null));
    state.perVideo.set('tt-2', video(null));

    const totals = await baselineWatchTime();

    expect(totals.watchTimeSeconds).toBeNull();
    expect(totals.views).toBe(200);
  });

  it('sums only the watch time that was measured, and keeps a measured 0', async () => {
    state.perVideo.set('yt', video(600));
    state.perVideo.set('tt', video(null));
    state.perVideo.set('yt-0', video(0));

    expect((await baselineWatchTime()).watchTimeSeconds).toBe(600);
  });
});
