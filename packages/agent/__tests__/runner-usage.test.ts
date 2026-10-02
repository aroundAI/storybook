import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LLMError } from '@kit/llm';

import { runAgent, setAgentUsageLogger } from '../src/runner';
import type {
  AgentConfig,
  AgentRunContext,
  AgentUsageLogger,
} from '../src/types';

/**
 * FILM-1902: every model call writes llm_usage_analytics. The runner's own
 * loop calls were the one path that wrote nothing — the skills' tool calls
 * log through executeLLM, the step that decides which tool to call did not.
 *
 * The agent package has no Supabase client, so it logs through a callback:
 * `runContext.logUsage`, or the process-wide default a host installs with
 * `setAgentUsageLogger` (the LLM worker wires it to logLLMUsage). With
 * neither, the run proceeds and nothing is written.
 */

const mockCreateChatCompletion = vi.fn();

vi.mock('@kit/llm', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@kit/llm')>()),
  createLLMClient: vi.fn(() => ({
    createChatCompletion: mockCreateChatCompletion,
  })),
}));

const ACCOUNT = '11111111-1111-4111-8111-111111111111';
const USER = '22222222-2222-4222-8222-222222222222';
const RUN = '33333333-3333-4333-8333-333333333333';

function makeConfig(overrides?: Partial<AgentConfig>): AgentConfig {
  return {
    name: 'test-agent',
    systemPrompt: 'You are a test agent.',
    tools: [],
    maxSteps: 5,
    budgetLimits: {
      maxTotalTokens: 50000,
      maxCostUSD: 1.0,
      maxLatencyMs: 120000,
    },
    ...overrides,
  };
}

function llmResponse(content: string) {
  return {
    message: { role: 'assistant', content },
    usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
    cost: { prompt: 0.001, completion: 0.002, total: 0.003 },
    finishReason: 'stop',
  };
}

const finalAnswer = llmResponse(
  JSON.stringify({ action: 'final_answer', result: 'ok' }),
);

describe('runAgent writes a usage row per model call (FILM-1902)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.stubEnv('GEMINI_API_KEY', 'not-a-real-key');
  });

  afterEach(() => {
    setAgentUsageLogger(undefined);
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('logs a successful call with the run context, tokens, cost and latency', async () => {
    mockCreateChatCompletion.mockResolvedValueOnce(finalAnswer);
    const logUsage = vi.fn<AgentUsageLogger>(async () => undefined);
    const runContext: AgentRunContext = {
      accountId: ACCOUNT,
      userId: USER,
      runId: RUN,
      logUsage,
    };

    const result = await runAgent(
      makeConfig(),
      { userPrompt: 'hi' },
      runContext,
    );

    expect(result.success).toBe(true);
    expect(logUsage).toHaveBeenCalledTimes(1);
    expect(logUsage.mock.calls[0]?.[0]).toMatchObject({
      accountId: ACCOUNT,
      userId: USER,
      runId: RUN,
      templateSlug: 'agent/test-agent',
      operationName: 'test-agent',
      llmProvider: 'gemini',
      llmModel: 'gemini-3.1-flash-lite',
      promptTokens: 100,
      completionTokens: 50,
      totalTokens: 150,
      promptCost: 0.001,
      completionCost: 0.002,
      totalCost: 0.003,
      status: 'success',
      requestConfig: { step: 1, temperature: 0.3, maxTokens: 4000 },
    });
    expect(logUsage.mock.calls[0]?.[0]).toHaveProperty('latencyMs');
  });

  it('logs one row per loop step, not one per run', async () => {
    mockCreateChatCompletion
      .mockResolvedValueOnce(
        llmResponse(
          JSON.stringify({ action: 'tool_call', tool: 'nope', params: {} }),
        ),
      )
      .mockResolvedValueOnce(finalAnswer);
    const logUsage = vi.fn<AgentUsageLogger>(async () => undefined);

    await runAgent(
      makeConfig(),
      { userPrompt: 'hi' },
      { accountId: ACCOUNT, logUsage },
    );

    expect(logUsage).toHaveBeenCalledTimes(2);
    expect(logUsage.mock.calls[1]?.[0]).toMatchObject({
      requestConfig: { step: 2 },
    });
  });

  it('logs a failed call with the provider error code and message', async () => {
    mockCreateChatCompletion.mockRejectedValueOnce(
      new LLMError('key rejected', 'gemini', 'INVALID_API_KEY', 401),
    );
    const logUsage = vi.fn<AgentUsageLogger>(async () => undefined);

    const result = await runAgent(
      makeConfig(),
      { userPrompt: 'hi' },
      { accountId: ACCOUNT, logUsage },
    );

    expect(result.success).toBe(false);
    expect(logUsage).toHaveBeenCalledTimes(1);
    expect(logUsage.mock.calls[0]?.[0]).toMatchObject({
      accountId: ACCOUNT,
      templateSlug: 'agent/test-agent',
      status: 'failure',
      totalTokens: 0,
      errorCode: 'INVALID_API_KEY',
      errorMessage: 'key rejected',
    });
  });

  it('labels a non-provider failure UNKNOWN_ERROR', async () => {
    mockCreateChatCompletion.mockRejectedValueOnce(new Error('boom'));
    const logUsage = vi.fn<AgentUsageLogger>(async () => undefined);

    await runAgent(
      makeConfig(),
      { userPrompt: 'hi' },
      { accountId: ACCOUNT, logUsage },
    );

    expect(logUsage.mock.calls[0]?.[0]).toMatchObject({
      status: 'failure',
      errorCode: 'UNKNOWN_ERROR',
      errorMessage: 'boom',
    });
  });

  it('runs without any logger, writing nothing', async () => {
    mockCreateChatCompletion.mockResolvedValueOnce(finalAnswer);

    const result = await runAgent(
      makeConfig(),
      { userPrompt: 'hi' },
      { accountId: ACCOUNT },
    );

    expect(result.success).toBe(true);
    expect(result.data).toBe('ok');
  });

  it('a logger that throws does not fail the run', async () => {
    mockCreateChatCompletion.mockResolvedValueOnce(finalAnswer);
    const logUsage = vi.fn<AgentUsageLogger>(async () => {
      throw new Error('analytics down');
    });

    const result = await runAgent(
      makeConfig(),
      { userPrompt: 'hi' },
      { accountId: ACCOUNT, logUsage },
    );

    expect(result.success).toBe(true);
    expect(result.data).toBe('ok');
    expect(logUsage).toHaveBeenCalledTimes(1);
  });

  it('uses the process-wide logger when the run context has none, and the context’s when it has', async () => {
    mockCreateChatCompletion
      .mockResolvedValueOnce(finalAnswer)
      .mockResolvedValueOnce(finalAnswer);
    const processWide = vi.fn<AgentUsageLogger>(async () => undefined);
    const perRun = vi.fn<AgentUsageLogger>(async () => undefined);
    setAgentUsageLogger(processWide);

    await runAgent(makeConfig(), { userPrompt: 'hi' }, { accountId: ACCOUNT });
    await runAgent(
      makeConfig(),
      { userPrompt: 'hi' },
      { accountId: ACCOUNT, logUsage: perRun },
    );

    expect(processWide).toHaveBeenCalledTimes(1);
    expect(perRun).toHaveBeenCalledTimes(1);
  });
});
