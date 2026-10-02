import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { runAgent, setAgentStepWriter } from '@kit/agent';
import { fakeRunHandle } from '@kit/generation/testing';

import { agentStepWriter, agentStepWriterForCurrentRun, withRun } from '../src';

/**
 * FILM-1902 criterion 5: the agent runner takes a write function from the
 * run instead of calling a provider. The gateway's writer checks the run
 * before each step and writes llm_usage_analytics with the run id; an agent
 * loop outside any run is refused before a model is reached.
 */

const mocks = vi.hoisted(() => {
  const createChatCompletion = vi.fn();

  return {
    createChatCompletion,
    // The implementation lives on vi.fn itself, so restoreAllMocks keeps it
    createLLMClient: vi.fn(() => ({ createChatCompletion })),
    logLLMUsage: vi.fn(),
  };
});

vi.mock('@kit/llm', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@kit/llm')>()),
  createLLMClient: mocks.createLLMClient,
  logLLMUsage: mocks.logLLMUsage,
}));

vi.mock('@kit/supabase/lambda-admin-client', () => ({
  createLambdaAdminClient: () => ({ role: 'service_role' }),
}));

const finalAnswer = (result: unknown) => ({
  message: {
    role: 'assistant',
    content: JSON.stringify({ action: 'final_answer', result }),
  },
  usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
  cost: { prompt: 0.001, completion: 0.002, total: 0.003 },
  finishReason: 'stop',
});

const config = {
  name: 'test-agent',
  systemPrompt: 'You are a test agent.',
  tools: [],
  maxSteps: 3,
  budgetLimits: { maxTotalTokens: 50000, maxCostUSD: 1, maxLatencyMs: 120000 },
};

describe('the agent step writer (FILM-1902)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.stubEnv('GEMINI_API_KEY', 'not-a-real-key');
    mocks.createChatCompletion.mockResolvedValue(finalAnswer({ ok: true }));
  });

  afterEach(() => {
    setAgentStepWriter(undefined);
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('runs the agent loop through the run and logs each step with the run id', async () => {
    const { run } = fakeRunHandle();

    const result = await runAgent<{ ok: boolean }>(
      config,
      { userPrompt: 'hi' },
      { accountId: run.accountId, write: agentStepWriter(run) },
    );

    expect(result.success).toBe(true);
    expect(result.data).toEqual({ ok: true });
    expect(mocks.createChatCompletion).toHaveBeenCalledTimes(1);
    expect(mocks.logLLMUsage).toHaveBeenCalledTimes(1);
    expect(mocks.logLLMUsage.mock.calls[0]?.[1]).toMatchObject({
      accountId: run.accountId,
      runId: run.id,
      templateSlug: 'agent/test-agent',
      operationName: 'test-agent',
      totalTokens: 15,
      status: 'success',
      requestConfig: { step: 1 },
    });
  });

  it('refuses an external run before any step', async () => {
    const { run } = fakeRunHandle({ mode: 'external' });

    const result = await runAgent(
      config,
      { userPrompt: 'hi' },
      { accountId: run.accountId, write: agentStepWriter(run) },
    );

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/external/);
    expect(mocks.createLLMClient).not.toHaveBeenCalled();
    expect(mocks.logLLMUsage).not.toHaveBeenCalled();
  });

  it('the process-wide writer reaches the run in scope, and nothing outside one', async () => {
    setAgentStepWriter(agentStepWriterForCurrentRun);
    const { run } = fakeRunHandle();

    const inside = await withRun(run, () =>
      runAgent(config, { userPrompt: 'hi' }, { accountId: run.accountId }),
    );
    expect(inside.success).toBe(true);
    expect(mocks.logLLMUsage.mock.calls[0]?.[1]).toMatchObject({
      runId: run.id,
    });

    const outside = await runAgent(
      config,
      { userPrompt: 'hi' },
      { accountId: run.accountId },
    );
    expect(outside.success).toBe(false);
    expect(outside.error).toMatch(/needs a generation run/);
    expect(mocks.createChatCompletion).toHaveBeenCalledTimes(1);
  });

  it('logs a failed step and reports it', async () => {
    const { run } = fakeRunHandle();
    mocks.createChatCompletion.mockRejectedValue(new Error('boom'));

    const result = await runAgent(
      config,
      { userPrompt: 'hi' },
      { accountId: run.accountId, write: agentStepWriter(run) },
    );

    expect(result.success).toBe(false);
    expect(mocks.logLLMUsage.mock.calls.at(-1)?.[1]).toMatchObject({
      status: 'failure',
      runId: run.id,
      errorMessage: 'boom',
    });
  });
});
