import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LLMError } from '@kit/llm';

import { executeLLMForLambda } from '../llm-utils';
import { PROMPT_REGISTRY } from '../prompt-registry';

/**
 * FILM-1902: every model call writes llm_usage_analytics. The worker's copy
 * of the executor made its calls and wrote nothing, so a studio stage run
 * through SQS cost tokens that no account was ever charged for. It now logs
 * as executeLLM does: through the service-role client, on success and on
 * failure, with the job's account and user when the handler passes them.
 */

const mocks = vi.hoisted(() => ({
  createChatCompletion: vi.fn(),
  logLLMUsage: vi.fn(),
  createLambdaAdminClient: vi.fn(),
}));

vi.mock('@kit/llm', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@kit/llm')>()),
  createLLMClient: vi.fn(() => ({
    createChatCompletion: mocks.createChatCompletion,
  })),
  logLLMUsage: mocks.logLLMUsage,
}));

vi.mock('@kit/supabase/lambda-admin-client', () => ({
  createLambdaAdminClient: mocks.createLambdaAdminClient,
}));

const adminClient = { role: 'service_role' };
const ACCOUNT = '11111111-1111-4111-8111-111111111111';
const USER = '22222222-2222-4222-8222-222222222222';
const RUN = '33333333-3333-4333-8333-333333333333';

const slug = 'season-generation';
const variables = Object.fromEntries(
  Object.keys(PROMPT_REGISTRY[slug]!.variables).map((name) => [name, 'x']),
);

describe('executeLLMForLambda writes a usage row (FILM-1902)', () => {
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

  it('logs a successful call through the service-role client with the job’s identity', async () => {
    const result = await executeLLMForLambda<{ ok: boolean }>({
      templateSlug: slug,
      variables,
      accountId: ACCOUNT,
      userId: USER,
      operationName: 'season-analysis',
      runId: RUN,
    });

    expect(result.data).toEqual({ ok: true });
    expect(mocks.logLLMUsage).toHaveBeenCalledTimes(1);
    expect(mocks.logLLMUsage.mock.calls[0]?.[0]).toBe(adminClient);
    expect(mocks.logLLMUsage.mock.calls[0]?.[1]).toMatchObject({
      accountId: ACCOUNT,
      userId: USER,
      runId: RUN,
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

  it('logs a failed call with the provider’s error code, then rethrows', async () => {
    mocks.createChatCompletion.mockRejectedValue(
      new LLMError('quota', 'gemini', 'QUOTA_EXCEEDED', 429),
    );

    await expect(
      executeLLMForLambda({
        templateSlug: slug,
        variables,
        accountId: ACCOUNT,
        userId: USER,
      }),
    ).rejects.toThrow('quota');

    expect(mocks.logLLMUsage).toHaveBeenCalledTimes(1);
    expect(mocks.logLLMUsage.mock.calls[0]?.[0]).toBe(adminClient);
    expect(mocks.logLLMUsage.mock.calls[0]?.[1]).toMatchObject({
      accountId: ACCOUNT,
      userId: USER,
      templateSlug: slug,
      status: 'failure',
      totalTokens: 0,
      errorCode: 'QUOTA_EXCEEDED',
      errorMessage: 'quota',
    });
  });

  it('logs a response the template cannot parse as a failure too', async () => {
    mocks.createChatCompletion.mockResolvedValue({
      message: { role: 'assistant', content: 'not json at all' },
      usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
    });

    await expect(
      executeLLMForLambda({
        templateSlug: slug,
        variables,
        accountId: ACCOUNT,
      }),
    ).rejects.toThrow();

    expect(mocks.logLLMUsage).toHaveBeenCalledTimes(1);
    expect(mocks.logLLMUsage.mock.calls[0]?.[1]).toMatchObject({
      status: 'failure',
      errorCode: 'UNKNOWN_ERROR',
    });
  });

  it('still returns the result when no service-role client can be built', async () => {
    mocks.createLambdaAdminClient.mockReturnValue(null);

    const result = await executeLLMForLambda<{ ok: boolean }>({
      templateSlug: slug,
      variables,
      accountId: ACCOUNT,
    });

    expect(result.data).toEqual({ ok: true });
    expect(mocks.logLLMUsage).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining('usage'),
      expect.anything(),
    );
  });

  it('a call site that passes no identity still writes a row, unattributed', async () => {
    await executeLLMForLambda({ templateSlug: slug, variables });

    expect(mocks.logLLMUsage).toHaveBeenCalledTimes(1);
    expect(mocks.logLLMUsage.mock.calls[0]?.[1]).toMatchObject({
      status: 'success',
      operationName: slug,
    });
    expect(mocks.logLLMUsage.mock.calls[0]?.[1]).toMatchObject({
      accountId: '',
      userId: undefined,
      runId: undefined,
    });
  });
});

describe('every worker handler passes the job’s account to executeLLMForLambda', () => {
  // Handlers that call the executor themselves, plus the stage runtime the
  // `@kit/generation` stages call it through (FILM-1901): story-refinement
  // and asset-creation reach it only via generateWithLambda
  const workerDir = path.resolve(__dirname, '..');
  const callers = [
    ...readdirSync(path.join(workerDir, 'handlers')).map(
      (name) => `handlers/${name}`,
    ),
    'utils/stage-runtime.ts',
  ]
    .filter((name) => name.endsWith('.ts'))
    .map((name) => ({
      name,
      source: readFileSync(path.join(workerDir, name), 'utf8'),
    }))
    .filter(({ source }) => /executeLLMForLambda(<|\()/.test(source));

  it('finds the call sites', () => {
    expect(callers.map((c) => c.name).sort()).toEqual([
      'handlers/screenplay-refinement.ts',
      'handlers/season-analysis.ts',
      'utils/stage-runtime.ts',
    ]);
  });

  it.each(callers.map((c) => [c.name, c.source] as const))(
    '%s passes accountId and userId on every call',
    (_name, source) => {
      const calls = source.split('executeLLMForLambda').slice(1);
      // The import line is not a call
      const callBodies = calls.filter((c) => !c.startsWith(' } from'));

      for (const body of callBodies) {
        // Up to the template variables: `accountId,` shorthand or `accountId:`
        const argument = body.slice(0, body.indexOf('variables:'));
        expect(argument).toMatch(/\baccountId[,:]/);
        expect(argument).toMatch(/\buserId[,:]/);
      }
    },
  );
});
