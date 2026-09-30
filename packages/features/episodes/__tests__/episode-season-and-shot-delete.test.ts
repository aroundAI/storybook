import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * FILM-301: PostgREST embeds a many-to-one relation as an object, so the
 * season read as `season[0]` was always undefined and every episode came back
 * with `season: null`. Deleting an episode hard-deleted its shots although
 * `shots.deleted_at` exists, and the shot read did not filter soft-deleted
 * rows.
 *
 * The fake client records every call made on each table.
 */

const EPISODE = '33333333-3333-4333-8333-333333333333';
const SEASON = { id: 'season-1', name: 'Season One', number: 1 };

type Call = { table: string; verb: string; args: unknown[] };

const state = vi.hoisted(() => ({
  calls: [] as Array<{ table: string; verb: string; args: unknown[] }>,
}));

vi.mock('@kit/next/actions', () => ({
  enhanceAction:
    (
      handler: (data: unknown, user: { id: string }) => unknown,
      options?: { schema?: { parse: (data: unknown) => unknown } },
    ) =>
    (data: unknown) =>
      handler(options?.schema ? options.schema.parse(data) : data, {
        id: 'user-1',
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
  requireUser: async () => ({ data: { id: 'user-1' }, error: null }),
}));

vi.mock('@kit/audit-logs/server', () => ({
  createAuditLog: async () => undefined,
  extractNetworkContext: async () => ({}),
}));

vi.mock('next/cache', () => ({ revalidatePath: () => undefined }));

vi.mock('@kit/assets', () => ({ mapRowToAsset: () => undefined }));

function query(table: string) {
  const record =
    (verb: string) =>
    (...args: unknown[]) => {
      state.calls.push({ table, verb, args });
      return builder;
    };

  const episodeRow = {
    id: EPISODE,
    slug: 'e1',
    project_id: 'project-1',
    title: 'E',
    season: SEASON,
    project: { account_id: 'account-1' },
  };

  const rows: Record<string, unknown> = {
    episodes: [{ id: EPISODE }],
    shots: [],
    assets: [],
  };

  const builder = {
    select: record('select'),
    eq: record('eq'),
    is: record('is'),
    order: record('order'),
    delete: record('delete'),
    update: record('update'),
    single: async () => ({ data: episodeRow, error: null }),
    then: <R>(resolve: (value: { data: unknown; error: null }) => R) =>
      Promise.resolve({ data: rows[table] ?? [], error: null }).then(resolve),
  };

  return builder;
}

vi.mock('@kit/supabase/server-client', () => ({
  getSupabaseServerClient: () => ({ from: query }),
}));

const { getEpisodeWithShotsAction, deleteEpisodeAction } = await import(
  '../src/server/actions'
);

const callsOn = (table: string): Call[] =>
  state.calls.filter((call) => call.table === table);

beforeEach(() => {
  state.calls = [];
});

describe('getEpisodeWithShotsAction', () => {
  it('returns the season PostgREST embeds as an object', async () => {
    const result = await getEpisodeWithShotsAction({ episodeId: EPISODE });

    expect(result.data.season).toEqual(SEASON);
  });

  it('reads only shots that are not soft-deleted', async () => {
    await getEpisodeWithShotsAction({ episodeId: EPISODE });

    expect(callsOn('shots')).toContainEqual({
      table: 'shots',
      verb: 'is',
      args: ['deleted_at', null],
    });
  });
});

describe('deleteEpisodeAction', () => {
  it('soft deletes the episode’s shots and never hard-deletes them', async () => {
    await expect(deleteEpisodeAction({ episodeId: EPISODE })).resolves.toEqual({
      ok: true,
      data: { success: true, episodeId: EPISODE },
    });

    const shotCalls = callsOn('shots');
    expect(shotCalls.map((call) => call.verb)).not.toContain('delete');
    const update = shotCalls.find((call) => call.verb === 'update');
    expect(update?.args[0]).toEqual({ deleted_at: expect.any(String) });
    expect(shotCalls).toContainEqual({
      table: 'shots',
      verb: 'eq',
      args: ['episode_id', EPISODE],
    });
  });
});
