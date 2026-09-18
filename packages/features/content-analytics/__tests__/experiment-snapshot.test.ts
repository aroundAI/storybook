import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  concludeExperimentAction,
  startExperimentAction,
} from '../src/server/experiment-actions';

/**
 * The `totals` block of a snapshot, pinned before FILM-1610 touched
 * `captureSnapshot`. FILM-1610 appends a watched metric beside it; this is
 * the guard that the append moved nothing that was already there — the
 * serialised string, not a deep-equal, so a reordered or renamed key fails.
 */
const PINNED_TOTALS =
  '{"views":1500,"likes":70,"comments":12,"shares":5,"watchTimeSeconds":90000,"revenueCents":430}';

const PER_VIDEO = new Map([
  [
    'p1',
    {
      views: 1000,
      likes: 50,
      comments: 10,
      shares: 4,
      saves: 9,
      watch_time_seconds: 60000,
      revenue_cents: 300,
      subscribers_gained: 7,
    },
  ],
  [
    'p2',
    {
      views: 500,
      likes: 20,
      comments: 2,
      shares: 1,
      saves: 3,
      watch_time_seconds: 30000,
      revenue_cents: 130,
      subscribers_gained: 2,
    },
  ],
]);

const updates: Array<Record<string, unknown>> = [];

const experimentRow = {
  id: 'e1',
  account_id: 'a1',
  status: 'running',
  started_at: '2026-07-01',
  review_window_days: 60,
  metric_watched: null as string | null,
};

vi.mock('@kit/next/actions', () => ({
  enhanceAction:
    (handler: (data: unknown, user: unknown) => unknown) => (data: unknown) =>
      handler(data, { id: 'u1' }),
}));

const totalsByVideoIds = vi.fn(async () => PER_VIDEO);

vi.mock('@kit/clickhouse/server', () => ({
  queryTotalsByVideoIds: (...args: unknown[]) =>
    totalsByVideoIds(...(args as [])),
}));

vi.mock('@kit/supabase/server-client', () => ({
  getSupabaseServerClient: () => ({
    from: (table: string) => {
      if (table === 'experiment_publishes') {
        return {
          select: () => ({
            eq: async () => ({
              data: [{ publish_id: 'p1' }, { publish_id: 'p2' }],
              error: null,
            }),
          }),
        };
      }

      return {
        select: () => ({
          eq: () => ({
            single: async () => ({ data: experimentRow, error: null }),
          }),
        }),
        update: (payload: Record<string, unknown>) => {
          updates.push(payload);
          return { eq: async () => ({ error: null }) };
        },
      };
    },
  }),
}));

describe('experiment snapshot totals', () => {
  beforeEach(() => {
    updates.length = 0;
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-19T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('start writes a baseline whose totals are unchanged by FILM-1610', async () => {
    await startExperimentAction({ experimentId: 'e1' });

    const baseline = updates[0]!.baseline_metrics as {
      capturedAt: string;
      publishCount: number;
      totals: unknown;
    };

    expect(JSON.stringify(baseline.totals)).toBe(PINNED_TOTALS);
    expect(baseline.publishCount).toBe(2);
    expect(baseline.capturedAt).toBe('2026-09-19T12:00:00.000Z');
  });

  it('conclude writes a result whose totals are unchanged by FILM-1610', async () => {
    await concludeExperimentAction({
      experimentId: 'e1',
      actualOutcome: 'Retention held',
      outcomeStatus: 'confirmed',
    });

    const result = updates[0]!.result_metrics as { totals: unknown };

    expect(JSON.stringify(result.totals)).toBe(PINNED_TOTALS);
  });

  it('totals stay lifetime: the query is called with no date window', async () => {
    await startExperimentAction({ experimentId: 'e1' });

    expect(totalsByVideoIds).toHaveBeenCalledWith(['p1', 'p2']);
  });
});
