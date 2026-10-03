import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { fakeRunHandle } from '@kit/generation/testing';

import { GatewayError, embedForServerRun, serverEmbedder } from '../src';
import { VOYAGE_EMBEDDING_DIMENSIONS } from '../src/embedding/voyage-embedder';

/**
 * FILM-1902: the Voyage embedder is a model call too, so each request writes
 * one llm_usage_analytics row with the run's id, on success and on failure.
 * Every request here goes to a fake fetch; no key in this file is real.
 */

const mocks = vi.hoisted(() => ({
  logLLMUsage: vi.fn(),
  createLambdaAdminClient: vi.fn(),
}));

vi.mock('@kit/llm', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@kit/llm')>()),
  logLLMUsage: mocks.logLLMUsage,
}));

vi.mock('@kit/supabase/lambda-admin-client', () => ({
  createLambdaAdminClient: mocks.createLambdaAdminClient,
}));

const adminClient = { role: 'service_role' };
const KEY = 'test-key-not-real';

function vector() {
  return Array.from({ length: VOYAGE_EMBEDDING_DIMENSIONS }, () => 0);
}

function voyageResponse(count: number, usage: unknown = { total_tokens: 17 }) {
  return vi.fn(
    async () =>
      new Response(
        JSON.stringify({
          data: Array.from({ length: count }, (_, index) => ({
            embedding: vector(),
            index,
          })),
          usage,
        }),
      ),
  );
}

describe('the embedder writes a usage row with its run (FILM-1902)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mocks.createLambdaAdminClient.mockReturnValue(adminClient);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('one request, one row: run id, voyage, the model, the tokens Voyage reported', async () => {
    const { run } = fakeRunHandle();

    await embedForServerRun(run, ['one', 'two'], {
      apiKey: KEY,
      fetchImpl: voyageResponse(2),
    });

    expect(mocks.logLLMUsage).toHaveBeenCalledTimes(1);
    expect(mocks.logLLMUsage.mock.calls[0]?.[0]).toBe(adminClient);
    const row = mocks.logLLMUsage.mock.calls[0]?.[1];
    expect(row).toMatchObject({
      accountId: run.accountId,
      userId: run.createdBy,
      runId: run.id,
      operationName: 'embedding',
      llmProvider: 'voyage',
      llmModel: 'voyage-3-large',
      promptTokens: 17,
      completionTokens: 0,
      totalTokens: 17,
      status: 'success',
      requestConfig: { inputType: 'document', inputCount: 2 },
    });
    expect(row).toHaveProperty('latencyMs');
    // No Voyage price is known: absent, never 0
    expect(row.totalCost).toBeUndefined();
  });

  it('a query embedding writes its own row', async () => {
    const { run } = fakeRunHandle();
    const embedder = serverEmbedder({
      run,
      apiKey: KEY,
      fetchImpl: voyageResponse(1, { total_tokens: 5 }),
    })!;

    await embedder.embedQuery('who');

    expect(mocks.logLLMUsage).toHaveBeenCalledTimes(1);
    expect(mocks.logLLMUsage.mock.calls[0]?.[1]).toMatchObject({
      runId: run.id,
      totalTokens: 5,
      requestConfig: { inputType: 'query', inputCount: 1 },
    });
  });

  it('a response without usage is flagged, not given invented tokens', async () => {
    const { run } = fakeRunHandle();

    await embedForServerRun(run, ['one'], {
      apiKey: KEY,
      fetchImpl: voyageResponse(1, null),
    });

    expect(mocks.logLLMUsage.mock.calls[0]?.[1]).toMatchObject({
      status: 'success',
      responseMetadata: { tokensReported: false },
    });
  });

  it('a failed request writes a failure row with the error, then rethrows', async () => {
    const { run } = fakeRunHandle();
    const fetchImpl = vi.fn(async () => new Response('{}', { status: 429 }));

    await expect(
      embedForServerRun(run, ['one'], { apiKey: KEY, fetchImpl }),
    ).rejects.toThrow('HTTP 429');

    expect(mocks.logLLMUsage).toHaveBeenCalledTimes(1);
    expect(mocks.logLLMUsage.mock.calls[0]?.[1]).toMatchObject({
      runId: run.id,
      llmProvider: 'voyage',
      status: 'failure',
      totalTokens: 0,
      errorCode: 'HTTP_429',
      errorMessage: 'HTTP 429',
    });
  });

  it('an unusable body is a failure row too', async () => {
    const { run } = fakeRunHandle();

    await expect(
      embedForServerRun(run, ['one', 'two'], {
        apiKey: KEY,
        fetchImpl: voyageResponse(1),
      }),
    ).rejects.toThrow();

    expect(mocks.logLLMUsage.mock.calls[0]?.[1]).toMatchObject({
      status: 'failure',
      errorCode: 'VOYAGE_EMBEDDING_ERROR',
    });
  });

  it('an external run is refused before any request, with no row', async () => {
    const { run } = fakeRunHandle({ mode: 'external' });
    const fetchImpl = voyageResponse(1);

    await expect(
      embedForServerRun(run, ['one'], { apiKey: KEY, fetchImpl }),
    ).rejects.toMatchObject({ code: 'LLM_FORBIDDEN_EXTERNAL_RUN' });

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(mocks.logLLMUsage).not.toHaveBeenCalled();
  });

  it('no run at all: LLM_NO_RUN, no request, no row', () => {
    expect(() => serverEmbedder({ apiKey: KEY })).toThrow(GatewayError);
    expect(mocks.logLLMUsage).not.toHaveBeenCalled();
  });
});
