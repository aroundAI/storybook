import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ActionRefusal, unwrap } from '../src/lib/action-result';
import {
  abandonExperimentAction as abandonAction,
  concludeExperimentAction as concludeAction,
  createExperimentAction as createAction,
  deleteExperimentAction as deleteAction,
  getExperimentAction,
  startExperimentAction as startAction,
  updateExperimentAction as updateAction,
} from '../src/server/experiment-actions';

// Each mutation returns its refusal as a value (G1); the page reads it with
// `unwrap`, so these tests do too — a refusal is the Error the page shows.
const createExperimentAction = (input: Parameters<typeof createAction>[0]) =>
  unwrap(createAction(input));
const updateExperimentAction = (input: Parameters<typeof updateAction>[0]) =>
  unwrap(updateAction(input));
const startExperimentAction = (input: Parameters<typeof startAction>[0]) =>
  unwrap(startAction(input));
const concludeExperimentAction = (
  input: Parameters<typeof concludeAction>[0],
) => unwrap(concludeAction(input));
const abandonExperimentAction = (input: Parameters<typeof abandonAction>[0]) =>
  unwrap(abandonAction(input));

const logged = vi.fn();

// The date check has its own tests (caller-date.test.ts) against a fixed
// clock; here the fixtures use fixed dates, so it is a spy, and the tests
// below check each action sends the caller's date through it.
const assertCallerToday = vi.fn();

vi.mock('../src/lib/caller-date', () => ({
  assertCallerToday: (date: string) => assertCallerToday(date),
}));

vi.mock('@kit/shared/logger', () => ({
  getLogger: async () => ({ error: logged, info: vi.fn(), warn: vi.fn() }),
}));

/**
 * FILM-1610 behaviour of the experiment actions: which window each snapshot
 * measures, what "result after N days" counts, and which links are refused.
 * The totals themselves are pinned separately in experiment-snapshot.test.ts.
 */

const state: {
  experiment: {
    account_id: string;
    status: string;
    started_at: string | null;
    review_window_days: number;
    metric_watched: string | null;
  };
  linked: string[];
  /** Publish ids the account-scoped visibility check returns. */
  inAccount: string[];
  inserts: Array<{ table: string; payload: unknown }>;
  updates: Array<Record<string, unknown>>;
  /** Experiment ids deleted from analytics_experiments. */
  deletedExperiments: string[];
  /** Deletes issued directly against a link table (should be none). */
  linkTableDeletes: string[];
  rpcCalls: Array<{ name: string; args: Record<string, unknown> }>;
  /** Error the compensating delete of a just-created experiment returns. */
  cleanupError: { message: string } | null;
  /** Errors a link table returns, as PostgREST would: 200-shaped, not thrown. */
  linkReadError: { message: string } | null;
  linkWriteError: { message: string } | null;
  /** Status conditions each conditional update carried. */
  statusGuards: unknown[];
  /** Every column condition on an update, in order. */
  conditions: Array<[string, unknown]>;
  /** Whether a conditional update still finds its row (false = someone else won). */
  rowStillMatches: boolean;
} = {
  experiment: {
    account_id: 'a1',
    status: 'planned',
    started_at: null,
    review_window_days: 60,
    metric_watched: 'ctr',
  },
  linked: [],
  inAccount: [],
  inserts: [],
  updates: [],
  deletedExperiments: [],
  linkTableDeletes: [],
  rpcCalls: [],
  cleanupError: null,
  linkReadError: null,
  linkWriteError: null,
  statusGuards: [],
  conditions: [],
  rowStillMatches: true,
};

/**
 * An update builder: chainable filters, `select` for a conditional update
 * that reports the rows it matched, and awaitable for a plain update.
 */
interface UpdateBuilder extends PromiseLike<{ error: null }> {
  eq: (column: string, value: unknown) => UpdateBuilder;
  is: (column: string, value: null) => UpdateBuilder;
  in: (column: string, values: unknown[]) => UpdateBuilder;
  select: () => Promise<{ data: Array<{ id: string }>; error: null }>;
}

function updateBuilder(): UpdateBuilder {
  const builder: UpdateBuilder = {
    eq: (column, value) => {
      if (column === 'status') state.statusGuards.push(value);
      state.conditions.push([column, value]);
      return builder;
    },
    is: (column, value) => {
      state.conditions.push([column, value]);
      return builder;
    },
    in: (column, values) => {
      if (column === 'status') state.statusGuards.push(values);
      return builder;
    },
    select: async () => ({
      data: state.rowStillMatches ? [{ id: 'e1' }] : [],
      error: null,
    }),
    then: (resolve, reject) =>
      Promise.resolve({ error: null as null }).then(resolve, reject),
  };
  return builder;
}

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
    rpc: async (name: string, args: Record<string, unknown>) => {
      state.rpcCalls.push({ name, args });
      return { error: state.linkWriteError };
    },
    from: (table: string) => {
      if (table === 'experiment_publishes' || table === 'experiment_tags') {
        return {
          select: () => ({
            eq: async () =>
              state.linkReadError
                ? { data: null, error: state.linkReadError }
                : {
                    data: state.linked.map((id) => ({
                      publish_id: id,
                      publishes: { published_at: '2026-01-01T12:00:00Z' },
                    })),
                    error: null,
                  },
          }),
          delete: () => {
            state.linkTableDeletes.push(table);
            return { eq: async () => ({ error: state.linkWriteError }) };
          },
          insert: async (payload: unknown) => {
            if (state.linkWriteError) return { error: state.linkWriteError };
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
          return updateBuilder();
        },
        delete: () => ({
          // Awaitable for the cleanup after a failed link, and `select`-able
          // for the delete action, which checks that a row went (H8).
          eq: (_: string, id: string) => {
            state.deletedExperiments.push(id);
            const result = { error: state.cleanupError };
            const deleted = {
              // The delete action conditions its write on the status (KB-7).
              in: (column: string, values: unknown[]) => {
                if (column === 'status') state.statusGuards.push(values);
                return deleted;
              },
              select: async () => ({
                data: state.rowStillMatches ? [{ id }] : [],
                error: null,
              }),
              then: (
                resolve: (value: typeof result) => unknown,
                reject?: (reason: unknown) => unknown,
              ) => Promise.resolve(result).then(resolve, reject),
            };
            return deleted;
          },
        }),
      };
    },
  }),
}));

beforeEach(() => {
  state.experiment = {
    account_id: 'a1',
    status: 'planned',
    started_at: null,
    review_window_days: 60,
    metric_watched: 'ctr',
  };
  state.linked = ['p1', 'p2'];
  state.inAccount = [];
  state.inserts = [];
  state.updates = [];
  state.deletedExperiments = [];
  state.linkTableDeletes = [];
  state.rpcCalls = [];
  state.cleanupError = null;
  state.linkReadError = null;
  state.linkWriteError = null;
  state.statusGuards = [];
  state.conditions = [];
  state.rowStillMatches = true;
  resolveWatchedMetric.mockClear();
});

describe('failures are reported, never swallowed (A1, A2)', () => {
  it('a failed link write fails the create instead of reporting success', async () => {
    state.inAccount = ['p1'];
    state.linkWriteError = { message: 'insert refused' };

    await expect(
      createExperimentAction({
        accountId: 'a1',
        title: 'Links fail',
        changeDescription: 'x',
        reviewWindowDays: 60,
        publishIds: ['p1'],
        tagIds: [],
      }),
    ).rejects.toThrow('Could not log the change');
  });

  it('removes the experiment it just created when linking fails, so a retry cannot duplicate it', async () => {
    state.inAccount = ['p1'];
    state.linkWriteError = { message: 'insert refused' };

    await expect(
      createExperimentAction({
        accountId: 'a1',
        title: 'Links fail',
        changeDescription: 'x',
        reviewWindowDays: 60,
        publishIds: ['p1'],
        tagIds: [],
      }),
    ).rejects.toThrow();

    expect(state.deletedExperiments).toEqual(['e1']);
  });

  it('a failed read of the linked videos fails the detail instead of showing none', async () => {
    state.linkReadError = { message: 'read failed' };

    await expect(getExperimentAction({ experimentId: 'e1' })).rejects.toThrow(
      'read failed',
    );
  });

  it('a failed link read fails the start instead of snapshotting zero videos', async () => {
    state.linkReadError = { message: 'read failed' };

    await expect(
      startExperimentAction({ experimentId: 'e1', startedAt: '2026-07-01' }),
    ).rejects.toThrow('Could not start the change');

    expect(state.updates).toHaveLength(0);
    expect(resolveWatchedMetric).not.toHaveBeenCalled();
  });
});

describe('startExperimentAction', () => {
  it('measures the watched metric over the review window before the start', async () => {
    await startExperimentAction({
      experimentId: 'e1',
      startedAt: '2026-07-01',
    });

    expect(resolveWatchedMetric).toHaveBeenCalledWith({
      metric: 'ctr',
      accountId: 'a1',
      publishIds: ['p1', 'p2'],
      publishedAt: ['2026-01-01T12:00:00Z', '2026-01-01T12:00:00Z'],
      window: { start: '2026-05-02', end: '2026-06-30' },
    });
  });

  it('writes watched: null when the experiment watches no metric', async () => {
    state.experiment.metric_watched = null;

    await startExperimentAction({
      experimentId: 'e1',
      startedAt: '2026-07-01',
    });

    expect(resolveWatchedMetric).not.toHaveBeenCalled();
    expect(
      (state.updates[0]!.baseline_metrics as { watched: unknown }).watched,
    ).toBeNull();
  });
});

describe('concludeExperimentAction', () => {
  it('measures from the start day to the end day', async () => {
    state.experiment.status = 'running';
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
    state.experiment.status = 'running';
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
    ).rejects.toThrow(/only a running change/i);

    expect(state.updates).toHaveLength(0);
  });
});

describe('abandonExperimentAction', () => {
  it('still writes no snapshot', async () => {
    await abandonExperimentAction({
      experimentId: 'e1',
      reason: 'Channel paused',
    });

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

    expect(state.rpcCalls).toContainEqual({
      name: 'replace_experiment_publishes',
      args: { p_experiment_id: 'e1', p_publish_ids: ['p1', 'p2'] },
    });
  });

  it('refuses a video from outside the account, and creates nothing', async () => {
    state.inAccount = ['p1'];

    await expect(create(['p1', 'foreign'])).rejects.toThrow(
      'not in this account',
    );
    expect(state.inserts).toHaveLength(0);
  });

  it("checks relinked videos on update against the experiment's own account", async () => {
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
    // The creator is set by the database (analytics_experiments_set_creator).
    expect(state.inserts[0]!.payload).not.toHaveProperty('created_by');
  });

  it('stores blank optional text as null, not an empty string', async () => {
    await createExperimentAction({
      accountId: 'a1',
      title: 'Blank fields',
      changeDescription: 'Something',
      hypothesis: '',
      expectedOutcome: '   ',
      notes: '',
      reviewWindowDays: 60,
      publishIds: [],
      tagIds: [],
    });

    expect(state.inserts[0]).toMatchObject({
      payload: { hypothesis: null, expected_outcome: null, notes: null },
    });
  });
});

describe('the comparison stays comparable (B1-B3, B6)', () => {
  it('refuses to start an experiment that is already running', async () => {
    state.experiment.status = 'running';
    state.experiment.started_at = '2026-07-01';

    await expect(
      startExperimentAction({ experimentId: 'e1', startedAt: '2026-08-01' }),
    ).rejects.toThrow(/only a planned change/i);
    expect(state.updates).toHaveLength(0);
  });

  it('refuses to conclude an abandoned experiment', async () => {
    state.experiment.status = 'abandoned';
    state.experiment.started_at = '2026-07-01';

    await expect(
      concludeExperimentAction({
        experimentId: 'e1',
        actualOutcome: 'x',
        outcomeStatus: 'confirmed',
        endedAt: '2026-08-01',
      }),
    ).rejects.toThrow(/only a running change/i);
    expect(state.updates).toHaveLength(0);
  });

  it('refuses an end date before the start', async () => {
    state.experiment.status = 'running';
    state.experiment.started_at = '2026-07-01';

    await expect(
      concludeExperimentAction({
        experimentId: 'e1',
        actualOutcome: 'x',
        outcomeStatus: 'confirmed',
        endedAt: '2026-06-01',
      }),
    ).rejects.toThrow('before it started');
    expect(state.updates).toHaveLength(0);
  });

  it('refuses to change the watched metric once running', async () => {
    state.experiment.status = 'running';

    await expect(
      updateExperimentAction({
        experimentId: 'e1',
        metricWatched: 'search_share',
      }),
    ).rejects.toThrow('metricWatched');
    expect(state.updates).toHaveLength(0);
  });

  it('refuses to relink videos once running', async () => {
    state.experiment.status = 'running';
    state.inAccount = ['p9'];

    await expect(
      updateExperimentAction({ experimentId: 'e1', publishIds: ['p9'] }),
    ).rejects.toThrow('publishIds');
    expect(state.inserts).toHaveLength(0);
  });

  it('still lets a running experiment change its wording', async () => {
    state.experiment.status = 'running';

    await updateExperimentAction({ experimentId: 'e1', title: 'Renamed' });

    expect(state.updates).toEqual([{ title: 'Renamed' }]);
  });

  it('replaces links in one transaction, never as a delete then an insert (R3)', async () => {
    // Two requests left an experiment with no videos when the insert was
    // refused after the delete had landed. Duplicates are removed in SQL
    // (experiments-integrity.test.sql), in the same call.
    state.inAccount = ['p1'];

    await createExperimentAction({
      accountId: 'a1',
      title: 'Links',
      changeDescription: 'x',
      reviewWindowDays: 60,
      publishIds: ['p1', 'p1'],
      tagIds: ['t1'],
    });

    expect(state.linkTableDeletes).toEqual([]);
    expect(state.rpcCalls.map((call) => call.name)).toEqual([
      'replace_experiment_publishes',
      'replace_experiment_tags',
    ]);
  });
});

describe('updateExperimentAction normalises blank text like create (E3)', () => {
  it('stores blank optional text as null', async () => {
    await updateExperimentAction({
      experimentId: 'e1',
      hypothesis: '  ',
      expectedOutcome: '',
      notes: ' ',
    });

    expect(state.updates).toEqual([
      { hypothesis: null, expected_outcome: null, notes: null },
    ]);
  });
});

describe('lifecycle writes are atomic, and abandon has rules too (R1, R2)', () => {
  it('starts only if the row is still planned at the moment of writing', async () => {
    await startExperimentAction({
      experimentId: 'e1',
      startedAt: '2026-07-01',
    });

    expect(state.statusGuards).toEqual(['planned']);
  });

  it('reports a start that lost the race instead of overwriting the winner', async () => {
    // The read saw `planned`; by the write, another tab had started it.
    state.rowStillMatches = false;

    await expect(
      startExperimentAction({ experimentId: 'e1', startedAt: '2026-07-01' }),
    ).rejects.toThrow(/edited by someone else/i);
  });

  it('concludes only if the row is still running at the moment of writing', async () => {
    state.experiment.status = 'running';
    state.experiment.started_at = '2026-07-01';

    await concludeExperimentAction({
      experimentId: 'e1',
      actualOutcome: 'x',
      outcomeStatus: 'confirmed',
      endedAt: '2026-08-01',
    });

    expect(state.statusGuards).toEqual(['running']);
  });

  it('refuses to abandon a concluded experiment, which would erase its result', async () => {
    state.experiment.status = 'concluded';

    await expect(
      abandonExperimentAction({ experimentId: 'e1', reason: 'oops' }),
    ).rejects.toThrow(/only a planned or running change/i);
    expect(state.updates).toHaveLength(0);
  });

  it('abandons only if the row is still planned or running when written', async () => {
    state.experiment.status = 'running';

    await abandonExperimentAction({ experimentId: 'e1', reason: 'Paused' });

    expect(state.statusGuards).toEqual([['planned', 'running']]);
  });
});

describe('a failed cleanup is reported, not swallowed (R7)', () => {
  it('says the experiment may remain when removing it after a failed link also fails', async () => {
    state.inAccount = ['p1'];
    state.linkWriteError = { message: 'insert refused' };
    state.cleanupError = { message: 'delete refused' };

    await expect(
      createExperimentAction({
        accountId: 'a1',
        title: 'Orphan',
        changeDescription: 'x',
        reviewWindowDays: 60,
        publishIds: ['p1'],
        tagIds: [],
      }),
    ).rejects.toThrow(/could not be removed/);
  });
});

describe('an abandoned experiment never ends before it started (F4)', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("uses the start date when the server's UTC date is still the day before", async () => {
    // Started at 00:30 on 2 March in Kolkata; the server's UTC clock still
    // says 1 March when the experiment is abandoned a minute later.
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-01T19:01:00Z'));
    state.experiment.status = 'running';
    state.experiment.started_at = '2026-03-02';

    await abandonExperimentAction({ experimentId: 'e1', reason: 'Paused' });

    expect(state.updates[0]).toMatchObject({ ended_at: '2026-03-02' });
  });

  it("takes the caller's local end date when one is sent", async () => {
    state.experiment.status = 'running';
    state.experiment.started_at = '2026-03-02';

    await abandonExperimentAction({
      experimentId: 'e1',
      reason: 'Paused',
      endedAt: '2026-03-05',
    });

    expect(state.updates[0]).toMatchObject({ ended_at: '2026-03-05' });
  });
});

describe('refusals reach the page as values, not throws (G1)', () => {
  // A production build replaces a thrown server-action message with a
  // generic sentence, so the wording below would never reach the user if
  // it were thrown. It is returned instead.
  it('returns a refusal with its own wording', async () => {
    state.experiment.status = 'running';
    state.experiment.started_at = '2026-07-01';

    expect(
      await startAction({ experimentId: 'e1', startedAt: '2026-08-01' }),
    ).toEqual({
      ok: false,
      error: 'Only a planned change can be started; this one is running.',
    });
  });

  it('returns a failure without its database detail, and logs the detail', async () => {
    state.linkReadError = { message: 'relation "secret_table" is broken' };

    const result = await startAction({
      experimentId: 'e1',
      startedAt: '2026-07-01',
    });

    expect(result).toEqual({
      ok: false,
      error:
        'Could not start the change. Try again; if it keeps failing, reload the page.',
    });
    expect(JSON.stringify(result)).not.toContain('secret_table');
    expect(logged).toHaveBeenCalledWith(
      expect.objectContaining({ what: 'start the change' }),
      'Could not start the change',
    );
  });

  it('returns what succeeded under data', async () => {
    const result = await abandonAction({
      experimentId: 'e1',
      reason: 'Paused',
    });

    expect(result).toEqual({ ok: true, data: { success: true } });
  });
});

describe('the start freezes what its baseline measured (G5)', () => {
  it('writes only if the metric and window still read as they did', async () => {
    state.experiment.metric_watched = 'ctr';
    state.experiment.review_window_days = 45;

    await startExperimentAction({
      experimentId: 'e1',
      startedAt: '2026-07-01',
    });

    expect(state.conditions).toEqual(
      expect.arrayContaining([
        ['metric_watched', 'ctr'],
        ['review_window_days', 45],
      ]),
    );
  });

  it('matches an unwatched experiment on no metric, not on any', async () => {
    state.experiment.metric_watched = null;

    await startExperimentAction({
      experimentId: 'e1',
      startedAt: '2026-07-01',
    });

    expect(state.conditions).toContainEqual(['metric_watched', null]);
  });
});

describe('dates from the device are checked (G6)', () => {
  it('checks the start, conclusion and abandon dates the caller sent', async () => {
    assertCallerToday.mockClear();

    await startExperimentAction({
      experimentId: 'e1',
      startedAt: '2026-07-01',
    });
    expect(assertCallerToday).toHaveBeenLastCalledWith('2026-07-01');

    state.experiment.status = 'running';
    state.experiment.started_at = '2026-07-01';
    await concludeExperimentAction({
      experimentId: 'e1',
      actualOutcome: 'Rose',
      outcomeStatus: 'confirmed',
      endedAt: '2026-08-01',
    });
    expect(assertCallerToday).toHaveBeenLastCalledWith('2026-08-01');

    await abandonExperimentAction({
      experimentId: 'e1',
      reason: 'Paused',
      endedAt: '2026-08-02',
    });
    expect(assertCallerToday).toHaveBeenLastCalledWith('2026-08-02');
  });

  it('refuses before touching the experiment when the check refuses', async () => {
    assertCallerToday.mockImplementationOnce(() => {
      throw new ActionRefusal('1999-01-01 is not today');
    });

    expect(
      await startAction({ experimentId: 'e1', startedAt: '1999-01-01' }),
    ).toEqual({ ok: false, error: '1999-01-01 is not today' });
    expect(state.updates).toHaveLength(0);
  });
});

describe('a write that changed nothing is not reported as done (round 5, H8)', () => {
  // RLS refusing an update or delete matches zero rows and returns 200 with
  // no error, so success has to be read from the rows written.
  it('refuses an update that matched no row', async () => {
    state.rowStillMatches = false;

    expect(
      await updateAction({ experimentId: 'e1', title: 'Renamed' }),
    ).toEqual({
      ok: false,
      error:
        'This change was not saved: it was not found, or you cannot edit it.',
    });
  });

  it('refuses a delete that removed no row', async () => {
    state.rowStillMatches = false;

    expect(await deleteAction({ experimentId: 'e1' })).toEqual({
      ok: false,
      error:
        'Nothing was deleted: the change was not found, was started since you opened it, or you cannot delete it. Reload and try again.',
    });
  });

  it('still reports a delete that removed the row', async () => {
    expect(await deleteAction({ experimentId: 'e1' })).toEqual({
      ok: true,
      data: { success: true },
    });
  });
});

describe('a failure is logged with what it concerned (round 5, H7)', () => {
  it('logs the experiment the failed start was for', async () => {
    logged.mockClear();
    state.linkReadError = { message: 'boom' };

    await startAction({ experimentId: 'e1', startedAt: '2026-07-01' });

    expect(logged).toHaveBeenCalledWith(
      expect.objectContaining({
        what: 'start the change',
        experimentId: 'e1',
      }),
      'Could not start the change',
    );
  });
});

describe('the expectation is fixed once started (round 5, H3)', () => {
  it('refuses a new expected outcome or hypothesis on a running experiment', async () => {
    state.experiment.status = 'running';
    state.experiment.started_at = '2026-07-01';

    const result = await updateAction({
      experimentId: 'e1',
      expectedOutcome: 'Whatever happened',
      hypothesis: 'Something else',
    });

    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toContain('expectedOutcome');
    expect(!result.ok && result.error).toContain('hypothesis');
    expect(state.updates).toHaveLength(0);
  });

  it('still takes a new title on a running experiment', async () => {
    state.experiment.status = 'running';

    expect(
      await updateAction({ experimentId: 'e1', title: 'Renamed' }),
    ).toEqual({ ok: true, data: { success: true } });
  });
});

describe('delete only while planned or abandoned (KB-7, owner decision)', () => {
  it('refuses a running change as a value, and deletes nothing', async () => {
    state.experiment.status = 'running';

    expect(await deleteAction({ experimentId: 'e1' })).toEqual({
      ok: false,
      error:
        'Only a planned or abandoned change can be deleted; this one is running. Abandon it first to stop it and keep its record.',
    });
    expect(state.deletedExperiments).toEqual([]);
  });

  it('refuses a concluded change, which is the record the log keeps', async () => {
    state.experiment.status = 'concluded';

    const result = await deleteAction({ experimentId: 'e1' });

    expect(result.ok).toBe(false);
    expect(state.deletedExperiments).toEqual([]);
  });

  it('deletes only if the row is still planned or abandoned when written', async () => {
    state.experiment.status = 'abandoned';

    expect(await deleteAction({ experimentId: 'e1' })).toEqual({
      ok: true,
      data: { success: true },
    });
    expect(state.statusGuards).toEqual([['planned', 'abandoned']]);
  });
});

describe('the baseline is measured again at conclusion (KB-8, owner decision)', () => {
  beforeEach(() => {
    state.experiment.status = 'running';
    state.experiment.started_at = '2026-07-01';
  });

  it('re-measures the baseline window and keeps it beside the result', async () => {
    await concludeExperimentAction({
      experimentId: 'e1',
      actualOutcome: 'CTR rose',
      outcomeStatus: 'confirmed',
      endedAt: '2026-09-13',
    });

    // The same 60 days before the start the start measured.
    expect(resolveWatchedMetric).toHaveBeenCalledWith(
      expect.objectContaining({
        window: { start: '2026-05-02', end: '2026-06-30' },
      }),
    );

    const written = state.updates[0]!;
    expect(written.result_metrics).toHaveProperty('baselineRemeasured');
    expect(
      (written.result_metrics as { baselineRemeasured: { metric: string } })
        .baselineRemeasured.metric,
    ).toBe('ctr');
  });

  it('never rewrites the baseline taken at the start', async () => {
    await concludeExperimentAction({
      experimentId: 'e1',
      actualOutcome: 'CTR rose',
      outcomeStatus: 'confirmed',
      endedAt: '2026-09-13',
    });

    expect(state.updates[0]).not.toHaveProperty('baseline_metrics');
  });

  it('does not re-measure an age-bounded metric, which has no window', async () => {
    state.experiment.metric_watched = 'views_at_30d';

    await concludeExperimentAction({
      experimentId: 'e1',
      actualOutcome: 'Same',
      outcomeStatus: 'inconclusive',
      endedAt: '2026-09-13',
    });

    expect(resolveWatchedMetric).toHaveBeenCalledTimes(1);
    expect(state.updates[0]!.result_metrics).not.toHaveProperty(
      'baselineRemeasured',
    );
  });

  it('does not re-measure when no metric is watched', async () => {
    state.experiment.metric_watched = null;

    await concludeExperimentAction({
      experimentId: 'e1',
      actualOutcome: 'Same',
      outcomeStatus: 'inconclusive',
      endedAt: '2026-09-13',
    });

    expect(resolveWatchedMetric).not.toHaveBeenCalled();
    expect(state.updates[0]!.result_metrics).not.toHaveProperty(
      'baselineRemeasured',
    );
  });
});
