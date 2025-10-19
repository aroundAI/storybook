import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LLMConfig } from '../src/types';
import { LLMError } from '../src/types';
import { OpenAIClient } from '../src/providers/openai';

// Create mock function at module level
const mockCreate = vi.fn();

// Mock OpenAI SDK
vi.mock('openai', () => {
  return {
    default: vi.fn().mockImplementation(() => ({
      chat: {
        completions: {
          create: mockCreate,
        },
      },
    })),
    APIError: class APIError extends Error {
      constructor(
        message: string,
        public status: number,
        public code: string,
      ) {
        super(message);
        this.name = 'APIError';
      }
    },
  };
});

describe('OpenAIClient', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const createConfig = (overrides?: Partial<LLMConfig>): LLMConfig => ({
    provider: 'openai',
    model: 'gpt-4o-mini',
    apiKey: 'sk-test-key',
    ...overrides,
  });

  describe('Constructor', () => {
    it('should create client with valid config', () => {
      const config = createConfig();
      const client = new OpenAIClient(config);

      expect(client).toBeInstanceOf(OpenAIClient);
      expect(client.getProvider()).toBe('openai');
      expect(client.getModel()).toBe('gpt-4o-mini');
    });

    it('should throw error for non-openai provider', () => {
      const config = createConfig({ provider: 'anthropic' as any });

      expect(() => new OpenAIClient(config)).toThrow(LLMError);
      expect(() => new OpenAIClient(config)).toThrow('Invalid provider');
    });

    it('should store config with API key', () => {
      const config = createConfig({ apiKey: 'sk-custom-key' });
      const client = new OpenAIClient(config);

      // Verify the client was created
      expect(client).toBeInstanceOf(OpenAIClient);
      expect(client.getModel()).toBe('gpt-4o-mini');
    });
  });

  describe('getProvider', () => {
    it('should return openai as provider', () => {
      const client = new OpenAIClient(createConfig());
      expect(client.getProvider()).toBe('openai');
    });
  });

  describe('getModel', () => {
    it('should return configured model', () => {
      const client = new OpenAIClient(createConfig({ model: 'gpt-4o' }));
      expect(client.getModel()).toBe('gpt-4o');
    });

    it('should return model from config', () => {
      const client = new OpenAIClient(
        createConfig({ model: 'gpt-3.5-turbo' }),
      );
      expect(client.getModel()).toBe('gpt-3.5-turbo');
    });
  });

  describe('createChatCompletion', () => {
    it('should create completion successfully', async () => {
      const mockResponse = {
        id: 'chatcmpl-123',
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
          completion_tokens: 20,
          total_tokens: 30,
        },
      };

      mockCreate.mockResolvedValueOnce(mockResponse);

      const client = new OpenAIClient(createConfig());
      const response = await client.createChatCompletion({
        messages: [{ role: 'user', content: 'Hello' }],
      });

      expect(response).toMatchObject({
        id: 'chatcmpl-123',
        provider: 'openai',
        model: 'gpt-4o-mini',
        message: {
          role: 'assistant',
          content: 'Hello! How can I help you?',
        },
        usage: {
          promptTokens: 10,
          completionTokens: 20,
          totalTokens: 30,
        },
        finishReason: 'stop',
      });

      expect(response.cost).toBeDefined();
      expect(response.cost.total).toBeGreaterThan(0);
    });

    it('should pass messages correctly', async () => {
      mockCreate.mockResolvedValueOnce({
        id: 'test',
        choices: [{ message: { content: 'Response' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
      });

      const client = new OpenAIClient(createConfig());
      await client.createChatCompletion({
        messages: [
          { role: 'system', content: 'You are helpful' },
          { role: 'user', content: 'Hello' },
        ],
      });

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: [
            { role: 'system', content: 'You are helpful' },
            { role: 'user', content: 'Hello' },
          ],
        }),
      );
    });

    it('should pass message with name', async () => {
      mockCreate.mockResolvedValueOnce({
        id: 'test',
        choices: [{ message: { content: 'Response' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
      });

      const client = new OpenAIClient(createConfig());
      await client.createChatCompletion({
        messages: [{ role: 'user', content: 'Hello', name: 'John' }],
      });

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: [{ role: 'user', content: 'Hello', name: 'John' }],
        }),
      );
    });

    it('should use request temperature over config', async () => {
      mockCreate.mockResolvedValueOnce({
        id: 'test',
        choices: [{ message: { content: 'Response' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
      });

      const client = new OpenAIClient(
        createConfig({ temperature: 0.5 }),
      );
      await client.createChatCompletion({
        messages: [{ role: 'user', content: 'Hello' }],
        temperature: 0.9,
      });

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          temperature: 0.9,
        }),
      );
    });

    it('should use config temperature when request has none', async () => {
      mockCreate.mockResolvedValueOnce({
        id: 'test',
        choices: [{ message: { content: 'Response' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
      });

      const client = new OpenAIClient(
        createConfig({ temperature: 0.8 }),
      );
      await client.createChatCompletion({
        messages: [{ role: 'user', content: 'Hello' }],
      });

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          temperature: 0.8,
        }),
      );
    });

    it('should default to 0.7 temperature', async () => {
      mockCreate.mockResolvedValueOnce({
        id: 'test',
        choices: [{ message: { content: 'Response' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
      });

      const client = new OpenAIClient(createConfig());
      await client.createChatCompletion({
        messages: [{ role: 'user', content: 'Hello' }],
      });

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          temperature: 0.7,
        }),
      );
    });

    it('should pass maxTokens parameter', async () => {
      mockCreate.mockResolvedValueOnce({
        id: 'test',
        choices: [{ message: { content: 'Response' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
      });

      const client = new OpenAIClient(createConfig());
      await client.createChatCompletion({
        messages: [{ role: 'user', content: 'Hello' }],
        maxTokens: 1000,
      });

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          max_tokens: 1000,
        }),
      );
    });

    it('should pass topP parameter', async () => {
      mockCreate.mockResolvedValueOnce({
        id: 'test',
        choices: [{ message: { content: 'Response' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
      });

      const client = new OpenAIClient(createConfig());
      await client.createChatCompletion({
        messages: [{ role: 'user', content: 'Hello' }],
        topP: 0.9,
      });

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          top_p: 0.9,
        }),
      );
    });

    it('should pass functions parameter', async () => {
      mockCreate.mockResolvedValueOnce({
        id: 'test',
        choices: [{ message: { content: 'Response' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
      });

      const functions = [
        {
          name: 'get_weather',
          description: 'Get weather',
          parameters: { type: 'object' },
        },
      ];

      const client = new OpenAIClient(createConfig());
      await client.createChatCompletion({
        messages: [{ role: 'user', content: 'Weather?' }],
        functions,
      });

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          functions,
        }),
      );
    });

    it('should throw error when no choices returned', async () => {
      mockCreate.mockResolvedValueOnce({
        id: 'test',
        choices: [],
        usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
      });

      const client = new OpenAIClient(createConfig());

      await expect(
        client.createChatCompletion({
          messages: [{ role: 'user', content: 'Hello' }],
        }),
      ).rejects.toThrow();
    });

    it('should throw error when no usage returned', async () => {
      mockCreate.mockResolvedValueOnce({
        id: 'test',
        choices: [{ message: { content: 'Response' }, finish_reason: 'stop' }],
        usage: null,
      });

      const client = new OpenAIClient(createConfig());

      await expect(
        client.createChatCompletion({
          messages: [{ role: 'user', content: 'Hello' }],
        }),
      ).rejects.toThrow();
    });

    it('should handle different finish reasons', async () => {
      const finishReasons = [
        { openai: 'stop', expected: 'stop' },
        { openai: 'length', expected: 'length' },
        { openai: 'function_call', expected: 'function_call' },
        { openai: 'content_filter', expected: 'content_filter' },
        { openai: null, expected: 'stop' },
        { openai: 'unknown', expected: 'stop' },
      ];

      for (const { openai, expected } of finishReasons) {
        mockCreate.mockResolvedValueOnce({
          id: 'test',
          choices: [
            { message: { content: 'Response' }, finish_reason: openai },
          ],
          usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
        });

        const client = new OpenAIClient(createConfig());
        const response = await client.createChatCompletion({
          messages: [{ role: 'user', content: 'Test' }],
        });

        expect(response.finishReason).toBe(expected);
      }
    });

    it('should handle empty message content', async () => {
      mockCreate.mockResolvedValueOnce({
        id: 'test',
        choices: [{ message: { content: null }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
      });

      const client = new OpenAIClient(createConfig());
      const response = await client.createChatCompletion({
        messages: [{ role: 'user', content: 'Hello' }],
      });

      expect(response.message.content).toBe('');
    });

    it('should handle API errors', async () => {
      mockCreate.mockRejectedValueOnce(new Error('API error'));

      const client = new OpenAIClient(createConfig());

      await expect(
        client.createChatCompletion({
          messages: [{ role: 'user', content: 'Hello' }],
        }),
      ).rejects.toThrow();
    });

    it('should handle generic errors', async () => {
      mockCreate.mockRejectedValueOnce(new Error('Network error'));

      const client = new OpenAIClient(createConfig());

      await expect(
        client.createChatCompletion({
          messages: [{ role: 'user', content: 'Hello' }],
        }),
      ).rejects.toThrow();
    });

    it('should handle unknown errors', async () => {
      mockCreate.mockRejectedValueOnce(new Error('Unknown'));

      const client = new OpenAIClient(createConfig());

      await expect(
        client.createChatCompletion({
          messages: [{ role: 'user', content: 'Hello' }],
        }),
      ).rejects.toThrow();
    });
  });

  describe('createStreamingChatCompletion', () => {
    it('should stream completion chunks', async () => {
      const mockStream = (async function* () {
        yield {
          choices: [
            { delta: { content: 'Hello' }, finish_reason: null },
          ],
        };
        yield {
          choices: [
            { delta: { content: ' world' }, finish_reason: null },
          ],
        };
        yield {
          choices: [
            { delta: {}, finish_reason: 'stop' },
          ],
        };
      })();

      mockCreate.mockResolvedValueOnce(mockStream);

      const client = new OpenAIClient(createConfig());
      const stream = client.createStreamingChatCompletion({
        messages: [{ role: 'user', content: 'Hello' }],
      });

      const chunks: string[] = [];
      for await (const chunk of stream) {
        chunks.push(chunk.delta);
      }

      expect(chunks).toEqual(['Hello', ' world', '']);
    });

    it('should pass stream: true parameter', async () => {
      const mockStream = (async function* () {
        yield {
          choices: [{ delta: { content: 'Hi' }, finish_reason: null }],
        };
      })();

      mockCreate.mockResolvedValueOnce(mockStream);

      const client = new OpenAIClient(createConfig());
      const stream = client.createStreamingChatCompletion({
        messages: [{ role: 'user', content: 'Hello' }],
      });

      // Consume stream
      for await (const _ of stream) {
        // Just consume
      }

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          stream: true,
        }),
      );
    });

    it('should handle streaming errors', async () => {
      mockCreate.mockRejectedValueOnce(new Error('Stream error'));

      const client = new OpenAIClient(createConfig());
      const stream = client.createStreamingChatCompletion({
        messages: [{ role: 'user', content: 'Hello' }],
      });

      await expect(async () => {
        for await (const _ of stream) {
          // Should throw before getting here
        }
      }).rejects.toThrow();
    });

    it('should mark last chunk as done', async () => {
      const mockStream = (async function* () {
        yield {
          choices: [{ delta: { content: 'Done' }, finish_reason: 'stop' }],
        };
      })();

      mockCreate.mockResolvedValueOnce(mockStream);

      const client = new OpenAIClient(createConfig());
      const stream = client.createStreamingChatCompletion({
        messages: [{ role: 'user', content: 'Hello' }],
      });

      const chunks: Array<{ delta: string; done: boolean }> = [];
      for await (const chunk of stream) {
        chunks.push(chunk);
      }

      expect(chunks[chunks.length - 1].done).toBe(true);
    });
  });

  describe('calculateCost', () => {
    it('should calculate cost using pricing data', () => {
      const client = new OpenAIClient(
        createConfig({ model: 'gpt-4o' }),
      );
      const cost = client.calculateCost(1000, 500);

      expect(cost).toHaveProperty('prompt');
      expect(cost).toHaveProperty('completion');
      expect(cost).toHaveProperty('total');
      expect(cost.total).toBeGreaterThan(0);
    });

    it('should calculate different costs for different models', () => {
      const client1 = new OpenAIClient(
        createConfig({ model: 'gpt-4o' }),
      );
      const client2 = new OpenAIClient(
        createConfig({ model: 'gpt-4o-mini' }),
      );

      const cost1 = client1.calculateCost(1000, 1000);
      const cost2 = client2.calculateCost(1000, 1000);

      expect(cost1.total).toBeGreaterThan(cost2.total);
    });

    it('should return zero cost for zero tokens', () => {
      const client = new OpenAIClient(createConfig());
      const cost = client.calculateCost(0, 0);

      expect(cost.prompt).toBe(0);
      expect(cost.completion).toBe(0);
      expect(cost.total).toBe(0);
    });
  });
});
