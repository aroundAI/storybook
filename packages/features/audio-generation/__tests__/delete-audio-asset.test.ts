import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * KB-95: the audio library's Delete only hid the card. The row kept
 * `deleted_at = null`, so the asset came back on the next load.
 *
 * `deleteAudioAssetAction` soft-deletes the row as the caller (a project
 * writer: the authoriser, then RLS), and only then removes the file with the
 * server's storage client, if the file is the asset's own and nothing on a
 * timeline still plays it (lead decision, Q2: keep it while in use).
 *
 * The real action, authoriser and ownership rule run. The Supabase clients
 * and storage are fakes that record what was written and deleted.
 */

const ACCOUNT = '44444444-4444-4444-8444-444444444444';
const PROJECT = '55555555-5555-4555-8555-555555555555';
const CALLER = '77777777-7777-4777-8777-777777777777';
const ASSET = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const UPLOAD_KEY = `projects/${PROJECT}/assets/audio/1727000000000-1a2b3c4d.mp3`;
const CDN = 'https://cdn.example.com';

type Row = {
  id: string;
  project_id: string;
  status: string;
  file_url: string | null;
  deleted_at: string | null;
};

const state = vi.hoisted(() => ({
  row: null as null | Row,
  writable: true,
  trackRefs: 0,
  cueRefs: 0,
  log: [] as string[],
  updates: [] as Array<Record<string, unknown>>,
  deleted: [] as Array<{ bucket: string; key: string }>,
  refQueries: [] as string[],
}));

vi.mock('@kit/next/actions', () => ({
  enhanceAction:
    (
      handler: (data: unknown) => unknown,
      options?: { schema?: { parse: (data: unknown) => unknown } },
    ) =>
    (data: unknown) =>
      handler(options?.schema ? options.schema.parse(data) : data),
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

vi.mock('@kit/storage', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@kit/storage')>()),
  getStorageAdapter: () => ({
    getPublicUrl: (bucket: string, path: string) => `${CDN}/${bucket}/${path}`,
    delete: async (bucket: string, key: string) => {
      state.log.push('storage.delete');
      state.deleted.push({ bucket, key });
    },
  }),
}));

function userQuery(table: string) {
  let writing: Record<string, unknown> | null = null;

  const builder = {
    select: () => builder,
    update: (values: Record<string, unknown>) => {
      writing = values;
      return builder;
    },
    eq: () => builder,
    is: () => builder,
    maybeSingle: async () => {
      if (table === 'projects') {
        return { data: { id: PROJECT, account_id: ACCOUNT }, error: null };
      }
      return { data: state.row, error: null };
    },
    then: <R>(
      resolve: (value: { data: unknown; error: null }) => R,
    ): Promise<R> => {
      if (writing && table === 'audio_assets') {
        state.log.push('row.update');
        state.updates.push(writing);
        // RLS: only a writer's update matches the row
        const matched = state.writable && state.row && !state.row.deleted_at;
        return Promise.resolve({
          data: matched ? [{ id: ASSET }] : [],
          error: null,
        }).then(resolve);
      }
      return Promise.resolve({ data: [], error: null }).then(resolve);
    },
  };

  return builder;
}

vi.mock('@kit/supabase/server-client', () => ({
  getSupabaseServerClient: () => ({
    from: userQuery,
    rpc: async (fn: string) =>
      fn === 'can_write_project'
        ? { data: state.writable, error: null }
        : { data: null, error: null },
  }),
}));

vi.mock('@kit/supabase/server-admin-client', () => ({
  getSupabaseServerAdminClient: () => ({
    from: (table: string) => {
      const builder = {
        select: () => builder,
        eq: () => builder,
        or: (filter: string) => {
          state.refQueries.push(filter);
          return builder;
        },
        then: <R>(
          resolve: (value: { count: number; error: null }) => R,
        ): Promise<R> => {
          state.log.push(`count.${table}`);
          return Promise.resolve({
            count: table === 'audio_tracks' ? state.trackRefs : state.cueRefs,
            error: null,
          }).then(resolve);
        },
      };
      return builder;
    },
  }),
}));

function asset(overrides: Partial<Row> = {}): Row {
  return {
    id: ASSET,
    project_id: PROJECT,
    status: 'completed',
    file_url: `${CDN}/project-assets/${UPLOAD_KEY}`,
    deleted_at: null,
    ...overrides,
  };
}

async function remove() {
  const { deleteAudioAssetAction } = await import(
    '../src/server/audio-asset-actions'
  );
  return deleteAudioAssetAction({ assetId: ASSET });
}

beforeEach(() => {
  state.row = asset();
  state.writable = true;
  state.trackRefs = 0;
  state.cueRefs = 0;
  state.log = [];
  state.updates = [];
  state.deleted = [];
  state.refQueries = [];
});

describe('deleteAudioAssetAction (KB-95)', () => {
  it('soft-deletes the row, then removes its own unused file', async () => {
    const result = await remove();

    expect(result).toEqual({
      ok: true,
      data: { deleted: true, fileRemoved: true },
    });
    expect(state.updates).toEqual([
      expect.objectContaining({ deleted_at: expect.any(String) }),
    ]);
    expect(state.deleted).toEqual([
      { bucket: 'project-assets', key: UPLOAD_KEY },
    ]);
    // The row first: a failed file delete never leaves a live row pointing
    // at nothing
    expect(state.log.indexOf('row.update')).toBeLessThan(
      state.log.indexOf('storage.delete'),
    );
  });

  it('refuses a project viewer, and changes nothing', async () => {
    state.writable = false;

    const result = await remove();

    expect(result).toEqual({
      ok: false,
      error: "You can't delete assets in this project.",
    });
    expect(state.updates).toEqual([]);
    expect(state.deleted).toEqual([]);
  });

  it('refuses an asset the caller cannot see, with the same words', async () => {
    state.row = null;

    const result = await remove();

    expect(result).toEqual({
      ok: false,
      error: "You can't delete assets in this project.",
    });
    expect(state.deleted).toEqual([]);
  });

  it.each(['pending', 'processing'])(
    'refuses an asset still generating (%s)',
    async (status) => {
      state.row = asset({ status });

      const result = await remove();

      expect(result).toEqual({
        ok: false,
        error: 'This asset is still generating.',
      });
      expect(state.updates).toEqual([]);
    },
  );

  it.each([
    ['a timeline track', 1, 0],
    ['a cue', 0, 1],
  ])('keeps the file while %s uses it', async (_name, tracks, cues) => {
    state.trackRefs = tracks;
    state.cueRefs = cues;

    const result = await remove();

    expect(result).toEqual({
      ok: true,
      data: { deleted: true, fileRemoved: false },
    });
    expect(state.updates).toHaveLength(1);
    expect(state.deleted).toEqual([]);
  });

  it('counts a track that copied the URL, not only one that names the id', async () => {
    await remove();

    expect(state.refQueries.join(' ')).toContain(
      `file_url.eq."${CDN}/project-assets/${UPLOAD_KEY}"`,
    );
    expect(state.refQueries.join(' ')).toContain(`audio_asset_id.eq.${ASSET}`);
  });

  it("does not delete a file that isn't the asset's own", async () => {
    state.row = asset({
      file_url: `${CDN}/project-assets/projects/${PROJECT}/assets/intros/en-1.mp4`,
    });

    const result = await remove();

    expect(result).toEqual({
      ok: true,
      data: { deleted: true, fileRemoved: false },
    });
    expect(state.deleted).toEqual([]);
  });

  it('an asset already deleted is done: nothing is written again', async () => {
    state.row = asset({ deleted_at: '2026-09-25T00:00:00Z' });

    const result = await remove();

    expect(result).toEqual({
      ok: true,
      data: { deleted: true, fileRemoved: false },
    });
    expect(state.updates).toEqual([]);
    expect(state.deleted).toEqual([]);
  });
});
