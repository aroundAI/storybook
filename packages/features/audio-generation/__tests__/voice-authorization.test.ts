import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * KB-46 and KB-47 (voice): voice generation runs only on an episode whose
 * project the caller can write to (KB-28's `can_write_project`, asked as the
 * caller).
 *
 * Reading is not enough. A public project's episode is readable by every
 * signed-in user, and a dialogue line by every role on its team — viewers
 * included. The voice worker runs on the service-role key: it decrypts the
 * payload account's ElevenLabs key and writes audio onto the payload's line,
 * so a line queued by a reader was spent and written as if by a writer.
 *
 * The real actions, authoriser and queue helper run. The Supabase client is
 * a fake that answers like RLS; the key lookup, the vendor, storage and the
 * SQS send are spies.
 */

const A_ACCOUNT = '11111111-1111-4111-8111-111111111111';
const A_PROJECT = '22222222-2222-4222-8222-222222222222';
const A_EPISODE = '33333333-3333-4333-8333-333333333333';
const A_LINE = '88888888-8888-4888-8888-888888888888';
const A_BATCH = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const B_ACCOUNT = '44444444-4444-4444-8444-444444444444';
const B_PROJECT = '55555555-5555-4555-8555-555555555555';
const B_EPISODE = '66666666-6666-4666-8666-666666666666';
const B_LINE = '99999999-9999-4999-8999-999999999999';
const B_BATCH = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const C_ACCOUNT = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const CALLER = '77777777-7777-4777-8777-777777777777';

type Row = Record<string, unknown>;

const state = vi.hoisted(() => ({
  readable: {} as Record<string, Array<Record<string, unknown>>>,
  writable: new Set<string>(),
  inserts: [] as string[],
  updates: [] as string[],
  keyReads: [] as string[],
  vendorCalls: 0,
  sent: [] as Array<Record<string, unknown>>,
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
  getSupabaseServerAdminClient: () => ({}),
}));

vi.mock('@kit/storage', () => ({
  getStorageAdapter: () => ({
    upload: async () => ({ url: 'https://audio.test/line.mp3' }),
  }),
  // The gate is @kit/storage's own test; here it passes the write through
  writeProjectObject: async () => ({ url: 'https://audio.test/line.mp3' }),
}));

vi.mock('../src/providers/elevenlabs', () => ({
  ElevenLabsProvider: class {
    async generateVoice() {
      state.vendorCalls += 1;
      return {
        audioBuffer: Buffer.from('mp3'),
        duration: 1,
        cost: 1,
        format: 'mp3',
      };
    }
  },
}));

vi.mock('../src/server/project-audio-settings', () => ({
  getAccountElevenLabsApiKey: async (accountId: string) => {
    state.keyReads.push(accountId);
    return 'decrypted-key';
  },
  getProjectTTSModel: async () => 'eleven_multilingual_v2',
}));

vi.mock('../src/server/voice-queries', () => ({
  checkAccountBudget: async () => true,
  recordVoiceSpend: async () => undefined,
  getVoiceIdForCharacter: async () => 'voice-1',
  getVoiceSettings: async () => ({ stability: 0.5, similarityBoost: 0.75 }),
}));

vi.mock('@aws-sdk/client-sqs', () => {
  class Command {
    constructor(readonly input: Record<string, unknown>) {}
  }

  return {
    SQSClient: class {
      async send(command: Command) {
        const entries = (command.input.Entries as Array<{
          MessageBody: string;
        }>) ?? [{ MessageBody: command.input.MessageBody as string }];

        for (const entry of entries) {
          state.sent.push(JSON.parse(entry.MessageBody));
        }
      }
    },
    SendMessageCommand: Command,
    SendMessageBatchCommand: Command,
  };
});

function query(table: string) {
  let rows: Row[] = [...(state.readable[table] ?? [])];
  let writing = false;

  const builder = {
    select: () => builder,
    eq: (column: string, value: unknown) => {
      rows = rows.filter((row) => row[column] === value);
      return builder;
    },
    is: () => builder,
    not: () => builder,
    in: (column: string, values: unknown[]) => {
      rows = rows.filter((row) => values.includes(row[column]));
      return builder;
    },
    order: () => builder,
    range: (from: number, to: number) => {
      rows = rows.slice(from, to + 1);
      return builder;
    },
    insert: (row: Row) => {
      writing = true;
      state.inserts.push(table);
      rows = [{ id: `${table}-new`, ...row }];
      return builder;
    },
    update: () => {
      writing = true;
      state.updates.push(table);
      return builder;
    },
    single: async () =>
      rows[0]
        ? { data: rows[0], error: null }
        : { data: null, error: { message: 'not found' } },
    maybeSingle: async () => ({ data: rows[0] ?? null, error: null }),
    then: <R>(resolve: (value: { data: Row[] | null; error: null }) => R) =>
      Promise.resolve({ data: writing ? null : rows, error: null }).then(
        resolve,
      ),
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

function episode(id: string, projectId: string, accountId: string): Row {
  return {
    id,
    project_id: projectId,
    project: { account_id: accountId },
    projects: { id: projectId, account_id: accountId },
  };
}

function line(
  id: string,
  episodeId: string,
  projectId: string,
  accountId: string,
): Row {
  return {
    id,
    episode_id: episodeId,
    text: 'A line',
    character_asset_id: null,
    audio_url: null,
    status: 'failed',
    sequence_number: 1,
    episodes: {
      id: episodeId,
      project_id: projectId,
      projects: { id: projectId, account_id: accountId },
    },
  };
}

function batch(id: string, episodeId: string, accountId: string): Row {
  return {
    id,
    episode_id: episodeId,
    account_id: accountId,
    status: 'failed',
    completed_lines: 0,
    failed_lines: 1,
    voice_assignments: {},
  };
}

beforeEach(() => {
  process.env.VOICE_QUEUE_URL = 'https://sqs.test/voice';

  // A's rows are readable to the caller — as a public project's episode is
  // to anyone, and a team's lines are to a project viewer — but only B's
  // project is writable.
  state.readable = {
    episodes: [
      episode(A_EPISODE, A_PROJECT, A_ACCOUNT),
      episode(B_EPISODE, B_PROJECT, B_ACCOUNT),
    ],
    dialogue_lines: [
      line(A_LINE, A_EPISODE, A_PROJECT, A_ACCOUNT),
      line(B_LINE, B_EPISODE, B_PROJECT, B_ACCOUNT),
    ],
    batch_generation_jobs: [
      batch(A_BATCH, A_EPISODE, A_ACCOUNT),
      // A job row names its own account; the caller may belong to C
      batch(B_BATCH, B_EPISODE, C_ACCOUNT),
    ],
  };
  state.writable = new Set([B_PROJECT]);
  state.inserts = [];
  state.updates = [];
  state.keyReads = [];
  state.vendorCalls = 0;
  state.sent = [];
});

describe('generateVoiceFromTextAction (voice preview, KB-46)', () => {
  it('refuses a readable episode the caller cannot write to, before reading its key', async () => {
    const { generateVoiceFromTextAction } = await import(
      '../src/server/voice-actions'
    );

    const result = await generateVoiceFromTextAction({
      episodeId: A_EPISODE,
      text: 'Hello',
      voiceId: 'voice-1',
    });

    expect(result).toEqual({ ok: false, error: 'Episode not found' });
    expect(state.keyReads).toEqual([]);
    expect(state.inserts).toEqual([]);
    expect(state.vendorCalls).toBe(0);
  });

  it('previews on the writer’s own episode, with its account’s key', async () => {
    const { generateVoiceFromTextAction } = await import(
      '../src/server/voice-actions'
    );

    const result = await generateVoiceFromTextAction({
      episodeId: B_EPISODE,
      text: 'Hello',
      voiceId: 'voice-1',
    });

    expect(result).toMatchObject({ ok: true });
    expect(state.keyReads).toEqual([B_ACCOUNT]);
    expect(state.vendorCalls).toBe(1);
  });
});

describe('generateDialogueVoiceAction (one line, sync)', () => {
  it('refuses a readable line the caller cannot write to, before its key or status', async () => {
    const { generateDialogueVoiceAction } = await import(
      '../src/server/voice-actions'
    );

    const result = await generateDialogueVoiceAction({
      dialogueLineId: A_LINE,
    });

    expect(result).toEqual({ ok: false, error: 'Dialogue line not found' });
    expect(state.keyReads).toEqual([]);
    expect(state.updates).toEqual([]);
    expect(state.vendorCalls).toBe(0);
  });

  it('generates the writer’s own line, with its account’s key', async () => {
    const { generateDialogueVoiceAction } = await import(
      '../src/server/voice-actions'
    );

    const result = await generateDialogueVoiceAction({
      dialogueLineId: B_LINE,
    });

    expect(result).toMatchObject({ ok: true, data: { status: 'completed' } });
    expect(state.keyReads).toEqual([B_ACCOUNT]);
    expect(state.vendorCalls).toBe(1);
  });
});

describe('generateDialogueVoiceAsyncAction (one line, voice queue)', () => {
  it('refuses a readable line the caller cannot write to, and queues nothing', async () => {
    const { generateDialogueVoiceAsyncAction } = await import(
      '../src/server/voice-actions'
    );

    const result = await generateDialogueVoiceAsyncAction({
      dialogueLineId: A_LINE,
    });

    expect(result).toEqual({
      success: false,
      status: 'failed',
      error: 'Dialogue line not found',
    });
    expect(state.updates).toEqual([]);
    expect(state.sent).toEqual([]);
  });

  it('queues the writer’s own line, billed to its account', async () => {
    const { generateDialogueVoiceAsyncAction } = await import(
      '../src/server/voice-actions'
    );

    const result = await generateDialogueVoiceAsyncAction({
      dialogueLineId: B_LINE,
    });

    expect(result).toEqual({ success: true, status: 'queued' });
    expect(state.sent).toHaveLength(1);
    expect(state.sent[0]).toMatchObject({
      dialogueLineId: B_LINE,
      episodeId: B_EPISODE,
      accountId: B_ACCOUNT,
    });
  });
});

describe('batchGenerateDialogueAction (voice queue)', () => {
  it('refuses a readable episode the caller cannot write to, and queues nothing', async () => {
    const { batchGenerateDialogueAction } = await import(
      '../src/server/batch-actions'
    );

    const result = await batchGenerateDialogueAction({
      episodeId: A_EPISODE,
    });

    expect(result).toEqual({ ok: false, error: 'Episode not found' });
    expect(state.inserts).toEqual([]);
    expect(state.sent).toEqual([]);
  });

  it('queues the writer’s own episode, billed to its account', async () => {
    const { batchGenerateDialogueAction } = await import(
      '../src/server/batch-actions'
    );

    const result = await batchGenerateDialogueAction({
      episodeId: B_EPISODE,
    });

    expect(result).toMatchObject({ ok: true });
    expect(state.sent).toHaveLength(1);
    expect(state.sent[0]).toMatchObject({
      dialogueLineId: B_LINE,
      episodeId: B_EPISODE,
      accountId: B_ACCOUNT,
    });
  });
});

describe('retryFailedDialogueAction (voice queue)', () => {
  it('refuses a batch on an episode the caller cannot write to, and queues nothing', async () => {
    const { retryFailedDialogueAction } = await import(
      '../src/server/batch-actions'
    );

    await expect(
      retryFailedDialogueAction({ batchJobId: A_BATCH }),
    ).rejects.toThrow('Batch job not found');
    expect(state.updates).toEqual([]);
    expect(state.sent).toEqual([]);
  });

  it('bills the episode’s account, not the account the job row names', async () => {
    const { retryFailedDialogueAction } = await import(
      '../src/server/batch-actions'
    );

    await retryFailedDialogueAction({ batchJobId: B_BATCH });

    expect(state.sent).toHaveLength(1);
    expect(state.sent[0]).toMatchObject({
      episodeId: B_EPISODE,
      accountId: B_ACCOUNT,
    });
  });
});

describe('voiceMessageForTarget', () => {
  it('stamps the target’s account and refuses a job on another episode', async () => {
    const { voiceMessageForTarget } = await import(
      '../src/server/voice-queue-helper'
    );
    const { chainedLlmJobTarget } = await import(
      '@kit/prompt-engine/llm-job-target'
    );

    const target = chainedLlmJobTarget({
      accountId: B_ACCOUNT,
      projectId: B_PROJECT,
      episodeId: B_EPISODE,
    });
    const job = {
      dialogueLineId: B_LINE,
      batchJobId: null,
      episodeId: B_EPISODE,
      voiceId: 'voice-1',
      ttsModel: 'eleven_multilingual_v2',
      voiceSettings: { stability: 0.5, similarityBoost: 0.75 },
      text: 'A line',
      userId: CALLER,
      overwriteExisting: false,
    };

    expect(voiceMessageForTarget(target, job).accountId).toBe(B_ACCOUNT);
    expect(() =>
      voiceMessageForTarget(target, { ...job, episodeId: A_EPISODE }),
    ).toThrow();
  });
});
