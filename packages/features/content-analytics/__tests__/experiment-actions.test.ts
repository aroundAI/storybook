import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  abandonExperimentAction,
  concludeExperimentAction,
  createExperimentAction,
  startExperimentAction,
  updateExperimentAction,
} from '../src/server/experiment-actions';

/**
 * FILM-1610 behaviour of the experiment actions: which window each snapshot
 * measures, what "result after N days" counts, and which links are refused.
 * The totals themselves are pinned separately in experiment-snapshot.test.ts.
 */

const state: {
  experiment: {
    account_id: string;
    started_at: string | null;
    review_window_days: number;
    metric_watched: string | null;
  };
  linked: string[];
  /** Publish ids the account-scoped visibility check returns. */
  inAccount: string[];
  inserts: Array<{ table: string; payload: unknown }>;
  updates: Array<Record<string, unknown>>;
} = {
  experiment: {
    account_id: 'a1',
    started_at: null,
    review_window_days: 60,
    metric_watched: 'ctr',
  },
  linked: [],
  inAccount: [],
  inserts: [],
  updates: [],
};

vi.mock('@kit/next/actions', () => ({
  enhanceAction:
    (handler: (data: unknown, user: unknown) => unknown) => (data: unknown) =>
      handler(data, { id: 'u1' }),
}));

vi.mock('@kit/clickhouse/server', () => ({
  queryTotalsByVideoIds: async () => new Map(),
}));

const resolveWatchedMetric = vi.fn(async (input: { metric: string }) => ({
  status: 'unmeasured' as const,
  metric: input.metric,
  reason: 'no_data' as const,
  window: null,
}));

vi.mock('../src/server/watched-metric-snapshot', () => ({
  resolveWatchedMetric: (input: { metric: string }) =>
    resolveWatchedMetric(input),
}));

vi.mock('@kit/supabase/server-client', () => ({
  getSupabaseServerClient: () => ({
    from: (table: string) => {
      if (table === 'experiment_publishes' || table === 'experiment_tags') {
        return {
          select: () => ({
            eq: async () => ({
              data: state.linked.map((id) => ({ publish_id: id })),
              error: null,
            }),
          }),
          delete: () => ({ eq: async () => ({ error: null }) }),
          insert: async (payload: unknown) => {
            state.inserts.push({ table, payload });
            return { error: null };
          },
        };
      }

      if (table === 'publishes') {
        return {
          select: () => ({
            in: (_: string, ids: string[]) => ({
              eq: async () => ({
                data: ids
                  .filter((id) => state.inAccount.includes(id))
                  .map((id) => ({ id })),
                error: null,
              }),
            }),
          }),
        };
      }

      return {
        select: () => ({
          eq: () => ({
            single: async () => ({ data: state.experiment, error: null }),
          }),
        }),
        insert: (payload: unknown) => {
          state.inserts.push({ table, payload });
          return {
            select: () => ({
              single: async () => ({ data: { id: 'e1' }, error: null }),
            }),
          };
        },
        update: (payload: Record<string, unknown>) => {
          state.updates.push(payload);
          return { eq: async () => ({ error: null }) };
        },
      };
    },
  }),
}));

beforeEach(() => {
  state.experiment = {
    account_id: 'a1',
    started_at: null,
    review_window_days: 60,
    metric_watched: 'ctr',
  };
  state.linked = ['p1', 'p2'];
  state.inAccount = [];
  state.inserts = [];
  state.updates = [];
  resolveWatchedMetric.mockClear();
});

describe('startExperimentAction', () => {
  it('measures the watched metric over the review window before the start', async () => {
    await startExperimentAction({ experimentId: 'e1', startedAt: '2026-07-01' });

    expect(resolveWatchedMetric).toHaveBeenCalledWith({
      metric: 'ctr',
      accountId: 'a1',
      publishIds: ['p1', 'p2'],
      window: { start: '2026-05-02', end: '2026-06-30' },
    });
  });

  it('writes watched: null when the experiment watches no metric', async () => {
    state.experiment.metric_watched = null;

    await startExperimentAction({ experimentId: 'e1', startedAt: '2026-07-01' });

    expect(resolveWatchedMetric).not.toHaveBeenCalled();
    expect(
      (state.updates[0]!.baseline_metrics as { watched: unknown }).watched,
    ).toBeNull();
  });
});

describe('concludeExperimentAction', () => {
  it('measures from the start day to the end day', async () => {
    state.experiment.started_at = '2026-07-01';

    await concludeExperimentAction({
      experimentId: 'e1',
      actualOutcome: 'CTR rose',
      outcomeStatus: 'confirmed',
      endedAt: '2026-09-13',
    });

    expect(resolveWatchedMetric).toHaveBeenCalledWith(
      expect.objectContaining({
        window: { start: '2026-07-01', end: '2026-09-13' },
      }),
    );
  });

  it('records the days that elapsed, not the 60 that were planned', async () => {
    state.experiment.started_at = '2026-07-01';

    await concludeExperimentAction({
      experimentId: 'e1',
      actualOutcome: 'CTR rose',
      outcomeStatus: 'confirmed',
      endedAt: '2026-09-13',
    });

    expect(
      (state.updates[0]!.result_metrics as { resultAfterDays: number })
        .resultAfterDays,
    ).toBe(74);
  });

  it('refuses to conclude an experiment that never started', async () => {
    await expect(
      concludeExperimentAction({
        experimentId: 'e1',
        actualOutcome: 'n/a',
        outcomeStatus: 'inconclusive',
      }),
    ).rejects.toThrow('must be started');

    expect(state.updates).toHaveLength(0);
  });
});

describe('abandonExperimentAction', () => {
  it('still writes no snapshot', async () => {
    await abandonExperimentAction({ experimentId: 'e1', reason: 'Channel paused' });

    expect(state.updates[0]).not.toHaveProperty('result_metrics');
    expect(state.updates[0]).not.toHaveProperty('baseline_metrics');
    expect(resolveWatchedMetric).not.toHaveBeenCalled();
  });
});

describe('linking videos', () => {
  const create = (publishIds: string[]) =>
    createExperimentAction({
      accountId: 'a1',
      title: 'Thumbnail test',
      changeDescription: 'Faces on thumbnails',
      reviewWindowDays: 30,
      metricWatched: 'ctr',
      publishIds,
      tagIds: [],
    });

  it('links videos that belong to the account', async () => {
    state.inAccount = ['p1', 'p2'];

    await create(['p1', 'p2']);

    expect(
      state.inserts.find((insert) => insert.table === 'experiment_publishes'),
    ).toBeDefined();
  });

  it('refuses a video from outside the account, and creates nothing', async () => {
    state.inAccount = ['p1'];

    await expect(create(['p1', 'foreign'])).rejects.toThrow(
      'not in this account',
    );
    expect(state.inserts).toHaveLength(0);
  });

  it('checks relinked videos on update against the experiment\'s own account', async () => {
    state.inAccount = [];

    await expect(
      updateExperimentAction({ experimentId: 'e1', publishIds: ['foreign'] }),
    ).rejects.toThrow('not in this account');
    expect(state.inserts).toHaveLength(0);
  });

  it('writes the FILM-1610 fields on create', async () => {
    state.inAccount = ['p1'];

    await create(['p1']);

    expect(state.inserts[0]).toMatchObject({
      table: 'analytics_experiments',
      payload: {
        metric_watched: 'ctr',
        review_window_days: 30,
        category: null,
        notes: null,
        connection_id: null,
      },
    });
  });
});
