import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * KB-46, the rest of the class: every action that spends a project's
 * ElevenLabs key — music and SFX, from the library and from the timeline —
 * does so only for a caller who can write to that project (KB-28's
 * `can_write_project`, asked as the caller).
 *
 * The key is read through the caller's client, so a stranger is already
 * refused by `external_api_keys` RLS. Every role on the team is not: a
 * project viewer, or a teammate with no role on the project, could read the
 * key row, and the vendor was called with it before anything checked
 * whether they may write.
 *
 * The real actions and authoriser run. The Supabase client is a fake that
 * answers like RLS; the key lookup, the asset library, the vendors and
 * storage are spies.
 */

const A_ACCOUNT = '11111111-1111-4111-8111-111111111111';
const A_PROJECT = '22222222-2222-4222-8222-222222222222';
const B_ACCOUNT = '44444444-4444-4444-8444-444444444444';
const B_PROJECT = '55555555-5555-4555-8555-555555555555';
const CALLER = '77777777-7777-4777-8777-777777777777';

const state = vi.hoisted(() => ({
  writable: new Set<string>(),
  keyReads: [] as string[],
  assetLookups: [] as string[],
  vendorCalls: 0,
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

vi.mock('@kit/supabase/server-admin-client', () => ({
  getSupabaseServerAdminClient: () => ({}),
}));

vi.mock('@kit/storage', () => ({
  getStorageAdapter: () => ({
    upload: async () => ({ url: 'https://audio.test/asset.mp3' }),
  }),
  // The gate is @kit/storage's own test; here it passes the write through
  writeProjectObject: async () => ({ url: 'https://audio.test/asset.mp3' }),
}));

vi.mock('../src/server/project-audio-settings', () => ({
  getProjectElevenLabsApiKey: async (projectId: string) => {
    state.keyReads.push(projectId);
    return 'decrypted-key';
  },
}));

vi.mock('../src/server/audio-asset-library', () => ({
  findOrCreateAudioAsset: async (params: { projectId: string }) => {
    state.assetLookups.push(params.projectId);
    return {
      asset: {
        id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
        status: 'pending',
        fileUrl: null,
      },
      isNew: true,
    };
  },
}));

vi.mock('../src/providers/elevenlabs-sfx', () => ({
  ElevenLabsSfxProvider: class {
    async generateSfx() {
      state.vendorCalls += 1;
      return {
        audioBuffer: Buffer.from('mp3'),
        status: 'completed',
        jobId: 'job',
        duration: 1,
      };
    }
  },
}));

vi.mock('../src/providers/elevenlabs-music', () => ({
  ElevenLabsMusicProvider: class {
    async generateMusic() {
      state.vendorCalls += 1;
      return {
        audioBuffer: Buffer.from('mp3'),
        status: 'completed',
        jobId: 'job',
        duration: 5,
      };
    }
  },
}));

const PROJECTS = [
  { id: A_PROJECT, account_id: A_ACCOUNT },
  { id: B_PROJECT, account_id: B_ACCOUNT },
];

function query(table: string) {
  let rows: Array<Record<string, unknown>> =
    table === 'projects' ? [...PROJECTS] : [];

  const builder = {
    select: () => builder,
    insert: () => builder,
    update: () => builder,
    eq: (column: string, value: unknown) => {
      if (table === 'projects') {
        rows = rows.filter((row) => row[column] === value);
      }
      return builder;
    },
    is: () => builder,
    in: () => builder,
    not: () => builder,
    order: () => builder,
    limit: () => builder,
    single: async () => ({
      data: rows[0] ?? {
        id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
        status: 'completed',
      },
      error: null,
    }),
    maybeSingle: async () => ({ data: rows[0] ?? null, error: null }),
    then: <R>(
      resolve: (value: {
        data: Array<Record<string, unknown>>;
        error: null;
      }) => R,
    ) => Promise.resolve({ data: rows, error: null }).then(resolve),
  };

  return builder;
}

vi.mock('@kit/supabase/server-client', () => ({
  getSupabaseServerClient: () => ({
    from: query,
    rpc: async (fn: string, args: { target_project_id: string }) =>
      fn === 'can_write_project'
        ? { data: state.writable.has(args.target_project_id), error: null }
        : { data: null, error: null },
  }),
}));

beforeEach(() => {
  // A's project is readable to the caller — they are on its team — but only
  // B's is writable.
  state.writable = new Set([B_PROJECT]);
  state.keyReads = [];
  state.assetLookups = [];
  state.vendorCalls = 0;
});

function expectNothingSpent() {
  expect(state.assetLookups).toEqual([]);
  expect(state.keyReads).toEqual([]);
  expect(state.vendorCalls).toBe(0);
}

describe('generateSfxAction (timeline SFX)', () => {
  it('refuses a project the caller cannot write to, before its key', async () => {
    const { generateSfxAction } = await import('../src/server/sfx-actions');

    const result = await generateSfxAction({
      projectId: A_PROJECT,
      prompt: 'Door slam',
    });

    expect(result).toMatchObject({
      status: 'failed',
      error: 'Project not found',
    });
    expectNothingSpent();
  });

  it('generates for the writer’s own project', async () => {
    const { generateSfxAction } = await import('../src/server/sfx-actions');

    await generateSfxAction({ projectId: B_PROJECT, prompt: 'Door slam' });

    expect(state.keyReads).toEqual([B_PROJECT]);
    expect(state.vendorCalls).toBe(1);
  });
});

describe('generateMusicElevenLabsAction (timeline music)', () => {
  it('refuses a project the caller cannot write to, before its key', async () => {
    const { generateMusicElevenLabsAction } = await import(
      '../src/server/elevenlabs-music-actions'
    );

    const result = await generateMusicElevenLabsAction({
      projectId: A_PROJECT,
      prompt: 'Calm piano',
      durationSeconds: 60,
    });

    expect(result).toMatchObject({
      status: 'failed',
      error: 'Project not found',
    });
    expectNothingSpent();
  });

  it('generates for the writer’s own project', async () => {
    const { generateMusicElevenLabsAction } = await import(
      '../src/server/elevenlabs-music-actions'
    );

    await generateMusicElevenLabsAction({
      projectId: B_PROJECT,
      prompt: 'Calm piano',
      durationSeconds: 60,
    });

    expect(state.keyReads).toEqual([B_PROJECT]);
    expect(state.vendorCalls).toBe(1);
  });
});

describe('generateMusicAssetAction (audio library)', () => {
  it('refuses a project the caller cannot write to, before its key', async () => {
    const { generateMusicAssetAction } = await import(
      '../src/server/audio-asset-actions'
    );

    await expect(
      generateMusicAssetAction({
        projectId: A_PROJECT,
        prompt: 'Calm piano',
        duration: 30,
      }),
    ).resolves.toEqual({ ok: false, error: 'Project not found' });
    expectNothingSpent();
  });

  it('generates for the writer’s own project', async () => {
    const { generateMusicAssetAction } = await import(
      '../src/server/audio-asset-actions'
    );

    await generateMusicAssetAction({
      projectId: B_PROJECT,
      prompt: 'Calm piano',
      duration: 30,
    });

    expect(state.keyReads).toEqual([B_PROJECT]);
    expect(state.vendorCalls).toBe(1);
  });
});

describe('generateSfxAssetAction (audio library)', () => {
  it('refuses a project the caller cannot write to, before its key', async () => {
    const { generateSfxAssetAction } = await import(
      '../src/server/audio-asset-actions'
    );

    await expect(
      generateSfxAssetAction({
        projectId: A_PROJECT,
        prompt: 'Door slam',
        duration: 5,
      }),
    ).resolves.toEqual({ ok: false, error: 'Project not found' });
    expectNothingSpent();
  });

  it('generates for the writer’s own project', async () => {
    const { generateSfxAssetAction } = await import(
      '../src/server/audio-asset-actions'
    );

    await generateSfxAssetAction({
      projectId: B_PROJECT,
      prompt: 'Door slam',
      duration: 5,
    });

    expect(state.keyReads).toEqual([B_PROJECT]);
    expect(state.vendorCalls).toBe(1);
  });
});
