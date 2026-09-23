import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * KB-31, audio producers: a job is queued only on a target whose project the
 * caller can write to (KB-28's `can_write_project`, asked as the caller).
 *
 * Their workers write with the service-role key — translated dialogue lines,
 * audio cues, a cue's generated file on the project's ElevenLabs key — so a
 * row the caller can merely read (a public project's episode) must not be
 * enough. The real authoriser and `payloadForTarget` run; the Supabase
 * client is a fake that answers like RLS; only the SQS send is captured.
 */

const A_ACCOUNT = '11111111-1111-4111-8111-111111111111';
const A_PROJECT = '22222222-2222-4222-8222-222222222222';
const A_EPISODE = '33333333-3333-4333-8333-333333333333';
const A_CUE = '99999999-9999-4999-8999-999999999999';
const B_ACCOUNT = '44444444-4444-4444-8444-444444444444';
const B_PROJECT = '55555555-5555-4555-8555-555555555555';
const B_EPISODE = '66666666-6666-4666-8666-666666666666';
const B_CUE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const CALLER = '77777777-7777-4777-8777-777777777777';

type Row = Record<string, unknown>;

const state = vi.hoisted(() => ({
  readable: {} as Record<string, Array<Record<string, unknown>>>,
  writable: new Set<string>(),
  updates: [] as string[],
  sent: [] as Array<{ jobType: string; payload: Record<string, unknown> }>,
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

vi.mock('@kit/prompt-engine/server', async () => {
  const { payloadForTarget } = await vi.importActual<
    typeof import('../../prompt-engine/src/lib/server/sqs-helper')
  >('../../prompt-engine/src/lib/server/sqs-helper');

  return {
    queueLlmJob: async (job: {
      jobType: string;
      target?: Parameters<typeof payloadForTarget>[0];
      payload: Record<string, unknown>;
    }) => {
      // A call without a target (before KB-31) sends its payload as is
      state.sent.push({
        jobType: job.jobType,
        payload: job.target
          ? payloadForTarget(job.target, job.payload)
          : job.payload,
      });
    },
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
    in: (column: string, values: unknown[]) => {
      rows = rows.filter((row) => values.includes(row[column]));
      return builder;
    },
    order: () => builder,
    range: (from: number, to: number) => {
      rows = rows.slice(from, to + 1);
      return builder;
    },
    insert: () => {
      writing = true;
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
    then: <R>(
      resolve: (value: { data: Row[] | null; error: null; count: number }) => R,
    ) =>
      Promise.resolve({
        data: writing ? null : rows,
        error: null,
        count: rows.length,
      }).then(resolve),
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
  };
}

function cue(id: string, episodeId: string, projectId: string): Row {
  return {
    id,
    episode_id: episodeId,
    cue_type: 'music',
    prompt: 'A cue',
    duration_seconds: 10,
    start_offset_seconds: 0,
    episodes: { seasons: { project_id: projectId } },
  };
}

beforeEach(() => {
  // A's rows are readable to the caller, as a public project's are; only
  // B's project is writable.
  state.readable = {
    episodes: [
      episode(A_EPISODE, A_PROJECT, A_ACCOUNT),
      episode(B_EPISODE, B_PROJECT, B_ACCOUNT),
    ],
    audio_cues: [
      cue(A_CUE, A_EPISODE, A_PROJECT),
      cue(B_CUE, B_EPISODE, B_PROJECT),
    ],
    shots: [
      { id: 'a-shot', episode_id: A_EPISODE },
      { id: 'b-shot', episode_id: B_EPISODE },
    ],
  };
  state.writable = new Set([B_PROJECT]);
  state.updates = [];
  state.sent = [];
});

describe('translateDialogueToLanguageAction', () => {
  it('refuses a readable episode the caller cannot write to, and queues nothing', async () => {
    const { translateDialogueToLanguageAction } = await import(
      '../src/server/translate-dialogue-action'
    );

    const result = await translateDialogueToLanguageAction({
      episodeId: A_EPISODE,
      targetLanguage: 'es',
      preserveTiming: true,
    });

    expect(result).toMatchObject({
      success: false,
      error: 'Episode not found',
    });
    expect(state.sent).toEqual([]);
  });

  it('queues the writer’s own episode, billed to its account', async () => {
    const { translateDialogueToLanguageAction } = await import(
      '../src/server/translate-dialogue-action'
    );

    await translateDialogueToLanguageAction({
      episodeId: B_EPISODE,
      targetLanguage: 'es',
      preserveTiming: true,
    });

    expect(state.sent).toHaveLength(1);
    expect(state.sent[0]!.payload.accountId).toBe(B_ACCOUNT);
  });
});

describe('generateAudioCuesAction', () => {
  it('refuses a readable episode the caller cannot write to, and queues nothing', async () => {
    const { generateAudioCuesAction } = await import(
      '../src/server/audio-cue-actions'
    );

    const result = await generateAudioCuesAction({ episodeId: A_EPISODE });

    expect(result).toMatchObject({ success: false, queued: false });
    expect(state.sent).toEqual([]);
  });

  it('queues the writer’s own episode, billed to its account', async () => {
    const { generateAudioCuesAction } = await import(
      '../src/server/audio-cue-actions'
    );

    await generateAudioCuesAction({ episodeId: B_EPISODE });

    expect(state.sent).toHaveLength(1);
    expect(state.sent[0]!.payload.accountId).toBe(B_ACCOUNT);
  });
});

describe('generateAudioForCueAction', () => {
  it('refuses a cue on a project the caller cannot write to, before marking it generating', async () => {
    const { generateAudioForCueAction } = await import(
      '../src/server/audio-cue-actions'
    );

    const result = await generateAudioForCueAction({ cueId: A_CUE });

    expect(result).toMatchObject({ success: false, status: 'failed' });
    expect(state.updates).toEqual([]);
    expect(state.sent).toEqual([]);
  });

  it('queues the writer’s own cue, on its project', async () => {
    const { generateAudioForCueAction } = await import(
      '../src/server/audio-cue-actions'
    );

    await generateAudioForCueAction({ cueId: B_CUE });

    expect(state.sent).toHaveLength(1);
    expect(state.sent[0]!.payload).toMatchObject({
      projectId: B_PROJECT,
      accountId: B_ACCOUNT,
    });
  });
});
