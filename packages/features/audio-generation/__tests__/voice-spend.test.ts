import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * KB-83: voice spend was never counted against the account's monthly usage.
 *
 * `increment_account_usage` is granted to the service role only, and the
 * voice actions called it with the caller's client, so every call was
 * refused (42501), logged and ignored. The fix keeps the grant and calls it
 * with the server's client, for the account the action has already
 * authorised (KB-46's `LlmJobTarget`), never one the browser names.
 *
 * The real actions, authoriser and spend recorder run. The caller's client
 * answers `increment_account_usage` the way Postgres does for it: 42501.
 */

const ACCOUNT = '44444444-4444-4444-8444-444444444444';
const PROJECT = '55555555-5555-4555-8555-555555555555';
const EPISODE = '66666666-6666-4666-8666-666666666666';
const LINE = '99999999-9999-4999-8999-999999999999';
const CALLER = '77777777-7777-4777-8777-777777777777';

type Row = Record<string, unknown>;

const state = vi.hoisted(() => ({
  adminRpc: [] as Array<{ fn: string; args: Record<string, unknown> }>,
  userRpc: [] as string[],
  adminError: null as null | { message: string },
  vendorCost: 7 as number | undefined,
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

vi.mock('@kit/supabase/server-admin-client', () => ({
  getSupabaseServerAdminClient: () => ({
    rpc: async (fn: string, args: Record<string, unknown>) => {
      state.adminRpc.push({ fn, args });
      return { data: null, error: state.adminError };
    },
  }),
}));

vi.mock('@kit/storage', () => ({
  getStorageAdapter: () => ({
    upload: async () => ({ url: 'https://audio.test/line.mp3' }),
  }),
}));

vi.mock('../src/providers/elevenlabs', () => ({
  ElevenLabsProvider: class {
    async generateVoice() {
      return {
        audioBuffer: Buffer.from('mp3'),
        duration: 1,
        cost: state.vendorCost,
        format: 'mp3',
      };
    }
  },
}));

vi.mock('../src/server/project-audio-settings', () => ({
  getAccountElevenLabsApiKey: async () => 'decrypted-key',
  getProjectTTSModel: async () => 'eleven_multilingual_v2',
}));

// The spend recorder is the subject, so only the lookups around it are faked
vi.mock('../src/server/voice-queries', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/server/voice-queries')>()),
  checkAccountBudget: async () => true,
  getVoiceIdForCharacter: async () => 'voice-1',
  getVoiceSettings: async () => ({ stability: 0.5, similarityBoost: 0.75 }),
}));

const readable: Record<string, Row[]> = {
  episodes: [
    {
      id: EPISODE,
      project_id: PROJECT,
      project: { account_id: ACCOUNT },
      projects: { id: PROJECT, account_id: ACCOUNT },
    },
  ],
  dialogue_lines: [
    {
      id: LINE,
      episode_id: EPISODE,
      text: 'A line',
      character_asset_id: null,
      audio_url: null,
      status: 'pending',
      sequence_number: 1,
      episodes: {
        id: EPISODE,
        project_id: PROJECT,
        projects: { id: PROJECT, account_id: ACCOUNT },
      },
    },
  ],
};

function query(table: string) {
  let rows: Row[] = [...(readable[table] ?? [])];
  let writing = false;
  // A write answers with its rows only when it asks for them (.select()),
  // as PostgREST does: the rows the filters still match (KB-105).
  let selected = false;

  const builder = {
    select: () => {
      selected = true;
      return builder;
    },
    eq: (column: string, value: unknown) => {
      rows = rows.filter((row) => row[column] === value);
      return builder;
    },
    is: () => builder,
    in: () => builder,
    order: () => builder,
    range: () => builder,
    insert: (row: Row) => {
      rows = [{ id: `${table}-new`, ...row }];
      return builder;
    },
    update: () => {
      writing = true;
      return builder;
    },
    single: async () =>
      rows[0]
        ? { data: rows[0], error: null }
        : { data: null, error: { message: 'not found' } },
    maybeSingle: async () => ({ data: rows[0] ?? null, error: null }),
    then: <R>(resolve: (value: { data: Row[] | null; error: null }) => R) =>
      Promise.resolve({
        data: writing && !selected ? null : rows,
        error: null,
      }).then(resolve),
  };

  return builder;
}

vi.mock('@kit/supabase/server-client', () => ({
  getSupabaseServerClient: () => ({
    from: query,
    rpc: async (fn: string, args: { target_project_id?: string }) => {
      state.userRpc.push(fn);

      if (fn === 'can_write_project') {
        return { data: args.target_project_id === PROJECT, error: null };
      }

      // What Postgres answers the caller: EXECUTE is the service role's only
      return {
        data: null,
        error: {
          code: '42501',
          message: `permission denied for function ${fn}`,
        },
      };
    },
  }),
}));

const increments = () =>
  state.adminRpc.filter((call) => call.fn === 'increment_account_usage');

beforeEach(() => {
  state.adminRpc = [];
  state.userRpc = [];
  state.adminError = null;
  state.vendorCost = 7;
});

describe('voice spend is counted (KB-83)', () => {
  it("a completed preview adds its cost to the authorised account's usage", async () => {
    const { generateVoiceFromTextAction } = await import(
      '../src/server/voice-actions'
    );

    const result = await generateVoiceFromTextAction({
      episodeId: EPISODE,
      text: 'Hello',
      voiceId: 'voice-1',
    });

    expect(result).toMatchObject({ ok: true });
    expect(increments()).toEqual([
      {
        fn: 'increment_account_usage',
        args: { p_account_id: ACCOUNT, p_amount_cents: 7 },
      },
    ]);
    expect(state.userRpc).not.toContain('increment_account_usage');
  });

  it("a completed line adds its cost to the authorised account's usage", async () => {
    const { generateDialogueVoiceAction } = await import(
      '../src/server/voice-actions'
    );

    const result = await generateDialogueVoiceAction({
      dialogueLineId: LINE,
    });

    expect(result).toMatchObject({ ok: true });
    expect(increments()).toEqual([
      {
        fn: 'increment_account_usage',
        args: { p_account_id: ACCOUNT, p_amount_cents: 7 },
      },
    ]);
  });

  it('a failed recording does not fail the generation it follows', async () => {
    state.adminError = { message: 'connection reset' };

    const { generateVoiceFromTextAction } = await import(
      '../src/server/voice-actions'
    );

    const result = await generateVoiceFromTextAction({
      episodeId: EPISODE,
      text: 'Hello',
      voiceId: 'voice-1',
    });

    expect(result).toMatchObject({ ok: true });
    expect(increments()).toHaveLength(1);
  });
});

describe('recordVoiceSpend', () => {
  it.each([
    [7, 7],
    [2.1, 3],
  ])('records %s cents as %s', async (amount, recorded) => {
    const { recordVoiceSpend } = await import('../src/server/voice-queries');

    await recordVoiceSpend({ accountId: ACCOUNT } as never, amount);

    expect(increments()).toEqual([
      {
        fn: 'increment_account_usage',
        args: { p_account_id: ACCOUNT, p_amount_cents: recorded },
      },
    ]);
  });

  it.each([0, -5, Number.NaN, Number.POSITIVE_INFINITY])(
    'records nothing for %s',
    async (amount) => {
      const { recordVoiceSpend } = await import('../src/server/voice-queries');

      await recordVoiceSpend({ accountId: ACCOUNT } as never, amount);

      expect(increments()).toEqual([]);
    },
  );
});
