import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LLMConfig } from '../src/types';
import { AnthropicClient } from '../src/providers/anthropic';

// Create mock function at module level
const mockCreate = vi.fn();

// Mock Anthropic SDK
vi.mock('@anthropic-ai/sdk', () => {
  return {
    default: vi.fn().mockImplementation(() => ({
      messages: {
        create: mockCreate,
      },
    })),
    APIError: class APIError extends Error {
      constructor(
        message: string,
        public status: number,
      ) {
        super(message);
        this.name = 'APIError';
      }
    },
  };
});

describe('AnthropicClient', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const createConfig = (overrides?: Partial<LLMConfig>): LLMConfig => ({
    provider: 'anthropic',
    model: 'claude-3-5-sonnet-20241022',
    apiKey: 'sk-ant-test-key',
    ...overrides,
  });

  describe('Constructor', () => {
    it('should create client with valid config', () => {
      const config = createConfig();
      const client = new AnthropicClient(config);

      expect(client).toBeInstanceOf(AnthropicClient);
      expect(client.getProvider()).toBe('anthropic');
      expect(client.getModel()).toBe('claude-3-5-sonnet-20241022');
    });

    it('should throw error for non-anthropic provider', () => {
      const config = createConfig({ provider: 'openai' as any });

      expect(() => new AnthropicClient(config)).toThrow();
      expect(() => new AnthropicClient(config)).toThrow('Invalid provider');
    });

    it('should store config correctly', () => {
      const config = createConfig({ apiKey: 'sk-ant-custom' });
      const client = new AnthropicClient(config);

      expect(client).toBeInstanceOf(AnthropicClient);
      expect(client.getModel()).toBe('claude-3-5-sonnet-20241022');
    });
  });

  describe('getProvider', () => {
    it('should return anthropic as provider', () => {
      const client = new AnthropicClient(createConfig());
      expect(client.getProvider()).toBe('anthropic');
    });
  });

  describe('getModel', () => {
    it('should return configured model', () => {
      const client = new AnthropicClient(
        createConfig({ model: 'claude-3-opus-20240229' }),
      );
      expect(client.getModel()).toBe('claude-3-opus-20240229');
    });

    it('should return haiku model', () => {
      const client = new AnthropicClient(
        createConfig({ model: 'claude-3-haiku-20240307' }),
      );
      expect(client.getModel()).toBe('claude-3-haiku-20240307');
    });
  });

  describe('createChatCompletion', () => {
    it('should create completion successfully', async () => {
      const mockResponse = {
        id: 'msg_123',
        content: [
          {
            type: 'text',
            text: 'Hello! How can I help you?',
          },
        ],
        usage: {
          input_tokens: 10,
          output_tokens: 20,
        },
        stop_reason: 'end_turn',
      };

      mockCreate.mockResolvedValueOnce(mockResponse);

      const client = new AnthropicClient(createConfig());
      const response = await client.createChatCompletion({
        messages: [{ role: 'user', content: 'Hello' }],
      });

      expect(response).toMatchObject({
        id: 'msg_123',
        provider: 'anthropic',
        model: 'claude-3-5-sonnet-20241022',
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

    it('should extract and pass system message separately', async () => {
      mockCreate.mockResolvedValueOnce({
        id: 'test',
        content: [{ type: 'text', text: 'Response' }],
        usage: { input_tokens: 10, output_tokens: 10 },
        stop_reason: 'end_turn',
      });

      const client = new AnthropicClient(createConfig());
      await client.createChatCompletion({
        messages: [
          { role: 'system', content: 'You are helpful' },
          { role: 'user', content: 'Hello' },
        ],
      });

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          system: 'You are helpful',
          messages: [{ role: 'user', content: 'Hello' }],
        }),
      );
    });

    it('should handle messages without system message', async () => {
      mockCreate.mockResolvedValueOnce({
        id: 'test',
        content: [{ type: 'text', text: 'Response' }],
        usage: { input_tokens: 10, output_tokens: 10 },
        stop_reason: 'end_turn',
      });

      const client = new AnthropicClient(createConfig());
      await client.createChatCompletion({
        messages: [{ role: 'user', content: 'Hello' }],
      });

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          system: undefined,
          messages: [{ role: 'user', content: 'Hello' }],
        }),
      );
    });

    it('should map assistant role correctly', async () => {
      mockCreate.mockResolvedValueOnce({
        id: 'test',
        content: [{ type: 'text', text: 'Response' }],
        usage: { input_tokens: 10, output_tokens: 10 },
        stop_reason: 'end_turn',
      });

      const client = new AnthropicClient(createConfig());
      await client.createChatCompletion({
        messages: [
          { role: 'user', content: 'Hi' },
          { role: 'assistant', content: 'Hello' },
          { role: 'user', content: 'How are you?' },
        ],
      });

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: [
            { role: 'user', content: 'Hi' },
            { role: 'assistant', content: 'Hello' },
            { role: 'user', content: 'How are you?' },
          ],
        }),
      );
    });

    it('should use request temperature over config', async () => {
      mockCreate.mockResolvedValueOnce({
        id: 'test',
        content: [{ type: 'text', text: 'Response' }],
        usage: { input_tokens: 10, output_tokens: 10 },
        stop_reason: 'end_turn',
      });

      const client = new AnthropicClient(
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

    it('should default to 0.7 temperature', async () => {
      mockCreate.mockResolvedValueOnce({
        id: 'test',
        content: [{ type: 'text', text: 'Response' }],
        usage: { input_tokens: 10, output_tokens: 10 },
        stop_reason: 'end_turn',
      });

      const client = new AnthropicClient(createConfig());
      await client.createChatCompletion({
        messages: [{ role: 'user', content: 'Hello' }],
      });

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          temperature: 0.7,
        }),
      );
    });

    it('should default to 1024 max_tokens', async () => {
      mockCreate.mockResolvedValueOnce({
        id: 'test',
        content: [{ type: 'text', text: 'Response' }],
        usage: { input_tokens: 10, output_tokens: 10 },
        stop_reason: 'end_turn',
      });

      const client = new AnthropicClient(createConfig());
      await client.createChatCompletion({
        messages: [{ role: 'user', content: 'Hello' }],
      });

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          max_tokens: 1024,
        }),
      );
    });

    it('should use provided maxTokens', async () => {
      mockCreate.mockResolvedValueOnce({
        id: 'test',
        content: [{ type: 'text', text: 'Response' }],
        usage: { input_tokens: 10, output_tokens: 10 },
        stop_reason: 'end_turn',
      });

      const client = new AnthropicClient(createConfig());
      await client.createChatCompletion({
        messages: [{ role: 'user', content: 'Hello' }],
        maxTokens: 2000,
      });

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          max_tokens: 2000,
        }),
      );
    });

    it('should pass topP parameter', async () => {
      mockCreate.mockResolvedValueOnce({
        id: 'test',
        content: [{ type: 'text', text: 'Response' }],
        usage: { input_tokens: 10, output_tokens: 10 },
        stop_reason: 'end_turn',
      });

      const client = new AnthropicClient(createConfig());
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

    it('should handle different finish reasons', async () => {
      const finishReasons = [
        { anthropic: 'end_turn', expected: 'stop' },
        { anthropic: 'max_tokens', expected: 'length' },
        { anthropic: 'stop_sequence', expected: 'stop' },
        { anthropic: null, expected: 'stop' },
        { anthropic: 'unknown', expected: 'stop' },
      ];

      for (const { anthropic, expected } of finishReasons) {
        mockCreate.mockResolvedValueOnce({
          id: 'test',
          content: [{ type: 'text', text: 'Response' }],
          usage: { input_tokens: 10, output_tokens: 10 },
          stop_reason: anthropic,
        });

        const client = new AnthropicClient(createConfig());
        const response = await client.createChatCompletion({
          messages: [{ role: 'user', content: 'Test' }],
        });

        expect(response.finishReason).toBe(expected);
      }
    });

    it('should throw error when no text content', async () => {
      mockCreate.mockResolvedValueOnce({
        id: 'test',
        content: [],
        usage: { input_tokens: 10, output_tokens: 10 },
        stop_reason: 'end_turn',
      });

      const client = new AnthropicClient(createConfig());

      await expect(
        client.createChatCompletion({
          messages: [{ role: 'user', content: 'Hello' }],
        }),
      ).rejects.toThrow();
    });

    it('should throw error when content is not text type', async () => {
      mockCreate.mockResolvedValueOnce({
        id: 'test',
        content: [{ type: 'image', source: 'data:...' }],
        usage: { input_tokens: 10, output_tokens: 10 },
        stop_reason: 'end_turn',
      });

      const client = new AnthropicClient(createConfig());

      await expect(
        client.createChatCompletion({
          messages: [{ role: 'user', content: 'Hello' }],
        }),
      ).rejects.toThrow();
    });

    it('should handle API errors', async () => {
      mockCreate.mockRejectedValueOnce(new Error('API error'));

      const client = new AnthropicClient(createConfig());

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
          type: 'content_block_delta',
          delta: { type: 'text_delta', text: 'Hello' },
        };
        yield {
          type: 'content_block_delta',
          delta: { type: 'text_delta', text: ' world' },
        };
        yield {
          type: 'message_stop',
        };
      })();

      mockCreate.mockResolvedValueOnce(mockStream);

      const client = new AnthropicClient(createConfig());
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
          type: 'content_block_delta',
          delta: { type: 'text_delta', text: 'Hi' },
        };
      })();

      mockCreate.mockResolvedValueOnce(mockStream);

      const client = new AnthropicClient(createConfig());
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

    it('should extract system message for streaming', async () => {
      const mockStream = (async function* () {
        yield {
          type: 'content_block_delta',
          delta: { type: 'text_delta', text: 'Hi' },
        };
      })();

      mockCreate.mockResolvedValueOnce(mockStream);

      const client = new AnthropicClient(createConfig());
      const stream = client.createStreamingChatCompletion({
        messages: [
          { role: 'system', content: 'Be helpful' },
          { role: 'user', content: 'Hello' },
        ],
      });

      // Consume stream
      for await (const _ of stream) {
        // Just consume
      }

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          system: 'Be helpful',
          messages: [{ role: 'user', content: 'Hello' }],
        }),
      );
    });

    it('should handle streaming errors', async () => {
      mockCreate.mockRejectedValueOnce(new Error('Stream error'));

      const client = new AnthropicClient(createConfig());
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
          type: 'message_stop',
        };
      })();

      mockCreate.mockResolvedValueOnce(mockStream);

      const client = new AnthropicClient(createConfig());
      const stream = client.createStreamingChatCompletion({
        messages: [{ role: 'user', content: 'Hello' }],
      });

      const chunks: Array<{ delta: string; done: boolean }> = [];
      for await (const chunk of stream) {
        chunks.push(chunk);
      }

      expect(chunks[chunks.length - 1].done).toBe(true);
    });

    it('should ignore non-text deltas', async () => {
      const mockStream = (async function* () {
        yield {
          type: 'content_block_delta',
          delta: { type: 'other_type', data: 'ignored' },
        };
        yield {
          type: 'content_block_delta',
          delta: { type: 'text_delta', text: 'Visible' },
        };
      })();

      mockCreate.mockResolvedValueOnce(mockStream);

      const client = new AnthropicClient(createConfig());
      const stream = client.createStreamingChatCompletion({
        messages: [{ role: 'user', content: 'Hello' }],
      });

      const chunks: string[] = [];
      for await (const chunk of stream) {
        if (chunk.delta) chunks.push(chunk.delta);
      }

      expect(chunks).toEqual(['Visible']);
    });
  });

  describe('calculateCost', () => {
    it('should calculate cost using pricing data', () => {
      const client = new AnthropicClient(
        createConfig({ model: 'claude-3-5-sonnet-20241022' }),
      );
      const cost = client.calculateCost(1000, 500);

      expect(cost).toHaveProperty('prompt');
      expect(cost).toHaveProperty('completion');
      expect(cost).toHaveProperty('total');
      expect(cost.total).toBeGreaterThan(0);
    });

    it('should calculate different costs for different models', () => {
      const client1 = new AnthropicClient(
        createConfig({ model: 'claude-3-opus-20240229' }),
      );
      const client2 = new AnthropicClient(
        createConfig({ model: 'claude-3-haiku-20240307' }),
      );

      const cost1 = client1.calculateCost(1000, 1000);
      const cost2 = client2.calculateCost(1000, 1000);

      expect(cost1.total).toBeGreaterThan(cost2.total);
    });

    it('should return zero cost for zero tokens', () => {
      const client = new AnthropicClient(createConfig());
      const cost = client.calculateCost(0, 0);

      expect(cost.prompt).toBe(0);
      expect(cost.completion).toBe(0);
      expect(cost.total).toBe(0);
    });
  });
});
