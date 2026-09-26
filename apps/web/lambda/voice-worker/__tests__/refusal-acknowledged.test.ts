import type { SQSEvent } from 'aws-lambda';
import { beforeAll, describe, expect, it, vi } from 'vitest';

/**
 * KB-118 follow-up. A dialogue line outside the job's episode is refused
 * (`DialogueLineRefused`). A refusal is an answer, not a fault: the worker
 * acknowledges it like any other `QueuedJobRefused` (#384), instead of
 * failing the message so SQS retries it three times into the dead-letter
 * queue.
 *
 * The real handler, access check and voice handler run; Supabase answers
 * like the database for a job whose user may write the project but whose
 * line is in another episode. AWS and WebSocket delivery are stubbed.
 */

const ACCOUNT = '44444444-4444-4444-8444-444444444444';
const PROJECT = '55555555-5555-4555-8555-555555555555';
const EPISODE = '66666666-6666-4666-8666-666666666666';
const OTHER_EPISODE = '77777777-7777-4777-8777-777777777777';
const LINE = '99999999-9999-4999-8999-999999999999';
const USER = '11111111-1111-4111-8111-111111111111';

const state = vi.hoisted(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://supabase.test';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key';
  return { lineUpdates: 0, vendorCalls: 0 };
});

vi.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: {
    from: () => ({ send: async () => ({ Items: [] }) }),
  },
  QueryCommand: class {},
  DeleteCommand: class {},
}));
vi.mock('@aws-sdk/client-dynamodb', () => ({ DynamoDBClient: class {} }));
vi.mock('@aws-sdk/client-apigatewaymanagementapi', () => ({
  ApiGatewayManagementApiClient: class {},
  PostToConnectionCommand: class {},
}));
vi.mock('../../llm-worker/utils/r2-storage', () => ({
  uploadToR2: async () => ({ url: 'https://audio.test/line.mp3' }),
}));

const rows: Record<string, Record<string, unknown>> = {
  episodes: { project_id: PROJECT, deleted_at: null },
  projects: { account_id: ACCOUNT },
  dialogue_lines: { episode_id: OTHER_EPISODE },
};

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from(table: string) {
      let updating = false;
      const chain = {
        select: () => chain,
        eq: () => chain,
        update: () => {
          updating = true;
          return chain;
        },
        maybeSingle: async () => ({ data: rows[table] ?? null, error: null }),
        single: async () => ({ data: null, error: { message: 'no key' } }),
        then: <R>(resolve: (value: { error: null }) => R) => {
          if (updating && table === 'dialogue_lines') state.lineUpdates += 1;
          return Promise.resolve({ error: null }).then(resolve);
        },
      };
      return chain;
    },
    rpc: async (fn: string) =>
      fn === 'can_user_write_project'
        ? { data: true, error: null }
        : { data: { is_complete: false }, error: null },
  }),
}));

function event(): SQSEvent {
  return {
    Records: [
      {
        messageId: 'm1',
        body: JSON.stringify({
          dialogueLineId: LINE,
          batchJobId: null,
          episodeId: EPISODE,
          accountId: ACCOUNT,
          userId: USER,
          text: 'Hello',
          voiceId: 'voice-1',
          ttsModel: 'eleven_multilingual_v2',
          voiceSettings: { stability: 0.5, similarityBoost: 0.75 },
          overwriteExisting: false,
        }),
      },
    ],
  } as SQSEvent;
}

let handler: (event: SQSEvent) => Promise<{
  batchItemFailures: Array<{ itemIdentifier: string }>;
}>;

beforeAll(async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      state.vendorCalls += 1;
      return new Response(new Uint8Array([1]));
    }),
  );
  ({ handler } = await import('../index'));
});

describe('a dialogue line of another episode', () => {
  it('is acknowledged, not sent back for retries', async () => {
    const result = await handler(event());

    expect(result.batchItemFailures).toEqual([]);
    expect(state.lineUpdates).toBe(0);
    expect(state.vendorCalls).toBe(0);
  });
});
