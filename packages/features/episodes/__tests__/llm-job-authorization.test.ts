import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * KB-31: every episodes action that queues an LLM job refuses a target the
 * caller cannot write to, and queues nothing.
 *
 * The worker runs on the service-role key and reads — and for most job
 * types writes — whatever the job names. Reproduced before the fix, with two
 * real users: B queued ideation on A's episode and the prompt built for B
 * carried A's characters, locations, season premise and facts; and once A's
 * project was public, B queued a story overwrite on it. The rule is KB-28's
 * `can_write_project`, asked as the caller; readable is not writable.
 *
 * The real authoriser (`@kit/prompt-engine/llm-job-target`) and the real
 * `payloadForTarget` run here; the Supabase client is a fake that answers
 * like RLS, and only the SQS send is captured.
 */

const A_ACCOUNT = '11111111-1111-4111-8111-111111111111';
const A_PROJECT = '22222222-2222-4222-8222-222222222222';
const A_EPISODE = '33333333-3333-4333-8333-333333333333';
const B_ACCOUNT = '44444444-4444-4444-8444-444444444444';
const B_PROJECT = '55555555-5555-4555-8555-555555555555';
const B_EPISODE = '66666666-6666-4666-8666-666666666666';
const CALLER = '77777777-7777-4777-8777-777777777777';

type Row = Record<string, unknown>;

const state = vi.hoisted(() => ({
  /** Rows RLS lets the caller read, per table. */
  readable: {} as Record<string, Array<Record<string, unknown>>>,
  /** Projects `can_write_project` answers true for. */
  writable: new Set<string>(),
  sent: [] as Array<{
    jobType: string;
    userId: string;
    payload: Record<string, unknown>;
  }>,
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

vi.mock('@kit/audit-logs/server', () => ({
  createAuditLog: async () => undefined,
  extractNetworkContext: async () => ({}),
}));

vi.mock('next/cache', () => ({ revalidatePath: () => undefined }));

vi.mock('@kit/prompt-engine/server', async () => {
  const { payloadForTarget } = await vi.importActual<
    typeof import('../../prompt-engine/src/lib/server/sqs-helper')
  >('../../prompt-engine/src/lib/server/sqs-helper');

  return {
    queueLlmJob: async (job: {
      jobType: string;
      userId: string;
      target: Parameters<typeof payloadForTarget>[0];
      payload: Record<string, unknown>;
    }) => {
      // What would reach SQS: the real stamping and cross-check. A call
      // without a target (the code before KB-31) sends its payload as is,
      // so a red run fails on the assertion, not on this mock.
      state.sent.push({
        jobType: job.jobType,
        userId: job.userId,
        payload: job.target
          ? payloadForTarget(job.target, job.payload)
          : job.payload,
      });
    },
  };
});

function query(table: string) {
  let rows: Row[] = [...(state.readable[table] ?? [])];
  let inserted = false;

  const settle = () => ({ data: inserted ? null : rows, error: null });

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
    insert: () => {
      inserted = true;
      return builder;
    },
    update: () => builder,
    single: async () =>
      inserted
        ? { data: { id: 'job' }, error: null }
        : rows[0]
          ? { data: rows[0], error: null }
          : { data: null, error: { message: 'not found', code: 'PGRST116' } },
    maybeSingle: async () => ({ data: rows[0] ?? null, error: null }),
    then: <R>(resolve: (value: ReturnType<typeof settle>) => R) =>
      Promise.resolve(settle()).then(resolve),
  };

  return builder;
}

vi.mock('@kit/supabase/server-client', () => ({
  getSupabaseServerClient: () => ({
    from: query,
    rpc: async (fn: string, args: { target_project_id: string }) =>
      fn === 'can_write_project'
        ? { data: state.writable.has(args.target_project_id), error: null }
        : { data: null, error: { message: `unexpected rpc ${fn}` } },
    auth: { getUser: async () => ({ data: { user: { id: CALLER } } }) },
  }),
}));

function episode(id: string, projectId: string, accountId: string): Row {
  return {
    id,
    project_id: projectId,
    season_id: null,
    number: 1,
    status: 'story',
    version: 1,
    title: 'Episode',
    story_data: { fullStory: 'A story long enough.' },
    screenplay_data: { scenes: [{ sceneNumber: 1 }] },
    project: { id: projectId, account_id: accountId, metadata: {} },
  };
}

/**
 * The caller (B) writes to B's project. A's episode is readable to B — as a
 * public project's is to everyone signed in — but not writable. The caller's
 * first account membership is a third account, which the old ideation code
 * billed.
 */
function seed() {
  state.readable = {
    episodes: [
      episode(A_EPISODE, A_PROJECT, A_ACCOUNT),
      episode(B_EPISODE, B_PROJECT, B_ACCOUNT),
    ],
    projects: [
      { id: A_PROJECT, account_id: A_ACCOUNT },
      { id: B_PROJECT, account_id: B_ACCOUNT },
    ],
    accounts_memberships: [
      { user_id: CALLER, account_id: '88888888-8888-4888-8888-888888888888' },
    ],
    shots: [{ id: 'shot', episode_id: B_EPISODE }],
  };
  state.writable = new Set([B_PROJECT]);
  state.sent = [];
}

beforeEach(() => {
  seed();
});

const PREMISE = 'A premise of at least ten characters';

describe('generateStoryIdeasAction (the KB-31 path)', () => {
  it('refuses an episode the caller cannot read, as a value, and queues nothing', async () => {
    state.readable.episodes = [];
    const { generateStoryIdeasAction } = await import(
      '../src/server/story-actions'
    );

    const result = await generateStoryIdeasAction({
      episodeId: A_EPISODE,
      premise: PREMISE,
      numberOfIdeas: 3,
    });

    expect(result).toEqual({ ok: false, error: 'Episode not found' });
    expect(state.sent).toEqual([]);
  });

  it('refuses a readable episode on a project the caller cannot write to — a public one', async () => {
    const { generateStoryIdeasAction } = await import(
      '../src/server/story-actions'
    );

    const result = await generateStoryIdeasAction({
      episodeId: A_EPISODE,
      premise: PREMISE,
      numberOfIdeas: 3,
    });

    expect(result).toEqual({ ok: false, error: 'Episode not found' });
    expect(state.sent).toEqual([]);
  });

  it('queues a writer’s own episode, billed to the episode’s account, not the caller’s first membership', async () => {
    const { generateStoryIdeasAction } = await import(
      '../src/server/story-actions'
    );

    const result = await generateStoryIdeasAction({
      episodeId: B_EPISODE,
      premise: PREMISE,
      numberOfIdeas: 3,
    });

    expect(result).toMatchObject({ ok: true });
    expect(state.sent).toHaveLength(1);
    expect(state.sent[0]!.payload).toMatchObject({
      episodeId: B_EPISODE,
      projectId: B_PROJECT,
      accountId: B_ACCOUNT,
    });
  });
});

describe('batchGenerateIdeasAction', () => {
  it('queues only the episodes the caller can write to', async () => {
    const { batchGenerateIdeasAction } = await import(
      '../src/server/bulk-actions'
    );

    const result = await batchGenerateIdeasAction({
      episodes: [
        { episodeId: A_EPISODE, premise: PREMISE, numberOfIdeas: 3 },
        { episodeId: B_EPISODE, premise: PREMISE, numberOfIdeas: 3 },
      ],
    });

    expect(result).toMatchObject({
      queued: 1,
      failed: [{ episodeId: A_EPISODE, error: 'Episode not found' }],
    });
    expect(state.sent.map((job) => job.payload.episodeId)).toEqual([B_EPISODE]);
    expect(state.sent[0]!.payload.accountId).toBe(B_ACCOUNT);
  });
});

describe('batchCreateAssetsAction', () => {
  it('refuses the caller’s own episode paired with another project’s id — the worker would write assets there', async () => {
    const { batchCreateAssetsAction } = await import(
      '../src/server/bulk-actions'
    );

    const result = await batchCreateAssetsAction({
      projectId: A_PROJECT,
      episodes: [{ episodeId: B_EPISODE }],
    });

    expect(result).toMatchObject({
      queued: 0,
      failed: [
        { episodeId: B_EPISODE, error: 'Episode is not in this project' },
      ],
    });
    expect(state.sent).toEqual([]);
  });
});

/**
 * Every other episodes producer: on A's readable-but-not-writable episode or
 * project, refused one way or another and nothing sent; on B's own, sent.
 */
const producers: Array<{
  name: string;
  run: (target: { episodeId: string; projectId: string }) => Promise<unknown>;
}> = [
  {
    name: 'generateFullStoryAction',
    run: async ({ episodeId, projectId }) =>
      (await import('../src/server/story-actions')).generateFullStoryAction({
        episodeId,
        version: 1,
        title: 'Overwrite',
        logline: 'A logline of some length',
        targetDuration: 300,
      }),
  },
  {
    name: 'refineStoryAction',
    run: async ({ episodeId, projectId }) =>
      (
        await import('../src/lib/server/mutations/refinement-actions')
      ).refineStoryAction({
        episodeId,
        projectId,
        feedback: 'Change it',
      }),
  },
  {
    name: 'refineScreenplayAction',
    run: async ({ episodeId, projectId }) =>
      (
        await import('../src/lib/server/mutations/refinement-actions')
      ).refineScreenplayAction({
        episodeId,
        projectId,
        feedback: 'Change it',
      }),
  },
  {
    name: 'convertToScreenplayAction',
    run: async ({ episodeId, projectId }) =>
      (
        await import('../src/server/screenplay-actions')
      ).convertToScreenplayAction({ episodeId }),
  },
  {
    name: 'generateShotListAction',
    run: async ({ episodeId, projectId }) =>
      (
        await import('../src/lib/server/mutations/shot-list-actions')
      ).generateShotListAction({
        episodeId,
        shotDurationMin: 5,
        shotDurationMax: 8,
      }),
  },
  {
    name: 'batchGenerateStoriesAction',
    run: async ({ episodeId, projectId }) =>
      (await import('../src/server/bulk-actions')).batchGenerateStoriesAction({
        episodes: [
          {
            episodeId,
            version: 1,
            title: 'Overwrite',
            logline: 'Overwrite',
          },
        ],
      }),
  },
  {
    name: 'batchConvertScreenplaysAction',
    run: async ({ episodeId, projectId }) =>
      (
        await import('../src/server/bulk-actions')
      ).batchConvertScreenplaysAction({ episodes: [{ episodeId }] }),
  },
  {
    name: 'batchGenerateShotsAction',
    run: async ({ episodeId, projectId }) =>
      (await import('../src/server/bulk-actions')).batchGenerateShotsAction({
        episodes: [{ episodeId }],
      }),
  },
  {
    name: 'analyzeSeasonRoadmapAction',
    run: async ({ episodeId, projectId }) =>
      (
        await import('../src/lib/server/mutations/season-generation-actions')
      ).analyzeSeasonRoadmapAction({
        projectId,
        roadmap: 'x'.repeat(60),
      }),
  },
  {
    name: 'generateSeasonOutlineAction',
    run: async ({ episodeId, projectId }) =>
      (
        await import('../src/server/batch-episode-actions')
      ).generateSeasonOutlineAction({
        projectId,
        seasonPremise: 'A season premise of some length',
        episodeCount: 3,
        startingNumber: 1,
      }),
  },
  {
    name: 'regenerateEpisodeOutlineAction',
    run: async ({ episodeId, projectId }) =>
      (
        await import('../src/server/batch-episode-actions')
      ).regenerateEpisodeOutlineAction({
        projectId,
        episodeNumber: 2,
        seasonPremise: 'A season premise of some length',
      }),
  },
];

describe.each(producers)('$name', ({ run }) => {
  it('queues nothing for a target the caller can read but not write', async () => {
    await run({ episodeId: A_EPISODE, projectId: A_PROJECT }).catch(
      () => undefined,
    );

    expect(state.sent).toEqual([]);
  });

  // Positive control: the refusal above is the rule, not a crash on the
  // fake client — the same call on the caller's own target is sent.
  it('queues the writer’s own target, billed to its account', async () => {
    await run({ episodeId: B_EPISODE, projectId: B_PROJECT });

    expect(state.sent).toHaveLength(1);
    expect(state.sent[0]!.payload.accountId).toBe(B_ACCOUNT);
  });
});

describe('what the producers send (KB-120, KB-121)', () => {
  it('shot generation sends the shot-length range the caller chose', async () => {
    const { generateShotListAction } = await import(
      '../src/lib/server/mutations/shot-list-actions'
    );

    await generateShotListAction({
      episodeId: B_EPISODE,
      shotDurationMin: 4,
      shotDurationMax: 6,
    });

    expect(state.sent[0]!.payload).toMatchObject({
      shotDurationMin: 4,
      shotDurationMax: 6,
    });
  });

  it('single-episode regeneration sends the neighbouring outlines and the note', async () => {
    const { regenerateEpisodeOutlineAction } = await import(
      '../src/server/batch-episode-actions'
    );
    const neighbour = {
      number: 1,
      title: 'Pilot',
      premise: 'Maya starts at the firm.',
      mainPlot: 'She notices the numbers do not add up, and says nothing.',
      arcPosition: 'setup' as const,
    };

    await regenerateEpisodeOutlineAction({
      projectId: B_PROJECT,
      episodeNumber: 2,
      seasonPremise: 'A season premise of some length',
      surroundingEpisodes: [neighbour],
      additionalContext: 'Keep Maya sympathetic.',
    });

    expect(state.sent[0]!.payload).toMatchObject({
      surroundingEpisodes: [neighbour],
      additionalContext: 'Keep Maya sympathetic.',
    });
  });
});
