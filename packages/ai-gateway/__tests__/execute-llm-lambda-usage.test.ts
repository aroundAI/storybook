import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { fakeRunHandle } from '@kit/generation/testing';
import { LLMError } from '@kit/llm';

import { GatewayError, executeLLMForLambda, withRun } from '../src';
import { PROMPT_REGISTRY } from '../src/prompts/lambda-registry';

/**
 * FILM-1902: every model call writes llm_usage_analytics with its run id,
 * and no call is made outside an open server run. The Lambda executor logs
 * through the service-role client, on success and on failure, charged to the
 * run's account and user; it refuses an external, expired or cancelled run,
 * and a call with no run at all, before a client is even built.
 */

const mocks = vi.hoisted(() => {
  const createChatCompletion = vi.fn();

  return {
    createChatCompletion,
    // The implementation lives on vi.fn itself, so restoreAllMocks keeps it
    createLLMClient: vi.fn(() => ({ createChatCompletion })),
    logLLMUsage: vi.fn(),
    createLambdaAdminClient: vi.fn(),
  };
});

vi.mock('@kit/llm', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@kit/llm')>()),
  createLLMClient: mocks.createLLMClient,
  logLLMUsage: mocks.logLLMUsage,
}));

vi.mock('@kit/supabase/lambda-admin-client', () => ({
  createLambdaAdminClient: mocks.createLambdaAdminClient,
}));

const adminClient = { role: 'service_role' };
const USER = '22222222-2222-4222-8222-222222222222';

const slug = 'season-generation';
const variables = Object.fromEntries(
  Object.keys(PROMPT_REGISTRY[slug]!.variables).map((name) => [name, 'x']),
);

describe('executeLLMForLambda under a run (FILM-1902)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.stubEnv('GEMINI_API_KEY', 'not-a-real-key');
    vi.stubEnv('DEEPSEEK_API_KEY', 'not-a-real-key');
    vi.stubEnv('OPENAI_API_KEY', 'not-a-real-key');
    vi.stubEnv('ANTHROPIC_API_KEY', 'not-a-real-key');
    mocks.createLambdaAdminClient.mockReturnValue(adminClient);
    mocks.createChatCompletion.mockResolvedValue({
      message: { role: 'assistant', content: '{"ok":true}' },
      usage: { promptTokens: 30, completionTokens: 12, totalTokens: 42 },
      cost: { prompt: 0.003, completion: 0.004, total: 0.007 },
      finishReason: 'stop',
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('logs a successful call through the service-role client with the run’s identity', async () => {
    const { run } = fakeRunHandle();

    const result = await executeLLMForLambda<{ ok: boolean }>({
      run,
      templateSlug: slug,
      variables,
      userId: USER,
      operationName: 'season-analysis',
    });

    expect(result.data).toEqual({ ok: true });
    expect(mocks.logLLMUsage).toHaveBeenCalledTimes(1);
    expect(mocks.logLLMUsage.mock.calls[0]?.[0]).toBe(adminClient);
    expect(mocks.logLLMUsage.mock.calls[0]?.[1]).toMatchObject({
      accountId: run.accountId,
      userId: USER,
      runId: run.id,
      templateSlug: slug,
      operationName: 'season-analysis',
      llmProvider: PROMPT_REGISTRY[slug]!.llm.provider,
      llmModel: PROMPT_REGISTRY[slug]!.llm.model,
      promptTokens: 30,
      completionTokens: 12,
      totalTokens: 42,
      promptCost: 0.003,
      completionCost: 0.004,
      totalCost: 0.007,
      status: 'success',
      responseMetadata: { finishReason: 'stop' },
    });
    expect(mocks.logLLMUsage.mock.calls[0]?.[1]).toHaveProperty('latencyMs');
    expect(mocks.logLLMUsage.mock.calls[0]?.[1]).toHaveProperty(
      'requestConfig.maxTokens',
    );
  });

  it('charges the run’s user when the call site names none', async () => {
    const { run } = fakeRunHandle();

    await executeLLMForLambda({ run, templateSlug: slug, variables });

    expect(mocks.logLLMUsage.mock.calls[0]?.[1]).toMatchObject({
      accountId: run.accountId,
      userId: run.createdBy,
      runId: run.id,
      operationName: slug,
    });
  });

  it('finds the run in scope when none is passed', async () => {
    const { run } = fakeRunHandle();

    const result = await withRun(run, () =>
      executeLLMForLambda<{ ok: boolean }>({ templateSlug: slug, variables }),
    );

    expect(result.data).toEqual({ ok: true });
    expect(mocks.logLLMUsage.mock.calls[0]?.[1]).toMatchObject({
      runId: run.id,
    });
  });

  it('logs a failed call with the provider’s error code, then rethrows', async () => {
    const { run } = fakeRunHandle();
    mocks.createChatCompletion.mockRejectedValue(
      new LLMError('quota', 'gemini', 'QUOTA_EXCEEDED', 429),
    );

    await expect(
      executeLLMForLambda({ run, templateSlug: slug, variables, userId: USER }),
    ).rejects.toThrow('quota');

    expect(mocks.logLLMUsage).toHaveBeenCalledTimes(1);
    expect(mocks.logLLMUsage.mock.calls[0]?.[1]).toMatchObject({
      accountId: run.accountId,
      userId: USER,
      runId: run.id,
      templateSlug: slug,
      status: 'failure',
      totalTokens: 0,
      errorCode: 'QUOTA_EXCEEDED',
      errorMessage: 'quota',
    });
  });

  it('logs a response the template cannot parse as a failure too', async () => {
    const { run } = fakeRunHandle();
    mocks.createChatCompletion.mockResolvedValue({
      message: { role: 'assistant', content: 'not json at all' },
      usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
    });

    await expect(
      executeLLMForLambda({ run, templateSlug: slug, variables }),
    ).rejects.toThrow();

    expect(mocks.logLLMUsage).toHaveBeenCalledTimes(1);
    expect(mocks.logLLMUsage.mock.calls[0]?.[1]).toMatchObject({
      status: 'failure',
      errorCode: 'UNKNOWN_ERROR',
    });
  });

  it('still returns the result when no service-role client can be built', async () => {
    const { run } = fakeRunHandle();
    mocks.createLambdaAdminClient.mockReturnValue(null);

    const result = await executeLLMForLambda<{ ok: boolean }>({
      run,
      templateSlug: slug,
      variables,
    });

    expect(result.data).toEqual({ ok: true });
    expect(mocks.logLLMUsage).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining('usage'),
      expect.anything(),
    );
  });

  describe('refuses before any model call', () => {
    it.each([
      ['an external run', fakeRunHandle({ mode: 'external' })],
      ['a cancelled run', fakeRunHandle({ status: 'cancelled' })],
      ['a committed run', fakeRunHandle({ status: 'committed' })],
      [
        'a run past its lease',
        fakeRunHandle({
          leaseExpiresAt: new Date(Date.now() - 1000).toISOString(),
        }),
      ],
    ])(
      '%s: LLM_FORBIDDEN_EXTERNAL_RUN, no client, no usage row',
      async (_name, { run }) => {
        await expect(
          executeLLMForLambda({ run, templateSlug: slug, variables }),
        ).rejects.toMatchObject({
          name: 'GatewayError',
          code: 'LLM_FORBIDDEN_EXTERNAL_RUN',
        });

        expect(mocks.createLLMClient).not.toHaveBeenCalled();
        expect(mocks.createChatCompletion).not.toHaveBeenCalled();
        expect(mocks.logLLMUsage).not.toHaveBeenCalled();
      },
    );

    it('no run at all: LLM_NO_RUN', async () => {
      await expect(
        executeLLMForLambda({ templateSlug: slug, variables }),
      ).rejects.toSatisfy(
        (error: unknown) =>
          error instanceof GatewayError && error.code === 'LLM_NO_RUN',
      );

      expect(mocks.createLLMClient).not.toHaveBeenCalled();
    });
  });

  it('renews the lease in the same round trip it checks the run', async () => {
    const { run, state } = fakeRunHandle();

    await executeLLMForLambda({ run, templateSlug: slug, variables });

    expect(state.rpcs.map((rpc) => rpc.fn)).toEqual([
      'renew_generation_run_lease',
    ]);
  });
});
