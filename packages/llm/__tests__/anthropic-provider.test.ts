/**
 * Anthropic Provider Tests
 *
 * Comprehensive test suite for AnthropicClient covering:
 * - Constructor validation and provider enforcement
 * - Chat completion creation with message mapping
 * - System message handling (Anthropic-specific)
 * - Streaming chat completion
 * - Cost calculation
 * - Error handling
 * - Integration scenarios
 */
import Anthropic, { APIError as AnthropicAPIError } from '@anthropic-ai/sdk';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AnthropicClient } from '../src/providers/anthropic';
import { LLMError } from '../src/types';

// Mock Anthropic SDK
const mockCreate = vi.fn();

vi.mock('@anthropic-ai/sdk', () => {
  class MockAPIError extends Error {
    status: number | undefined;

    constructor(message: string, status?: number) {
      super(message);
      this.name = 'APIError';
      this.status = status;
    }
  }

  const MockAnthropic = vi.fn().mockImplementation(() => ({
    messages: {
      create: mockCreate,
    },
  }));

  // Add APIError as a static property
  MockAnthropic.APIError = MockAPIError;

  return {
    default: MockAnthropic,
    APIError: MockAPIError,
  };
});

describe('AnthropicClient', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('constructor', () => {
    it('should create instance with valid config', () => {
      const client = new AnthropicClient({
        provider: 'anthropic',
        model: 'claude-3-5-sonnet-20241022',
        apiKey: 'sk-ant-test-key',
      });

      expect(client).toBeInstanceOf(AnthropicClient);
      expect(client.getProvider()).toBe('anthropic');
      expect(client.getModel()).toBe('claude-3-5-sonnet-20241022');
    });

    it('should throw error for invalid provider', () => {
      expect(() => {
        new AnthropicClient({
          provider: 'openai' as 'anthropic',
          model: 'claude-3-5-sonnet-20241022',
          apiKey: 'sk-ant-test-key',
        });
      }).toThrow('Invalid provider for Anthropic client');
    });
  });

  describe('createChatCompletion', () => {
    it('should create chat completion with correct parameters', async () => {
      const mockResponse: Anthropic.Message = {
        id: 'msg_123',
        type: 'message',
        role: 'assistant',
        content: [{ type: 'text', text: 'Hello! How can I help?' }],
        model: 'claude-3-5-sonnet-20241022',
        stop_reason: 'end_turn',
        usage: {
          input_tokens: 10,
          output_tokens: 5,
        },
      } as Anthropic.Message;

      mockCreate.mockResolvedValue(mockResponse);

      const client = new AnthropicClient({
        provider: 'anthropic',
        model: 'claude-3-5-sonnet-20241022',
        apiKey: 'sk-ant-test-key',
      });

      const response = await client.createChatCompletion({
        messages: [{ role: 'user', content: 'Hello!' }],
      });

      expect(mockCreate).toHaveBeenCalledWith({
        model: 'claude-3-5-sonnet-20241022',
        messages: [{ role: 'user', content: 'Hello!' }],
        system: undefined,
        temperature: 0.7,
        max_tokens: 1024,
        top_p: undefined,
      });

      expect(response.id).toBe('msg_123');
      expect(response.provider).toBe('anthropic');
      expect(response.model).toBe('claude-3-5-sonnet-20241022');
      expect(response.message.content).toBe('Hello! How can I help?');
      expect(response.usage.promptTokens).toBe(10);
      expect(response.usage.completionTokens).toBe(5);
      expect(response.usage.totalTokens).toBe(15);
    });

    it('should handle system message separately (Anthropic-specific)', async () => {
      const mockResponse: Anthropic.Message = {
        id: 'msg_456',
        type: 'message',
        role: 'assistant',
        content: [{ type: 'text', text: 'I am helpful.' }],
        model: 'claude-3-5-sonnet-20241022',
        stop_reason: 'end_turn',
        usage: { input_tokens: 20, output_tokens: 5 },
      } as Anthropic.Message;

      mockCreate.mockResolvedValue(mockResponse);

      const client = new AnthropicClient({
        provider: 'anthropic',
        model: 'claude-3-5-sonnet-20241022',
        apiKey: 'sk-ant-test-key',
      });

      await client.createChatCompletion({
        messages: [
          { role: 'system', content: 'You are a helpful assistant.' },
          { role: 'user', content: 'Tell me about yourself' },
        ],
      });

      // System message should be extracted and sent separately
      expect(mockCreate).toHaveBeenCalledWith({
        model: 'claude-3-5-sonnet-20241022',
        messages: [{ role: 'user', content: 'Tell me about yourself' }],
        system: 'You are a helpful assistant.',
        temperature: 0.7,
        max_tokens: 1024,
        top_p: undefined,
      });
    });

    it('should use custom parameters when provided', async () => {
      const mockResponse: Anthropic.Message = {
        id: 'msg_789',
        type: 'message',
        role: 'assistant',
        content: [{ type: 'text', text: 'Response' }],
        model: 'claude-3-5-sonnet-20241022',
        stop_reason: 'end_turn',
        usage: { input_tokens: 10, output_tokens: 3 },
      } as Anthropic.Message;

      mockCreate.mockResolvedValue(mockResponse);

      const client = new AnthropicClient({
        provider: 'anthropic',
        model: 'claude-3-5-sonnet-20241022',
        apiKey: 'sk-ant-test-key',
        temperature: 0.5,
        maxTokens: 500,
      });

      await client.createChatCompletion({
        messages: [{ role: 'user', content: 'Test' }],
        temperature: 0.2,
        maxTokens: 200,
        topP: 0.9,
      });

      expect(mockCreate).toHaveBeenCalledWith({
        model: 'claude-3-5-sonnet-20241022',
        messages: [{ role: 'user', content: 'Test' }],
        system: undefined,
        temperature: 0.2,
        max_tokens: 200,
        top_p: 0.9,
      });
    });

    it('should calculate cost correctly', async () => {
      const mockResponse: Anthropic.Message = {
        id: 'msg_cost',
        type: 'message',
        role: 'assistant',
        content: [{ type: 'text', text: 'Test' }],
        model: 'claude-3-5-sonnet-20241022',
        stop_reason: 'end_turn',
        usage: { input_tokens: 1000, output_tokens: 500 },
      } as Anthropic.Message;

      mockCreate.mockResolvedValue(mockResponse);

      const client = new AnthropicClient({
        provider: 'anthropic',
        model: 'claude-3-5-sonnet-20241022',
        apiKey: 'sk-ant-test-key',
      });

      const response = await client.createChatCompletion({
        messages: [{ role: 'user', content: 'Test' }],
      });

      // Claude 3.5 Sonnet pricing: $3/1M prompt, $15/1M completion
      expect(response.cost).toBeDefined();
      expect(response.cost?.prompt).toBe(0.003); // 1000 tokens * $3/1M
      expect(response.cost?.completion).toBe(0.0075); // 500 tokens * $15/1M
      expect(response.cost?.total).toBeCloseTo(0.0105, 4);
    });

    it('should map finish reason correctly', async () => {
      const testCases: Array<{
        stopReason: string | null;
        expectedFinishReason:
          | 'stop'
          | 'length'
          | 'function_call'
          | 'content_filter';
      }> = [
        { stopReason: 'end_turn', expectedFinishReason: 'stop' },
        { stopReason: 'max_tokens', expectedFinishReason: 'length' },
        { stopReason: 'stop_sequence', expectedFinishReason: 'stop' },
        { stopReason: null, expectedFinishReason: 'stop' },
      ];

      const client = new AnthropicClient({
        provider: 'anthropic',
        model: 'claude-3-5-sonnet-20241022',
        apiKey: 'sk-ant-test-key',
      });

      for (const { stopReason, expectedFinishReason } of testCases) {
        const mockResponse: Anthropic.Message = {
          id: 'msg_test',
          type: 'message',
          role: 'assistant',
          content: [{ type: 'text', text: 'Test' }],
          model: 'claude-3-5-sonnet-20241022',
          stop_reason: stopReason,
          usage: { input_tokens: 10, output_tokens: 5 },
        } as Anthropic.Message;

        mockCreate.mockResolvedValue(mockResponse);

        const response = await client.createChatCompletion({
          messages: [{ role: 'user', content: 'Test' }],
        });

        expect(response.finishReason).toBe(expectedFinishReason);
      }
    });

    it('should throw error when no text content in response', async () => {
      const mockResponse: Anthropic.Message = {
        id: 'msg_nocontent',
        type: 'message',
        role: 'assistant',
        content: [], // Empty content
        model: 'claude-3-5-sonnet-20241022',
        stop_reason: 'end_turn',
        usage: { input_tokens: 10, output_tokens: 0 },
      } as Anthropic.Message;

      mockCreate.mockResolvedValue(mockResponse);

      const client = new AnthropicClient({
        provider: 'anthropic',
        model: 'claude-3-5-sonnet-20241022',
        apiKey: 'sk-ant-test-key',
      });

      try {
        await client.createChatCompletion({
          messages: [{ role: 'user', content: 'Test' }],
        });
        expect.fail('Should have thrown error');
      } catch (error) {
        expect(error).toBeDefined();
        expect((error as Error).message).toBe('No text content in response');
      }
    });
  });

  describe('createStreamingChatCompletion', () => {
    it('should stream chat completion chunks', async () => {
      const mockStream = (async function* () {
        yield {
          type: 'content_block_delta',
          delta: { type: 'text_delta', text: 'Hello' },
        } as Anthropic.MessageStreamEvent;
        yield {
          type: 'content_block_delta',
          delta: { type: 'text_delta', text: ' World' },
        } as Anthropic.MessageStreamEvent;
        yield { type: 'message_stop' } as Anthropic.MessageStreamEvent;
      })();

      mockCreate.mockResolvedValue(mockStream);

      const client = new AnthropicClient({
        provider: 'anthropic',
        model: 'claude-3-5-sonnet-20241022',
        apiKey: 'sk-ant-test-key',
      });

      const chunks: string[] = [];
      for await (const chunk of client.createStreamingChatCompletion({
        messages: [{ role: 'user', content: 'Hello' }],
      })) {
        if (!chunk.done) {
          chunks.push(chunk.delta);
        }
      }

      expect(chunks).toEqual(['Hello', ' World']);
      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          stream: true,
        }),
      );
    });

    it('should emit done signal at stream end', async () => {
      const mockStream = (async function* () {
        yield {
          type: 'content_block_delta',
          delta: { type: 'text_delta', text: 'Test' },
        } as Anthropic.MessageStreamEvent;
        yield { type: 'message_stop' } as Anthropic.MessageStreamEvent;
      })();

      mockCreate.mockResolvedValue(mockStream);

      const client = new AnthropicClient({
        provider: 'anthropic',
        model: 'claude-3-5-sonnet-20241022',
        apiKey: 'sk-ant-test-key',
      });

      let doneReceived = false;
      for await (const chunk of client.createStreamingChatCompletion({
        messages: [{ role: 'user', content: 'Test' }],
      })) {
        if (chunk.done) {
          doneReceived = true;
        }
      }

      expect(doneReceived).toBe(true);
    });

    it('should handle system message in streaming', async () => {
      const mockStream = (async function* () {
        yield {
          type: 'content_block_delta',
          delta: { type: 'text_delta', text: 'Response' },
        } as Anthropic.MessageStreamEvent;
        yield { type: 'message_stop' } as Anthropic.MessageStreamEvent;
      })();

      mockCreate.mockResolvedValue(mockStream);

      const client = new AnthropicClient({
        provider: 'anthropic',
        model: 'claude-3-5-sonnet-20241022',
        apiKey: 'sk-ant-test-key',
      });

      const generator = client.createStreamingChatCompletion({
        messages: [
          { role: 'system', content: 'Be helpful' },
          { role: 'user', content: 'Hi' },
        ],
      });

      // Consume the generator
      for await (const _ of generator) {
        // Just consume
      }

      expect(mockCreate).toHaveBeenCalledWith({
        model: 'claude-3-5-sonnet-20241022',
        messages: [{ role: 'user', content: 'Hi' }],
        system: 'Be helpful',
        temperature: 0.7,
        max_tokens: 1024,
        top_p: undefined,
        stream: true,
      });
    });

    it('should ignore non-text deltas', async () => {
      const mockStream = (async function* () {
        yield {
          type: 'content_block_delta',
          delta: { type: 'input_json_delta' as 'text_delta', text: undefined },
        } as Anthropic.MessageStreamEvent;
        yield {
          type: 'content_block_delta',
          delta: { type: 'text_delta', text: 'Valid text' },
        } as Anthropic.MessageStreamEvent;
        yield { type: 'message_stop' } as Anthropic.MessageStreamEvent;
      })();

      mockCreate.mockResolvedValue(mockStream);

      const client = new AnthropicClient({
        provider: 'anthropic',
        model: 'claude-3-5-sonnet-20241022',
        apiKey: 'sk-ant-test-key',
      });

      const chunks: string[] = [];
      for await (const chunk of client.createStreamingChatCompletion({
        messages: [{ role: 'user', content: 'Test' }],
      })) {
        if (!chunk.done) {
          chunks.push(chunk.delta);
        }
      }

      // Should only include the valid text delta
      expect(chunks).toEqual(['Valid text']);
    });
  });

  describe('calculateCost', () => {
    it('should calculate cost for Claude 3.5 Sonnet', () => {
      const client = new AnthropicClient({
        provider: 'anthropic',
        model: 'claude-3-5-sonnet-20241022',
        apiKey: 'sk-ant-test-key',
      });

      const cost = client.calculateCost(1000, 500);

      // Claude 3.5 Sonnet: $3/1M prompt, $15/1M completion
      expect(cost.prompt).toBe(0.003);
      expect(cost.completion).toBe(0.0075);
      expect(cost.total).toBeCloseTo(0.0105, 4);
    });

    it('should calculate cost for Claude 3 Opus', () => {
      const client = new AnthropicClient({
        provider: 'anthropic',
        model: 'claude-3-opus-20240229',
        apiKey: 'sk-ant-test-key',
      });

      const cost = client.calculateCost(1000, 500);

      // Claude 3 Opus: $15/1M prompt, $75/1M completion
      expect(cost.prompt).toBe(0.015);
      expect(cost.completion).toBe(0.0375);
      expect(cost.total).toBe(0.0525);
    });

    it('should calculate cost for Claude 3 Haiku', () => {
      const client = new AnthropicClient({
        provider: 'anthropic',
        model: 'claude-3-haiku-20240307',
        apiKey: 'sk-ant-test-key',
      });

      const cost = client.calculateCost(1000, 500);

      // Claude 3 Haiku: $0.25/1M prompt, $1.25/1M completion
      expect(cost.prompt).toBe(0.00025);
      expect(cost.completion).toBe(0.000625);
      expect(cost.total).toBe(0.000875);
    });
  });

  describe('error handling', () => {
    it('should handle Anthropic API errors', async () => {
      // Create instance of mocked APIError
      const apiError = new AnthropicAPIError('Invalid API key', 401);
      mockCreate.mockRejectedValue(apiError);

      const client = new AnthropicClient({
        provider: 'anthropic',
        model: 'claude-3-5-sonnet-20241022',
        apiKey: 'invalid-key',
      });

      try {
        await client.createChatCompletion({
          messages: [{ role: 'user', content: 'Test' }],
        });
        expect.fail('Should have thrown error');
      } catch (error) {
        expect(error).toBeDefined();
        expect((error as Error).message).toBe('Invalid API key');
      }
    });

    it('should handle generic errors', async () => {
      const error = new Error('Network error');
      mockCreate.mockRejectedValue(error);

      const client = new AnthropicClient({
        provider: 'anthropic',
        model: 'claude-3-5-sonnet-20241022',
        apiKey: 'sk-ant-test-key',
      });

      try {
        await client.createChatCompletion({
          messages: [{ role: 'user', content: 'Test' }],
        });
        expect.fail('Should have thrown error');
      } catch (error) {
        expect(error).toBeDefined();
        expect((error as Error).message).toBe('Network error');
      }
    });

    it('should handle unknown error types', async () => {
      mockCreate.mockRejectedValue('string error');

      const client = new AnthropicClient({
        provider: 'anthropic',
        model: 'claude-3-5-sonnet-20241022',
        apiKey: 'sk-ant-test-key',
      });

      try {
        await client.createChatCompletion({
          messages: [{ role: 'user', content: 'Test' }],
        });
        expect.fail('Should have thrown error');
      } catch (error) {
        expect(error).toBeDefined();
        expect((error as Error).message).toBe('Unknown error occurred');
      }
    });

    it('should handle streaming errors', async () => {
      // Create instance of mocked APIError
      const error = new AnthropicAPIError('Rate limit exceeded', 429);
      mockCreate.mockRejectedValue(error);

      const client = new AnthropicClient({
        provider: 'anthropic',
        model: 'claude-3-5-sonnet-20241022',
        apiKey: 'sk-ant-test-key',
      });

      const generator = client.createStreamingChatCompletion({
        messages: [{ role: 'user', content: 'Test' }],
      });

      try {
        for await (const _ of generator) {
          // Should throw before yielding anything
        }
        expect.fail('Should have thrown error');
      } catch (err) {
        expect(err).toBeDefined();
        expect((err as Error).message).toBe('Rate limit exceeded');
      }
    });
  });

  describe('integration scenarios', () => {
    it('should handle multi-turn conversation', async () => {
      const mockResponse: Anthropic.Message = {
        id: 'msg_multi',
        type: 'message',
        role: 'assistant',
        content: [{ type: 'text', text: 'I remember our previous chat.' }],
        model: 'claude-3-5-sonnet-20241022',
        stop_reason: 'end_turn',
        usage: { input_tokens: 50, output_tokens: 10 },
      } as Anthropic.Message;

      mockCreate.mockResolvedValue(mockResponse);

      const client = new AnthropicClient({
        provider: 'anthropic',
        model: 'claude-3-5-sonnet-20241022',
        apiKey: 'sk-ant-test-key',
      });

      await client.createChatCompletion({
        messages: [
          { role: 'system', content: 'You have a good memory.' },
          { role: 'user', content: 'Hello!' },
          { role: 'assistant', content: 'Hi there!' },
          { role: 'user', content: 'Do you remember our chat?' },
        ],
      });

      // System message extracted, conversation preserved
      expect(mockCreate).toHaveBeenCalledWith({
        model: 'claude-3-5-sonnet-20241022',
        messages: [
          { role: 'user', content: 'Hello!' },
          { role: 'assistant', content: 'Hi there!' },
          { role: 'user', content: 'Do you remember our chat?' },
        ],
        system: 'You have a good memory.',
        temperature: 0.7,
        max_tokens: 1024,
        top_p: undefined,
      });
    });

    it('should work without system message', async () => {
      const mockResponse: Anthropic.Message = {
        id: 'msg_nosys',
        type: 'message',
        role: 'assistant',
        content: [{ type: 'text', text: 'Hello!' }],
        model: 'claude-3-5-sonnet-20241022',
        stop_reason: 'end_turn',
        usage: { input_tokens: 5, output_tokens: 3 },
      } as Anthropic.Message;

      mockCreate.mockResolvedValue(mockResponse);

      const client = new AnthropicClient({
        provider: 'anthropic',
        model: 'claude-3-5-sonnet-20241022',
        apiKey: 'sk-ant-test-key',
      });

      await client.createChatCompletion({
        messages: [{ role: 'user', content: 'Hi!' }],
      });

      expect(mockCreate).toHaveBeenCalledWith({
        model: 'claude-3-5-sonnet-20241022',
        messages: [{ role: 'user', content: 'Hi!' }],
        system: undefined,
        temperature: 0.7,
        max_tokens: 1024,
        top_p: undefined,
      });
    });
  });
});
