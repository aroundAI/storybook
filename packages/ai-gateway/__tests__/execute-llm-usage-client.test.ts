import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { LLMExecutionConfig } from '../src/lib/types';

// KB-52. `llm_usage_analytics` accepts writes from the service role only. Three
// callers used to hand `executeLLM` the signed-in user's own client, and their
// usage rows were written only because a policy let any user write any row.
// With that policy gone, a session client's insert is refused — and
// `logLLMUsage` swallows the error, so the row would vanish without a trace.
// These tests pin the one rule that prevents it: the executor always logs
// through the service-role client, whatever a caller passes.

const adminClient = { role: 'service_role' };
const sessionClient = { role: 'authenticated' };

const mocks = vi.hoisted(() => ({
  logLLMUsage: vi.fn(),
  createChatCompletion: vi.fn(),
  loadAndRenderPrompt: vi.fn(),
  createLambdaAdminClient: vi.fn(),
  logError: vi.fn(),
}));

vi.mock('@kit/llm', () => ({
  LLMError: class LLMError extends Error {
    code = 'LLM_ERROR';
  },
  createLLMClient: () => ({ createChatCompletion: mocks.createChatCompletion }),
  forcedLocalConfig: () => null,
  logLLMUsage: mocks.logLLMUsage,
}));

vi.mock('@kit/shared/logger', () => ({
  getLogger: async () => ({
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    error: mocks.logError,
  }),
}));

vi.mock('@kit/supabase/lambda-admin-client', () => ({
  createLambdaAdminClient: mocks.createLambdaAdminClient,
}));

vi.mock('../src/lib/server/prompt-loader', () => ({
  loadAndRenderPrompt: mocks.loadAndRenderPrompt,
}));

const { executeLLM } = await import('../src/lib/server/llm-executor');

const ACCOUNT_ID = '52000000-0000-4000-8000-000000000010';

// A caller that still tries to inject its own session client. The field no
// longer exists on the type; the cast is how a stale or untyped caller (the
// lambdas are outside tsc until KB-14) would still reach the executor.
const config = {
  templateSlug: 'kb52-probe',
  variables: {},
  context: { name: 'kb52-probe', accountId: ACCOUNT_ID },
  supabaseClient: sessionClient,
} as LLMExecutionConfig;

describe('executeLLM usage logging (KB-52)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createLambdaAdminClient.mockReturnValue(adminClient);
    mocks.loadAndRenderPrompt.mockResolvedValue({
      systemPrompt: 'system',
      userPrompt: 'user',
      version: 1,
      llmConfig: { provider: 'local', model: 'stub' },
    });
    mocks.createChatCompletion.mockResolvedValue({
      message: { content: '{"ok":true}' },
      usage: { promptTokens: 3, completionTokens: 2, totalTokens: 5 },
      finishReason: 'stop',
    });
  });

  it('logs a successful call through the service-role client, never the caller’s', async () => {
    const result = await executeLLM<{ ok: boolean }>(config);

    expect(result.data).toEqual({ ok: true });
    expect(mocks.logLLMUsage).toHaveBeenCalledTimes(1);
    expect(mocks.logLLMUsage.mock.calls[0]?.[0]).toBe(adminClient);
    expect(mocks.logLLMUsage.mock.calls[0]?.[1]).toMatchObject({
      accountId: ACCOUNT_ID,
      status: 'success',
      totalTokens: 5,
    });
  });

  it('logs a failed call through the service-role client, never the caller’s', async () => {
    mocks.loadAndRenderPrompt.mockRejectedValue(new Error('template missing'));

    await expect(executeLLM(config)).rejects.toThrow('template missing');

    expect(mocks.logLLMUsage).toHaveBeenCalledTimes(1);
    expect(mocks.logLLMUsage.mock.calls[0]?.[0]).toBe(adminClient);
    expect(mocks.logLLMUsage.mock.calls[0]?.[1]).toMatchObject({
      accountId: ACCOUNT_ID,
      status: 'failure',
      errorMessage: 'template missing',
    });
  });

  it('still returns the result, and says why, when no service-role client can be built', async () => {
    mocks.createLambdaAdminClient.mockReturnValue(null);

    const result = await executeLLM<{ ok: boolean }>(config);

    expect(result.data).toEqual({ ok: true });
    expect(mocks.logLLMUsage).not.toHaveBeenCalled();
    expect(mocks.logError).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.objectContaining({
          message: expect.stringContaining('Service-role client unavailable'),
        }),
      }),
      'Failed to log LLM usage analytics',
    );
  });
});
