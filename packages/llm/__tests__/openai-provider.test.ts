import OpenAI, { APIError as OpenAIAPIError } from 'openai';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { OpenAIClient } from '../src/providers/openai';
import type { ChatCompletionRequest, LLMConfig } from '../src/types';
import { LLMError } from '../src/types';

// Mock the OpenAI module
const mockCreate = vi.fn();

vi.mock('openai', () => {
  // Mock APIError class
  class MockAPIError extends Error {
    code: string | null;
    status: number | undefined;
    constructor(message: string, status?: number, code?: string | null) {
      super(message);
      this.name = 'APIError';
      this.code = code ?? null;
      this.status = status;
    }
  }

  const MockOpenAI = vi.fn().mockImplementation(() => ({
    chat: {
      completions: {
        create: mockCreate,
      },
    },
  }));

  // Add APIError as a static property
  MockOpenAI.APIError = MockAPIError;

  return {
    default: MockOpenAI,
    APIError: MockAPIError,
  };
});

describe('OpenAIClient', () => {
  let mockConfig: LLMConfig;

  beforeEach(() => {
    vi.clearAllMocks();

    mockConfig = {
      provider: 'openai',
      model: 'gpt-4o-mini',
      apiKey: 'sk-test-key',
      temperature: 0.7,
      maxTokens: 1000,
      topP: 1.0,
    };
  });

  describe('Constructor', () => {
    it('should create client with valid OpenAI config', () => {
      const client = new OpenAIClient(mockConfig);
      expect(client).toBeDefined();
      expect(client.getProvider()).toBe('openai');
      expect(client.getModel()).toBe('gpt-4o-mini');
    });

    it('should throw error when provider is not openai', () => {
      const invalidConfig = { ...mockConfig, provider: 'anthropic' as const };
      expect(() => new OpenAIClient(invalidConfig)).toThrow(LLMError);
      expect(() => new OpenAIClient(invalidConfig)).toThrow(
        'Invalid provider for OpenAI client',
      );
    });

    it('should create client with minimal config', () => {
      const minimalConfig: LLMConfig = {
        provider: 'openai',
        model: 'gpt-4o',
        apiKey: 'sk-test',
      };
      const client = new OpenAIClient(minimalConfig);
      expect(client.getProvider()).toBe('openai');
      expect(client.getModel()).toBe('gpt-4o');
    });
  });

  describe('createChatCompletion', () => {
    it('should create chat completion with valid request', async () => {
      const client = new OpenAIClient(mockConfig);

      // Mock successful OpenAI response
      mockCreate.mockResolvedValue({
        id: 'chatcmpl-123',
        model: 'gpt-4o-mini',
        choices: [
          {
            message: {
              role: 'assistant',
              content: 'Hello! How can I help you?',
            },
            finish_reason: 'stop',
          },
        ],
        usage: {
          prompt_tokens: 10,
          completion_tokens: 9,
          total_tokens: 19,
        },
      });

      const request: ChatCompletionRequest = {
        messages: [{ role: 'user', content: 'Hello' }],
      };

      const response = await client.createChatCompletion(request);

      expect(response).toBeDefined();
      expect(response.id).toBe('chatcmpl-123');
      expect(response.provider).toBe('openai');
      expect(response.model).toBe('gpt-4o-mini');
      expect(response.message.role).toBe('assistant');
      expect(response.message.content).toBe('Hello! How can I help you?');
      expect(response.usage.promptTokens).toBe(10);
      expect(response.usage.completionTokens).toBe(9);
      expect(response.usage.totalTokens).toBe(19);
      expect(response.finishReason).toBe('stop');
      expect(response.cost).toBeDefined();
      expect(response.cost?.total).toBeGreaterThan(0);
    });

    it('should handle system and user messages', async () => {
      const client = new OpenAIClient(mockConfig);

      mockCreate.mockResolvedValue({
        id: 'chatcmpl-456',
        model: 'gpt-4o-mini',
        choices: [
          {
            message: { role: 'assistant', content: 'Response' },
            finish_reason: 'stop',
          },
        ],
        usage: { prompt_tokens: 20, completion_tokens: 5, total_tokens: 25 },
      });

      const request: ChatCompletionRequest = {
        messages: [
          { role: 'system', content: 'You are helpful.' },
          { role: 'user', content: 'Hello' },
        ],
      };

      await client.createChatCompletion(request);

      // Verify the OpenAI API was called with correct messages
      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: [
            { role: 'system', content: 'You are helpful.' },
            { role: 'user', content: 'Hello' },
          ],
        }),
      );
    });

    it('should apply custom temperature and maxTokens', async () => {
      const client = new OpenAIClient(mockConfig);

      mockCreate.mockResolvedValue({
        id: 'chatcmpl-789',
        model: 'gpt-4o-mini',
        choices: [
          {
            message: { role: 'assistant', content: 'Response' },
            finish_reason: 'stop',
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      });

      const request: ChatCompletionRequest = {
        messages: [{ role: 'user', content: 'Test' }],
        temperature: 0.2,
        maxTokens: 100,
        topP: 0.9,
      };

      await client.createChatCompletion(request);

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          temperature: 0.2,
          max_tokens: 100,
          top_p: 0.9,
        }),
      );
    });

    it('should use config defaults when request params not provided', async () => {
      const client = new OpenAIClient(mockConfig);

      mockCreate.mockResolvedValue({
        id: 'chatcmpl-default',
        model: 'gpt-4o-mini',
        choices: [
          {
            message: { role: 'assistant', content: 'Response' },
            finish_reason: 'stop',
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      });

      const request: ChatCompletionRequest = {
        messages: [{ role: 'user', content: 'Test' }],
      };

      await client.createChatCompletion(request);

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          temperature: 0.7, // From config
          max_tokens: 1000, // From config
          top_p: 1.0, // From config
        }),
      );
    });

    it('should handle message with name field', async () => {
      const client = new OpenAIClient(mockConfig);

      mockCreate.mockResolvedValue({
        id: 'chatcmpl-name',
        model: 'gpt-4o-mini',
        choices: [
          {
            message: { role: 'assistant', content: 'Response' },
            finish_reason: 'stop',
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      });

      const request: ChatCompletionRequest = {
        messages: [{ role: 'user', content: 'Hello', name: 'format-guard' }],
      };

      await client.createChatCompletion(request);

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: [{ role: 'user', content: 'Hello', name: 'format-guard' }],
        }),
      );
    });

    it('should handle function calling', async () => {
      const client = new OpenAIClient(mockConfig);

      mockCreate.mockResolvedValue({
        id: 'chatcmpl-func',
        model: 'gpt-4o-mini',
        choices: [
          {
            message: { role: 'assistant', content: 'Response' },
            finish_reason: 'function_call',
          },
        ],
        usage: { prompt_tokens: 50, completion_tokens: 20, total_tokens: 70 },
      });

      const request: ChatCompletionRequest = {
        messages: [{ role: 'user', content: 'What is the weather?' }],
        functions: [
          {
            name: 'get_weather',
            description: 'Get weather',
            parameters: {
              type: 'object',
              properties: {
                location: { type: 'string' },
              },
            },
          },
        ],
      };

      const response = await client.createChatCompletion(request);

      expect(response.finishReason).toBe('function_call');
      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          functions: request.functions,
        }),
      );
    });

    it('should throw error when no choices returned', async () => {
      const client = new OpenAIClient(mockConfig);

      mockCreate.mockResolvedValue({
        id: 'chatcmpl-no-choices',
        model: 'gpt-4o-mini',
        choices: [],
        usage: { prompt_tokens: 10, completion_tokens: 0, total_tokens: 10 },
      });

      const request: ChatCompletionRequest = {
        messages: [{ role: 'user', content: 'Test' }],
      };

      await expect(client.createChatCompletion(request)).rejects.toThrow(
        'No completion choices returned',
      );
    });

    it('should throw error when no usage information returned', async () => {
      const client = new OpenAIClient(mockConfig);

      mockCreate.mockResolvedValue({
        id: 'chatcmpl-no-usage',
        model: 'gpt-4o-mini',
        choices: [
          {
            message: { role: 'assistant', content: 'Response' },
            finish_reason: 'stop',
          },
        ],
        usage: undefined,
      });

      const request: ChatCompletionRequest = {
        messages: [{ role: 'user', content: 'Test' }],
      };

      await expect(client.createChatCompletion(request)).rejects.toThrow(
        'No usage information returned',
      );
    });

    it('should handle different finish reasons', async () => {
      const client = new OpenAIClient(mockConfig);

      const finishReasons: Array<{
        openai: string;
        expected: 'stop' | 'length' | 'function_call' | 'content_filter';
      }> = [
        { openai: 'stop', expected: 'stop' },
        { openai: 'length', expected: 'length' },
        { openai: 'function_call', expected: 'function_call' },
        { openai: 'content_filter', expected: 'content_filter' },
      ];

      for (const { openai, expected } of finishReasons) {
        mockCreate.mockResolvedValue({
          id: `chatcmpl-${openai}`,
          model: 'gpt-4o-mini',
          choices: [
            {
              message: { role: 'assistant', content: 'Response' },
              finish_reason: openai,
            },
          ],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        });

        const response = await client.createChatCompletion({
          messages: [{ role: 'user', content: 'Test' }],
        });

        expect(response.finishReason).toBe(expected);
      }
    });

    it('should default unknown finish reasons to stop', async () => {
      const client = new OpenAIClient(mockConfig);

      mockCreate.mockResolvedValue({
        id: 'chatcmpl-unknown',
        model: 'gpt-4o-mini',
        choices: [
          {
            message: { role: 'assistant', content: 'Response' },
            finish_reason: 'unknown_reason',
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      });

      const response = await client.createChatCompletion({
        messages: [{ role: 'user', content: 'Test' }],
      });

      expect(response.finishReason).toBe('stop');
    });

    it('should handle empty content in response', async () => {
      const client = new OpenAIClient(mockConfig);

      mockCreate.mockResolvedValue({
        id: 'chatcmpl-empty',
        model: 'gpt-4o-mini',
        choices: [
          {
            message: { role: 'assistant', content: null },
            finish_reason: 'stop',
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 0, total_tokens: 10 },
      });

      const response = await client.createChatCompletion({
        messages: [{ role: 'user', content: 'Test' }],
      });

      expect(response.message.content).toBe('');
    });
  });

  describe('createStreamingChatCompletion', () => {
    it('should stream chat completion chunks', async () => {
      const client = new OpenAIClient(mockConfig);

      // Mock streaming response
      const mockStream = {
        async *[Symbol.asyncIterator]() {
          yield {
            choices: [
              {
                delta: { content: 'Hello' },
                finish_reason: null,
              },
            ],
          };
          yield {
            choices: [
              {
                delta: { content: ' there' },
                finish_reason: null,
              },
            ],
          };
          yield {
            choices: [
              {
                delta: { content: '!' },
                finish_reason: 'stop',
              },
            ],
          };
        },
      };

      mockCreate.mockResolvedValue(mockStream);

      const request: ChatCompletionRequest = {
        messages: [{ role: 'user', content: 'Hello' }],
      };

      const chunks: string[] = [];
      let doneCount = 0;

      for await (const chunk of client.createStreamingChatCompletion(request)) {
        if (!chunk.done) {
          chunks.push(chunk.delta);
        } else {
          doneCount++;
        }
      }

      expect(chunks).toEqual(['Hello', ' there', '!']);
      expect(doneCount).toBe(1);
    });

    it('should call OpenAI API with stream: true', async () => {
      const client = new OpenAIClient(mockConfig);

      const mockStream = {
        async *[Symbol.asyncIterator]() {
          yield {
            choices: [{ delta: { content: 'Test' }, finish_reason: 'stop' }],
          };
        },
      };

      mockCreate.mockResolvedValue(mockStream);

      const request: ChatCompletionRequest = {
        messages: [{ role: 'user', content: 'Test' }],
      };

      // Start streaming
      const stream = client.createStreamingChatCompletion(request);
      await stream.next();

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          stream: true,
        }),
      );
    });

    it('should handle streaming with no content delta', async () => {
      const client = new OpenAIClient(mockConfig);

      const mockStream = {
        async *[Symbol.asyncIterator]() {
          yield {
            choices: [
              {
                delta: {},
                finish_reason: null,
              },
            ],
          };
          yield {
            choices: [
              {
                delta: { content: 'Content' },
                finish_reason: 'stop',
              },
            ],
          };
        },
      };

      mockCreate.mockResolvedValue(mockStream);

      const chunks: string[] = [];

      for await (const chunk of client.createStreamingChatCompletion({
        messages: [{ role: 'user', content: 'Test' }],
      })) {
        if (!chunk.done) {
          chunks.push(chunk.delta);
        }
      }

      // Only chunks with content should be yielded
      expect(chunks).toEqual(['Content']);
    });

    it('should apply streaming request parameters', async () => {
      const client = new OpenAIClient(mockConfig);

      const mockStream = {
        async *[Symbol.asyncIterator]() {
          yield {
            choices: [{ delta: { content: 'Test' }, finish_reason: 'stop' }],
          };
        },
      };

      mockCreate.mockResolvedValue(mockStream);

      const request: ChatCompletionRequest = {
        messages: [{ role: 'user', content: 'Test' }],
        temperature: 0.3,
        maxTokens: 50,
        topP: 0.8,
      };

      const stream = client.createStreamingChatCompletion(request);
      await stream.next();

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          temperature: 0.3,
          max_tokens: 50,
          top_p: 0.8,
          stream: true,
        }),
      );
    });
  });

  describe('calculateCost', () => {
    it('should calculate cost for GPT-4o-mini', () => {
      const config: LLMConfig = {
        provider: 'openai',
        model: 'gpt-4o-mini',
        apiKey: 'sk-test',
      };
      const client = new OpenAIClient(config);

      const cost = client.calculateCost(1000, 500);

      expect(cost.prompt).toBeCloseTo(0.00015, 6); // 1000 * 0.15 / 1M
      expect(cost.completion).toBeCloseTo(0.0003, 6); // 500 * 0.60 / 1M
      expect(cost.total).toBeCloseTo(0.00045, 6);
    });

    it('should calculate cost for GPT-4o', () => {
      const config: LLMConfig = {
        provider: 'openai',
        model: 'gpt-4o',
        apiKey: 'sk-test',
      };
      const client = new OpenAIClient(config);

      const cost = client.calculateCost(1000, 500);

      expect(cost.prompt).toBeCloseTo(0.0025, 6); // 1000 * 2.5 / 1M
      expect(cost.completion).toBeCloseTo(0.005, 6); // 500 * 10 / 1M
      expect(cost.total).toBeCloseTo(0.0075, 6);
    });

    it('should handle zero tokens', () => {
      const client = new OpenAIClient(mockConfig);

      const cost = client.calculateCost(0, 0);

      expect(cost.prompt).toBe(0);
      expect(cost.completion).toBe(0);
      expect(cost.total).toBe(0);
    });
  });

  describe('Error Handling', () => {
    it('should handle OpenAI APIError', async () => {
      const client = new OpenAIClient(mockConfig);

      const apiError = new OpenAIAPIError(
        'Invalid API key',
        401,
        'invalid_api_key',
      );

      mockCreate.mockRejectedValue(apiError);

      const request: ChatCompletionRequest = {
        messages: [{ role: 'user', content: 'Test' }],
      };

      await expect(client.createChatCompletion(request)).rejects.toThrow(
        'Invalid API key',
      );
    });

    it('should handle generic Error', async () => {
      const client = new OpenAIClient(mockConfig);

      mockCreate.mockRejectedValue(new Error('Network error'));

      const request: ChatCompletionRequest = {
        messages: [{ role: 'user', content: 'Test' }],
      };

      await expect(client.createChatCompletion(request)).rejects.toThrow(
        'Network error',
      );
    });

    it('should handle unknown error type', async () => {
      const client = new OpenAIClient(mockConfig);

      mockCreate.mockRejectedValue('String error');

      const request: ChatCompletionRequest = {
        messages: [{ role: 'user', content: 'Test' }],
      };

      await expect(client.createChatCompletion(request)).rejects.toThrow(
        'Unknown error occurred',
      );
    });

    it('should handle streaming errors', async () => {
      const client = new OpenAIClient(mockConfig);

      const apiError = new OpenAIAPIError('Rate limit', 429, 'rate_limit');

      mockCreate.mockRejectedValue(apiError);

      await expect(async () => {
        const stream = client.createStreamingChatCompletion({
          messages: [{ role: 'user', content: 'Test' }],
        });
        await stream.next();
      }).rejects.toThrow('Rate limit');
    });
  });

  describe('Integration Tests', () => {
    it('should complete full chat workflow', async () => {
      const client = new OpenAIClient(mockConfig);

      mockCreate.mockResolvedValue({
        id: 'chatcmpl-integration',
        model: 'gpt-4o-mini',
        choices: [
          {
            message: {
              role: 'assistant',
              content: 'TypeScript is a typed superset of JavaScript.',
            },
            finish_reason: 'stop',
          },
        ],
        usage: {
          prompt_tokens: 15,
          completion_tokens: 10,
          total_tokens: 25,
        },
      });

      const response = await client.createChatCompletion({
        messages: [
          { role: 'system', content: 'You are a helpful coding assistant.' },
          { role: 'user', content: 'What is TypeScript?' },
        ],
        temperature: 0.3,
        maxTokens: 100,
      });

      // Verify complete response structure
      expect(response).toMatchObject({
        id: expect.any(String),
        provider: 'openai',
        model: 'gpt-4o-mini',
        message: {
          role: 'assistant',
          content: expect.any(String),
        },
        usage: {
          promptTokens: expect.any(Number),
          completionTokens: expect.any(Number),
          totalTokens: expect.any(Number),
        },
        cost: {
          prompt: expect.any(Number),
          completion: expect.any(Number),
          total: expect.any(Number),
        },
        finishReason: 'stop',
      });

      // Verify cost is calculated
      expect(response.cost?.total).toBeGreaterThan(0);
      expect(response.cost?.prompt).toBeGreaterThan(0);
      expect(response.cost?.completion).toBeGreaterThan(0);
    });
  });
});
