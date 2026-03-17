import { describe, expect, it, vi, beforeEach } from 'vitest';

import { z } from 'zod';

import { runAgent } from '../src/runner';
import { createTool, toolSuccess, toolError } from '../src/tool';
import type { AgentConfig } from '../src/types';

// =============================================================================
// MOCK @kit/llm
// =============================================================================

const mockCreateChatCompletion = vi.fn();

vi.mock('@kit/llm', () => ({
    createLLMClient: vi.fn(() => ({
        createChatCompletion: mockCreateChatCompletion,
    })),
}));

// =============================================================================
// HELPERS
// =============================================================================

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

function mockLLMResponse(content: string) {
    return {
        message: { role: 'assistant', content },
        usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
        cost: { input: 0.001, output: 0.002, total: 0.003 },
        finishReason: 'stop',
    };
}

// =============================================================================
// TESTS
// =============================================================================

describe('Agent Runner', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('runAgent — Final Answer', () => {
        it('should return final answer directly when LLM responds with final_answer', async () => {
            mockCreateChatCompletion.mockResolvedValueOnce(
                mockLLMResponse(
                    JSON.stringify({
                        action: 'final_answer',
                        result: { story: 'Once upon a time...' },
                        reasoning: 'Generated the story',
                    }),
                ),
            );

            const result = await runAgent<{ story: string }>(
                makeConfig(),
                { userPrompt: 'Write a story' },
            );

            expect(result.success).toBe(true);
            expect(result.data).toEqual({ story: 'Once upon a time...' });
            expect(result.steps).toHaveLength(1);
            expect(result.steps[0]!.type).toBe('final_answer');
            expect(result.budget.stepCount).toBe(1);
        });

        it('should handle final answer wrapped in code fences', async () => {
            mockCreateChatCompletion.mockResolvedValueOnce(
                mockLLMResponse(
                    '```json\n{"action":"final_answer","result":"hello"}\n```',
                ),
            );

            const result = await runAgent(
                makeConfig(),
                { userPrompt: 'Say hello' },
            );

            expect(result.success).toBe(true);
            expect(result.data).toBe('hello');
        });
    });

    describe('runAgent — Tool Calling', () => {
        it('should execute a tool and continue the loop', async () => {
            const addTool = createTool({
                name: 'add',
                description: 'Adds two numbers',
                parameters: z.object({ a: z.number(), b: z.number() }),
                execute: async ({ a, b }) => toolSuccess(a + b),
            });

            // Step 1: LLM calls the tool
            mockCreateChatCompletion.mockResolvedValueOnce(
                mockLLMResponse(
                    JSON.stringify({
                        action: 'tool_call',
                        tool: 'add',
                        params: { a: 3, b: 4 },
                        reasoning: 'Adding numbers',
                    }),
                ),
            );

            // Step 2: LLM provides final answer
            mockCreateChatCompletion.mockResolvedValueOnce(
                mockLLMResponse(
                    JSON.stringify({
                        action: 'final_answer',
                        result: { sum: 7 },
                        reasoning: 'The sum is 7',
                    }),
                ),
            );

            const result = await runAgent<{ sum: number }>(
                makeConfig({ tools: [addTool] }),
                { userPrompt: 'Add 3 and 4' },
            );

            expect(result.success).toBe(true);
            expect(result.data).toEqual({ sum: 7 });
            expect(result.steps).toHaveLength(2);
            expect(result.steps[0]!.type).toBe('tool_call');
            expect(result.steps[0]!.toolName).toBe('add');
            expect(result.steps[0]!.toolResult?.success).toBe(true);
            expect(result.steps[0]!.toolResult?.data).toBe(7);
            expect(result.steps[1]!.type).toBe('final_answer');
        });

        it('should handle tool execution errors gracefully', async () => {
            const failTool = createTool({
                name: 'fail',
                description: 'Always fails',
                parameters: z.object({}),
                execute: async () => toolError('Something broke'),
            });

            // Step 1: LLM calls failing tool
            mockCreateChatCompletion.mockResolvedValueOnce(
                mockLLMResponse(
                    JSON.stringify({
                        action: 'tool_call',
                        tool: 'fail',
                        params: {},
                    }),
                ),
            );

            // Step 2: LLM handles the error
            mockCreateChatCompletion.mockResolvedValueOnce(
                mockLLMResponse(
                    JSON.stringify({
                        action: 'final_answer',
                        result: { error: 'Tool failed', fallback: 'Used alternative' },
                    }),
                ),
            );

            const result = await runAgent(
                makeConfig({ tools: [failTool] }),
                { userPrompt: 'Try this' },
            );

            expect(result.success).toBe(true);
            expect(result.steps[0]!.toolResult?.success).toBe(false);
            expect(result.steps[0]!.toolResult?.error).toBe('Something broke');
        });

        it('should handle unknown tool calls', async () => {
            // Step 1: LLM calls a nonexistent tool
            mockCreateChatCompletion.mockResolvedValueOnce(
                mockLLMResponse(
                    JSON.stringify({
                        action: 'tool_call',
                        tool: 'nonexistent',
                        params: {},
                    }),
                ),
            );

            // Step 2: LLM recovers with final answer
            mockCreateChatCompletion.mockResolvedValueOnce(
                mockLLMResponse(
                    JSON.stringify({
                        action: 'final_answer',
                        result: 'recovered',
                    }),
                ),
            );

            const result = await runAgent(
                makeConfig(),
                { userPrompt: 'Test unknown tool' },
            );

            expect(result.success).toBe(true);
            expect(result.steps[0]!.toolResult?.success).toBe(false);
            expect(result.steps[0]!.toolResult?.error).toContain('Unknown tool');
        });
    });

    describe('runAgent — Budget Enforcement', () => {
        it('should stop when token budget is exceeded', async () => {
            // Each call uses 150 tokens. With limit 200, second call should exceed.
            mockCreateChatCompletion.mockResolvedValueOnce(
                mockLLMResponse(
                    JSON.stringify({
                        action: 'tool_call',
                        tool: 'dummy',
                        params: {},
                    }),
                ),
            );

            const dummyTool = createTool({
                name: 'dummy',
                description: 'Dummy tool',
                parameters: z.object({}),
                execute: async () => toolSuccess('ok'),
            });

            // Second response — budget now exceeded (150 + 150 = 300 > 200)
            mockCreateChatCompletion.mockResolvedValueOnce(
                mockLLMResponse(
                    JSON.stringify({
                        action: 'tool_call',
                        tool: 'dummy',
                        params: {},
                    }),
                ),
            );

            const result = await runAgent(
                makeConfig({
                    tools: [dummyTool],
                    budgetLimits: {
                        maxTotalTokens: 200,
                        maxCostUSD: 10.0,
                        maxLatencyMs: 120000,
                    },
                }),
                { userPrompt: 'Test budget' },
            );

            expect(result.success).toBe(false);
            expect(result.error).toContain('Token limit exceeded');
        });
    });

    describe('runAgent — Max Steps', () => {
        it('should stop after maxSteps and return failure', async () => {
            const dummyTool = createTool({
                name: 'loop',
                description: 'Tool that causes looping',
                parameters: z.object({}),
                execute: async () => toolSuccess('looping'),
            });

            // All 3 steps call the tool (never reach final_answer)
            for (let i = 0; i < 3; i++) {
                mockCreateChatCompletion.mockResolvedValueOnce(
                    mockLLMResponse(
                        JSON.stringify({
                            action: 'tool_call',
                            tool: 'loop',
                            params: {},
                        }),
                    ),
                );
            }

            const result = await runAgent(
                makeConfig({ tools: [dummyTool], maxSteps: 3 }),
                { userPrompt: 'Keep looping' },
            );

            expect(result.success).toBe(false);
            expect(result.error).toContain('Max steps');
            expect(result.steps).toHaveLength(3);
            expect(result.budget.stepCount).toBe(3);
        });
    });

    describe('runAgent — Parse Error Handling', () => {
        it('should treat unparseable response as final answer', async () => {
            mockCreateChatCompletion.mockResolvedValueOnce(
                mockLLMResponse('This is just plain text, no JSON.'),
            );

            const result = await runAgent(
                makeConfig(),
                { userPrompt: 'Test parse error' },
            );

            // Should succeed with the raw text as data
            expect(result.success).toBe(true);
            expect(result.data).toBe('This is just plain text, no JSON.');
            expect(result.error).toContain('Parse warning');
        });
    });

    describe('runAgent — LLM Error Handling', () => {
        it('should handle LLM call failures', async () => {
            mockCreateChatCompletion.mockRejectedValueOnce(
                new Error('API rate limit exceeded'),
            );

            const result = await runAgent(
                makeConfig(),
                { userPrompt: 'Test error' },
            );

            expect(result.success).toBe(false);
            expect(result.error).toContain('API rate limit exceeded');
        });
    });
});
