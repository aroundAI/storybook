import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * KB-76/77/63: resetting one episode goes through
 * bulk_reset_episodes_to_stage, which checks can_write_project and clears the
 * episode's canon in one definer transaction, append-only logs and other
 * threads' episodes_touched included. Clients can no longer delete those
 * rows directly, so a reset that deleted table by table would leave them
 * behind; and before the fix a project viewer's reset deleted threads and
 * the summary before failing on the episode update.
 *
 * The fake client answers like RLS for the episode read and records every
 * table write and RPC call.
 */

const ACCOUNT = '11111111-1111-4111-8111-111111111111';
const PROJECT = '22222222-2222-4222-8222-222222222222';
const EPISODE = '33333333-3333-4333-8333-333333333333';
const CALLER = '77777777-7777-4777-8777-777777777777';

const state = vi.hoisted(() => ({
  writable: true,
  resetResult: { reset_count: 1, errors: [] } as unknown,
  writes: [] as string[],
  rpcs: [] as Array<{ fn: string; args: Record<string, unknown> }>,
}));

vi.mock('@kit/next/actions', () => ({
  enhanceAction:
    (
      handler: (data: unknown, user: { id: string }) => unknown,
      options?: { schema?: { parse: (data: unknown) => unknown } },
    ) =>
    (data: unknown) =>
      handler(options?.schema ? options.schema.parse(data) : data, {
        id: CALLER,
      }),
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

// The asset mapper's package also exports React components; resets never use it.
vi.mock('@kit/assets', () => ({ mapRowToAsset: () => undefined }));

function query(table: string) {
  const episode = {
    id: EPISODE,
    project_id: PROJECT,
    title: 'E',
    status: 'story',
    version: 1,
    project: { account_id: ACCOUNT },
  };

  const record = (verb: string) => () => {
    state.writes.push(`${verb} ${table}`);
    return builder;
  };

  const builder = {
    select: () => builder,
    eq: () => builder,
    is: () => builder,
    in: () => builder,
    delete: record('delete'),
    update: record('update'),
    insert: record('insert'),
    single: async () =>
      table === 'episodes'
        ? { data: episode, error: null }
        : { data: null, error: null },
    then: <R>(resolve: (value: { data: null; error: null }) => R) =>
      Promise.resolve({ data: null, error: null }).then(resolve),
  };

  return builder;
}

vi.mock('@kit/supabase/server-client', () => ({
  getSupabaseServerClient: () => ({
    from: query,
    rpc: async (fn: string, args: Record<string, unknown>) => {
      state.rpcs.push({ fn, args });

      if (fn === 'can_write_project') {
        return { data: state.writable, error: null };
      }

      if (fn === 'bulk_reset_episodes_to_stage') {
        return { data: state.resetResult, error: null };
      }

      return { data: null, error: { message: `unexpected rpc ${fn}` } };
    },
  }),
}));

const { resetToStageAction, resetEpisodeAction } = await import(
  '../src/server/actions'
);

const REFUSAL = "You can't reset this episode.";

beforeEach(() => {
  state.writable = true;
  state.resetResult = { reset_count: 1, errors: [] };
  state.writes = [];
  state.rpcs = [];
});

describe('resetToStageAction', () => {
  it('refuses a caller who cannot write the project, and changes nothing', async () => {
    state.writable = false;

    await expect(
      resetToStageAction({ episodeId: EPISODE, targetStage: 'story' }),
    ).resolves.toEqual({ ok: false, error: REFUSAL });

    expect(state.writes).toEqual([]);
    expect(state.rpcs.map((call) => call.fn)).toEqual(['can_write_project']);
  });

  it('resets a writer’s episode through the checked bulk reset, and writes no table directly', async () => {
    await expect(
      resetToStageAction({ episodeId: EPISODE, targetStage: 'story' }),
    ).resolves.toEqual({ ok: true, data: { success: true } });

    expect(state.rpcs).toEqual([
      { fn: 'can_write_project', args: { target_project_id: PROJECT } },
      {
        fn: 'bulk_reset_episodes_to_stage',
        args: {
          p_episode_ids: [EPISODE],
          p_target_stage: 'story',
          p_account_id: ACCOUNT,
        },
      },
    ]);
    expect(state.writes).toEqual([]);
  });

  it('fails when the bulk reset reports an error', async () => {
    state.resetResult = {
      reset_count: 0,
      errors: [{ episode_id: null, error: 'boom' }],
    };

    await expect(
      resetToStageAction({ episodeId: EPISODE, targetStage: 'draft' }),
    ).rejects.toThrow('Failed to reset episode');
  });

  it('fails when the bulk reset reset nothing', async () => {
    state.resetResult = { reset_count: 0, errors: [] };

    await expect(
      resetToStageAction({ episodeId: EPISODE, targetStage: 'draft' }),
    ).rejects.toThrow('Failed to reset episode');
  });
});

describe('resetEpisodeAction', () => {
  it('refuses a non-writer as a value', async () => {
    state.writable = false;

    await expect(
      resetEpisodeAction({ episodeId: EPISODE, version: 1 }),
    ).resolves.toEqual({ ok: false, error: REFUSAL });

    expect(state.writes).toEqual([]);
  });

  it('resets to draft through the bulk reset', async () => {
    await expect(
      resetEpisodeAction({ episodeId: EPISODE, version: 1 }),
    ).resolves.toEqual({ ok: true, data: { success: true } });

    expect(state.rpcs.at(-1)).toEqual({
      fn: 'bulk_reset_episodes_to_stage',
      args: {
        p_episode_ids: [EPISODE],
        p_target_stage: 'draft',
        p_account_id: ACCOUNT,
      },
    });
    expect(state.writes).toEqual([]);
  });
});
