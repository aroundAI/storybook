import { beforeEach, describe, expect, it, vi } from 'vitest';

import { unwrap } from '@kit/next/action-result';

/**
 * KB-112. Starting a voice clone, deleting one, and listing the account's
 * ElevenLabs voices all read the account's key and call ElevenLabs. #337
 * (KB-46) put nine ElevenLabs paths behind `can_write_project`; these three
 * checked only that the caller was signed in, so a project viewer (or a
 * teammate with no project role) could start or delete a clone on the
 * team's key.
 *
 * The real actions and authoriser run. The Supabase client answers like
 * RLS: the caller reads the rows, and `can_write_project` answers for the
 * projects in `writable`. The key read and ElevenLabs are counted.
 */

const ACCOUNT = '11111111-1111-4111-8111-111111111111';
const PROJECT = '22222222-2222-4222-8222-222222222222';
const ASSET = '33333333-3333-4333-8333-333333333333';
const CALLER = '77777777-7777-4777-8777-777777777777';

type Row = Record<string, unknown>;

const state = vi.hoisted(() => ({
  writable: new Set<string>(),
  keyReads: 0,
  vendorCalls: [] as string[],
  writes: [] as string[],
  /** RLS refusing the voice profile update although the write check passed */
  profileUpdateMatchesNothing: false,
}));

vi.mock('server-only', () => ({}));
vi.mock('next/cache', () => ({ revalidatePath: () => undefined }));
vi.mock('@kit/next/actions', () => ({
  enhanceAction: (handler: (data: unknown) => unknown) => (data: unknown) =>
    handler(data),
}));
vi.mock('@kit/shared/logger', () => ({
  getLogger: async () => ({
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
  }),
}));
vi.mock('@kit/shared/crypto', () => ({ decrypt: () => 'decrypted-key' }));
// Every key read goes through KB-84's helper; its own access check is its test's
vi.mock('@kit/supabase/external-api-keys', () => ({
  readExternalApiKey: async (
    _client: unknown,
    accountId: string,
    provider: string,
  ) => {
    state.keyReads += 1;
    return (
      rows.external_api_keys?.find(
        (row) => row.account_id === accountId && row.provider === provider,
      ) ?? null
    );
  },
}));
vi.mock('@kit/supabase/require-user', () => ({
  requireUser: async () => ({ data: { id: CALLER }, error: null }),
}));
vi.mock('../src/providers/elevenlabs', () => ({
  ElevenLabsProvider: class {
    async cloneVoice() {
      state.vendorCalls.push('clone');
      return { voiceId: 'v1', status: 'ready', name: 'Voice' };
    }
    async deleteClonedVoice() {
      state.vendorCalls.push('delete');
    }
    async getVoices() {
      state.vendorCalls.push('list');
      return { voices: [] };
    }
  },
}));

const rows: Record<string, Row[]> = {
  assets: [
    { id: ASSET, project_id: PROJECT, projects: { account_id: ACCOUNT } },
  ],
  projects: [{ id: PROJECT, account_id: ACCOUNT }],
  voice_profiles: [
    {
      asset_id: ASSET,
      provider_voice_id: 'v1',
      assets: { project_id: PROJECT, projects: { account_id: ACCOUNT } },
    },
  ],
  external_api_keys: [
    {
      account_id: ACCOUNT,
      provider: 'elevenlabs',
      is_active: true,
      encrypted_key: 'ciphertext',
    },
  ],
};

function query(table: string) {
  let found = [...(rows[table] ?? [])];
  let updating = false;

  const builder = {
    select: () => builder,
    eq: (column: string, value: unknown) => {
      found = found.filter((row) => !(column in row) || row[column] === value);
      return builder;
    },
    is: () => builder,
    upsert: () => {
      state.writes.push(`${table}.upsert`);
      return builder;
    },
    update: () => {
      state.writes.push(`${table}.update`);
      updating = true;
      return builder;
    },
    delete: () => {
      state.writes.push(`${table}.delete`);
      return builder;
    },
    single: async () => {
      if (table === 'external_api_keys') state.keyReads += 1;
      return found[0]
        ? { data: found[0], error: null }
        : { data: null, error: { message: 'not found' } };
    },
    maybeSingle: async () => ({ data: found[0] ?? null, error: null }),
    // A write reports the rows it matched, as `.select()` after it would
    then: (
      resolve: (value: {
        data: Record<string, unknown>[];
        error: null;
      }) => unknown,
    ) =>
      resolve({
        data:
          updating &&
          table === 'voice_profiles' &&
          state.profileUpdateMatchesNothing
            ? []
            : found,
        error: null,
      }),
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
  }),
}));

const cloneInput = {
  assetId: ASSET,
  voiceName: 'Narrator',
  samples: ['https://cdn.test/sample.mp3'],
  consent: {
    consenterName: 'N',
    consentType: 'self',
    consentText: 'I consent',
  },
};

beforeEach(() => {
  state.writable.clear();
  state.keyReads = 0;
  state.vendorCalls.length = 0;
  state.writes.length = 0;
  state.profileUpdateMatchesNothing = false;
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(new Uint8Array([1, 2, 3]))),
  );
});

describe('a caller who can read the project but not write it', () => {
  it('cannot start a clone: no consent written, no key read, no ElevenLabs call', async () => {
    const { startVoiceCloneAction } = await import(
      '../src/server/voice-clone-actions'
    );

    const result = await startVoiceCloneAction(
      cloneInput as Parameters<typeof startVoiceCloneAction>[0],
    );

    expect(result).toEqual({ ok: false, error: 'Asset not found' });
    expect(state.writes).toEqual([]);
    expect(state.keyReads).toBe(0);
    expect(state.vendorCalls).toEqual([]);
  });

  it('cannot delete a clone: nothing cleared, no key read, no ElevenLabs call', async () => {
    const { deleteVoiceCloneAction } = await import(
      '../src/server/voice-clone-actions'
    );

    const result = await deleteVoiceCloneAction({ assetId: ASSET });

    expect(result).toEqual({ ok: false, error: 'Voice profile not found' });
    expect(state.writes).toEqual([]);
    expect(state.keyReads).toBe(0);
    expect(state.vendorCalls).toEqual([]);
  });

  it('cannot list the account’s voices with its key', async () => {
    const { listVoicesAction } = await import(
      '../src/server/voice-profile-actions'
    );

    await expect(
      unwrap(listVoicesAction({ projectId: PROJECT })),
    ).rejects.toThrow('Project not found or access denied');
    expect(state.keyReads).toBe(0);
    expect(state.vendorCalls).toEqual([]);
  });
});

describe('a caller who can write the project', () => {
  beforeEach(() => {
    state.writable.add(PROJECT);
  });

  it('starts a clone on the account’s key', async () => {
    const { startVoiceCloneAction } = await import(
      '../src/server/voice-clone-actions'
    );

    const result = await startVoiceCloneAction(
      cloneInput as Parameters<typeof startVoiceCloneAction>[0],
    );

    expect(result).toMatchObject({ ok: true });
    expect(state.vendorCalls).toEqual(['clone']);
  });

  it('refuses a clone RLS will not mark pending, before any ElevenLabs call (KB-105)', async () => {
    state.profileUpdateMatchesNothing = true;
    const { startVoiceCloneAction } = await import(
      '../src/server/voice-clone-actions'
    );

    const result = await startVoiceCloneAction(
      cloneInput as Parameters<typeof startVoiceCloneAction>[0],
    );

    expect(result).toEqual({ ok: false, error: "You can't clone this voice." });
    expect(state.vendorCalls).toEqual([]);
  });

  it('deletes a clone', async () => {
    const { deleteVoiceCloneAction } = await import(
      '../src/server/voice-clone-actions'
    );

    await expect(deleteVoiceCloneAction({ assetId: ASSET })).resolves.toEqual({
      ok: true,
      data: { success: true },
    });
    expect(state.vendorCalls).toEqual(['delete']);
  });

  it('lists voices', async () => {
    const { listVoicesAction } = await import(
      '../src/server/voice-profile-actions'
    );

    await unwrap(listVoicesAction({ projectId: PROJECT }));

    expect(state.vendorCalls).toEqual(['list']);
  });
});
