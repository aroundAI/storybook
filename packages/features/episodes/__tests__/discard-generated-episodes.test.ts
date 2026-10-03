import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * FILM-1901 part B: the season_outline stage's commit creates the episode
 * rows when the outlines are generated. The preview's Cancel, and removing
 * one outline in it, discard the generated drafts the user did not keep, so
 * the user sees what they saw before (no episodes they did not confirm).
 *
 * The discard is a soft delete, the way the app deletes episodes, and it
 * touches only generated drafts of the project: a row a person made, or one
 * already past draft, is never deleted by this action.
 */

const PROJECT = '22222222-2222-4222-8222-222222222222';
const IDS = [
  '55555555-5555-4555-8555-555555555551',
  '55555555-5555-4555-8555-555555555552',
];

type Call = { table: string; verb: string; args: unknown[] };

const state = vi.hoisted(() => ({
  calls: [] as Array<{ table: string; verb: string; args: unknown[] }>,
  deleted: [] as Array<{ id: string }>,
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

vi.mock('@kit/prompt-engine/llm-job-target', () => ({
  authorizeProjectTarget: async () => ({ accountId: 'account-1' }),
}));

function query(table: string) {
  const record =
    (verb: string) =>
    (...args: unknown[]) => {
      state.calls.push({ table, verb, args });
      return builder;
    };

  const builder = {
    select: record('select'),
    eq: record('eq'),
    in: record('in'),
    is: record('is'),
    update: record('update'),
    single: async () => ({
      data: { id: PROJECT, account_id: 'account-1' },
      error: null,
    }),
    then: <R>(resolve: (value: { data: unknown; error: null }) => R) =>
      Promise.resolve({
        data: table === 'episodes' ? state.deleted : [],
        error: null,
      }).then(resolve),
  };

  return builder;
}

vi.mock('@kit/supabase/server-client', () => ({
  getSupabaseServerClient: () => ({ from: query }),
}));

const { discardGeneratedEpisodesAction } = await import(
  '../src/server/batch-episode-actions'
);

const callsOn = (table: string): Call[] =>
  state.calls.filter((call) => call.table === table);

beforeEach(() => {
  state.calls = [];
  state.deleted = IDS.map((id) => ({ id }));
});

describe('discardGeneratedEpisodesAction (FILM-1901)', () => {
  it('soft deletes only the generated drafts named, in this project', async () => {
    const result = await discardGeneratedEpisodesAction({
      projectId: PROJECT,
      episodeIds: IDS,
    });

    expect(result).toEqual({
      ok: true,
      data: { success: true, discarded: IDS },
    });

    const calls = callsOn('episodes');
    expect(calls.map((call) => call.verb)).not.toContain('delete');
    expect(calls.find((call) => call.verb === 'update')?.args[0]).toEqual({
      deleted_at: expect.any(String),
    });
    expect(calls).toContainEqual({
      table: 'episodes',
      verb: 'eq',
      args: ['project_id', PROJECT],
    });
    expect(calls).toContainEqual({
      table: 'episodes',
      verb: 'in',
      args: ['id', IDS],
    });
    expect(calls).toContainEqual({
      table: 'episodes',
      verb: 'eq',
      args: ['status', 'draft'],
    });
    expect(calls).toContainEqual({
      table: 'episodes',
      verb: 'eq',
      args: ['story_data->>generatedFromBatch', 'true'],
    });
    expect(calls).toContainEqual({
      table: 'episodes',
      verb: 'is',
      args: ['deleted_at', null],
    });
    // KB-61: the rows it changed are read back, so a refused delete is seen
    expect(calls).toContainEqual({
      table: 'episodes',
      verb: 'select',
      args: ['id'],
    });
  });

  it('refuses, as a value, when no generated draft matched (KB-61)', async () => {
    state.deleted = [];

    const result = await discardGeneratedEpisodesAction({
      projectId: PROJECT,
      episodeIds: IDS,
    });

    expect(result).toMatchObject({ ok: false });
    expect((result as { error: string }).error).toMatch(/weren't removed/);
  });

  it('refuses an empty list before touching the database', async () => {
    // The schema refuses it (enhanceAction reports a validation failure in
    // the app; the test's stand-in throws the Zod error)
    await expect(
      discardGeneratedEpisodesAction({ projectId: PROJECT, episodeIds: [] }),
    ).rejects.toThrow(/at least 1/);

    expect(callsOn('episodes')).toEqual([]);
  });
});
