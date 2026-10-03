import { beforeEach, describe, expect, it, vi } from 'vitest';

import { GENERATION_JOB_TYPES } from '@kit/prompt-engine/generation-job-types';

/**
 * KB-174: every bulk action that records generation_jobs rows writes them
 * before it queues, with a job_type the CHECK allows, and a row that cannot
 * be written fails its episodes as a value instead of being logged at warn
 * while the SQS job goes out anyway. Reproduced for batchCreateAssetsAction:
 * its 'asset_creation' row was refused by generation_jobs_job_type_check and
 * the UI, which reads these rows for progress and status, saw nothing.
 */

const ACCOUNT = '11111111-1111-4111-8111-111111111111';
const PROJECT = '22222222-2222-4222-8222-222222222222';
const EPISODE = '33333333-3333-4333-8333-333333333333';
const CALLER = '77777777-7777-4777-8777-777777777777';

type Row = Record<string, unknown>;

const state = vi.hoisted(() => ({
  readable: {} as Record<string, Row[]>,
  /** What `generation_jobs.insert` answers. */
  insertError: null as { code: string; message: string } | null,
  inserted: [] as Row[],
  /** The order of the two side effects, as the action performed them. */
  sequence: [] as Array<'insert' | 'send'>,
  sent: [] as Array<{ jobType: string; payload: Row }>,
}));

vi.mock('@kit/next/actions', () => ({
  enhanceAction:
    (
      handler: (data: unknown) => unknown,
      options?: { schema?: { parse: (data: unknown) => unknown } },
    ) =>
    (data: unknown) =>
      handler(options?.schema ? options.schema.parse(data) : data),
  checkRateLimit: () => undefined,
}));

vi.mock('@kit/shared/logger', () => ({
  getLogger: async () => ({
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
  }),
}));

vi.mock('@kit/supabase/require-user', () => ({
  requireUser: async () => ({ data: { id: CALLER }, error: null }),
}));

// The action opens a run for the job (FILM-1903), records the row with its
// id, then dispatches: 'send' is the dispatch, after the row
vi.mock('@kit/ai-gateway', () => ({
  openRunForJob: async (job: { jobType: string; payload: Row }) => ({
    id: 'run-under-test',
    mode: 'server',
    dispatch: async () => {
      state.sequence.push('send');
      state.sent.push({ jobType: job.jobType, payload: job.payload });
    },
  }),
}));

function query(table: string) {
  let rows: Row[] = [...(state.readable[table] ?? [])];
  let result: { data: unknown; error: unknown } | null = null;

  const builder = {
    select: () => builder,
    eq: (column: string, value: unknown) => {
      rows = rows.filter((row) => row[column] === value);
      return builder;
    },
    is: () => builder,
    in: (column: string, values: unknown[]) => {
      rows = rows.filter((row) => values.includes(row[column]));
      return builder;
    },
    order: () => builder,
    limit: (n: number) => {
      rows = rows.slice(0, n);
      return builder;
    },
    range: (from: number, to: number) => {
      rows = rows.slice(from, to + 1);
      return builder;
    },
    maybeSingle: async () => ({ data: rows[0] ?? null, error: null }),
    insert: (entries: Row[]) => {
      if (table !== 'generation_jobs') {
        throw new Error(`unexpected insert into ${table}`);
      }
      state.sequence.push('insert');
      if (!state.insertError) state.inserted.push(...entries);
      result = { data: null, error: state.insertError };
      return builder;
    },
    then: <R>(resolve: (value: { data: unknown; error: unknown }) => R) =>
      Promise.resolve(result ?? { data: rows, error: null }).then(resolve),
  };

  return builder;
}

vi.mock('@kit/supabase/server-client', () => ({
  getSupabaseServerClient: () => ({
    from: query,
    rpc: async (fn: string, args: { target_project_id: string }) =>
      fn === 'can_write_project'
        ? { data: args.target_project_id === PROJECT, error: null }
        : { data: null, error: { message: `unexpected rpc ${fn}` } },
    auth: { getUser: async () => ({ data: { user: { id: CALLER } } }) },
  }),
}));

beforeEach(() => {
  state.readable = {
    episodes: [
      {
        id: EPISODE,
        project_id: PROJECT,
        season_id: null,
        number: 1,
        status: 'story',
        version: 1,
        title: 'Episode',
        story_data: { fullStory: 'A story long enough.' },
        screenplay_data: { scenes: [{ sceneNumber: 1 }] },
        project: { id: PROJECT, account_id: ACCOUNT, metadata: {} },
      },
    ],
    projects: [{ id: PROJECT, account_id: ACCOUNT }],
    accounts_memberships: [{ user_id: CALLER, account_id: ACCOUNT }],
  };
  state.insertError = null;
  state.inserted = [];
  state.sequence = [];
  state.sent = [];
});

const REFUSED = {
  code: '23514',
  message:
    'new row for relation "generation_jobs" violates check constraint "generation_jobs_job_type_check"',
};

type Result = {
  queued: number;
  failed: Array<{ episodeId: string; error: string }>;
};

const actions: Array<{ name: string; run: () => Promise<Result> }> = [
  {
    name: 'batchGenerateStoriesAction',
    run: async () =>
      (await import('../src/server/bulk-actions')).batchGenerateStoriesAction({
        episodes: [
          { episodeId: EPISODE, version: 1, title: 'T', logline: 'L' },
        ],
      }),
  },
  {
    name: 'batchConvertScreenplaysAction',
    run: async () =>
      (
        await import('../src/server/bulk-actions')
      ).batchConvertScreenplaysAction({ episodes: [{ episodeId: EPISODE }] }),
  },
  {
    name: 'batchGenerateShotsAction',
    run: async () =>
      (await import('../src/server/bulk-actions')).batchGenerateShotsAction({
        episodes: [{ episodeId: EPISODE }],
      }),
  },
  {
    name: 'batchCreateAssetsAction',
    run: async () =>
      (await import('../src/server/bulk-actions')).batchCreateAssetsAction({
        projectId: PROJECT,
        episodes: [{ episodeId: EPISODE }],
      }),
  },
];

describe.each(actions)('$name', ({ run }) => {
  it('records a job row the CHECK allows, then queues', async () => {
    const result = await run();

    expect(result).toMatchObject({ queued: 1, failed: [] });
    expect(state.inserted).toHaveLength(1);
    expect(GENERATION_JOB_TYPES).toContain(state.inserted[0]!.job_type);
    expect(state.inserted[0]).toMatchObject({
      reference_type: 'episode',
      reference_id: EPISODE,
      status: 'queued',
      account_id: ACCOUNT,
      project_id: PROJECT,
    });
    // The worker updates the row by (episode, job_type, status = queued):
    // it must exist before the message can be consumed.
    expect(state.sequence).toEqual(['insert', 'send']);
  });

  it('fails the episode as a value, and queues nothing, when the row is refused', async () => {
    state.insertError = REFUSED;

    const result = await run();

    expect(result.queued).toBe(0);
    expect(result.failed).toEqual([
      {
        episodeId: EPISODE,
        error: expect.stringContaining('generation_jobs_job_type_check'),
      },
    ]);
    expect(state.sent).toEqual([]);
  });
});
