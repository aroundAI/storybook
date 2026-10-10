import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * KB-105: an update RLS filters to no rows answers `{ data: [], error: null }`,
 * as one that worked. A channel's language and a project's publishing
 * channels were reported saved either way; each now refuses when its update
 * changed nothing.
 */

const CONNECTION = '50000000-0000-4000-8000-000000000001';
const PROJECT = '20000000-0000-4000-8000-000000000001';
const CONFIG = '80000000-0000-4000-8000-000000000001';

const state = vi.hoisted(() => ({
  /** The rows the next update reports changing: [] is RLS matching nothing */
  changed: [] as Array<{ id: string }>,
}));

vi.mock('server-only', () => ({}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@kit/shared/logger', () => ({
  getLogger: async () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn() }),
}));
vi.mock('@kit/next/actions', () => ({
  enhanceAction:
    (
      handler: (data: unknown, user: unknown) => unknown,
      options?: { schema?: { parse: (value: unknown) => unknown } },
    ) =>
    (data: unknown) =>
      handler(options?.schema ? options.schema.parse(data) : data, {
        id: 'user-1',
      }),
}));
vi.mock('@kit/supabase/require-user', () => ({
  requireUser: async () => ({ data: { id: 'user-1' }, error: null }),
}));

function query(table: string) {
  let writing = false;
  const write = () => {
    writing = true;
    return builder;
  };
  const builder = {
    select: () => (writing ? resolved() : builder),
    update: write,
    delete: write,
    upsert: write,
    eq: () => builder,
    in: () => builder,
    then: (resolve: (value: unknown) => unknown) =>
      resolve({
        data:
          table === 'project_publishing_configs'
            ? [{ id: CONFIG, platform_connection_id: CONNECTION }]
            : [],
        error: null,
      }),
  };
  const resolved = async () => ({ data: state.changed, error: null });
  return builder;
}

vi.mock('@kit/supabase/server-client', () => ({
  getSupabaseServerClient: () => ({ from: query }),
}));

beforeEach(() => {
  state.changed = [];
});

describe("a channel's language (KB-105)", () => {
  it('refuses when the update changed no row', async () => {
    const { updateConnectionLanguageAction } = await import(
      '../src/server/connection-actions'
    );

    await expect(
      updateConnectionLanguageAction({
        connectionId: CONNECTION,
        language: 'es',
      }),
    ).resolves.toEqual({
      ok: false,
      error: "You can't change this channel's language.",
    });
  });

  it('saves when it changed the channel', async () => {
    state.changed = [{ id: CONNECTION }];
    const { updateConnectionLanguageAction } = await import(
      '../src/server/connection-actions'
    );

    await expect(
      updateConnectionLanguageAction({
        connectionId: CONNECTION,
        language: 'es',
      }),
    ).resolves.toMatchObject({ ok: true });
  });
});

describe("a project's channels (KB-105)", () => {
  // The project keeps its one channel: an upsert that must save one row
  const input = { projectId: PROJECT, connectionIds: [CONNECTION] };

  it('refuses when the save changed no row', async () => {
    const { setProjectChannelsAction } = await import(
      '../src/server/project-publishing-actions'
    );

    await expect(setProjectChannelsAction(input)).resolves.toEqual({
      success: false,
      error: "You can't change this project's channels.",
    });
  });

  it('refuses when removing a channel deleted no row', async () => {
    const { setProjectChannelsAction } = await import(
      '../src/server/project-publishing-actions'
    );

    await expect(
      setProjectChannelsAction({ projectId: PROJECT, connectionIds: [] }),
    ).resolves.toEqual({
      success: false,
      error: "You can't change this project's channels.",
    });
  });

  it('saves when it changed the project', async () => {
    state.changed = [{ id: CONFIG }];
    const { setProjectChannelsAction } = await import(
      '../src/server/project-publishing-actions'
    );

    await expect(setProjectChannelsAction(input)).resolves.toEqual({
      success: true,
    });
  });
});
