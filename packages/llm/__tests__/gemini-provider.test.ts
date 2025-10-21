/**
 * Gemini Provider Tests
 *
 * Comprehensive test suite for GeminiClient covering:
 * - Constructor validation and provider enforcement
 * - Chat completion creation with Gemini-specific history building
 * - System instruction handling (Gemini-specific)
 * - Streaming chat completion
 * - Cost calculation
 * - Error handling
 * - Integration scenarios
 */
import type {
  GenerateContentResult,
  GenerateContentStreamResult,
  GenerativeModel,
} from '@google/generative-ai';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { GeminiClient } from '../src/providers/gemini';

// Mock Google Generative AI SDK
const mockSendMessage = vi.fn();
const mockSendMessageStream = vi.fn();
const mockStartChat = vi.fn();
const mockGetGenerativeModel = vi.fn();

vi.mock('@google/generative-ai', () => {
  return {
    GoogleGenerativeAI: vi.fn().mockImplementation(() => ({
      getGenerativeModel: mockGetGenerativeModel,
    })),
  };
});

describe('GeminiClient', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Setup default mock chain
    mockGetGenerativeModel.mockReturnValue({
      startChat: mockStartChat,
    } as unknown as GenerativeModel);

    mockStartChat.mockReturnValue({
      sendMessage: mockSendMessage,
      sendMessageStream: mockSendMessageStream,
    });
  });

  describe('constructor', () => {
    it('should create instance with valid config', () => {
      const client = new GeminiClient({
        provider: 'gemini',
        model: 'gemini-1.5-flash',
        apiKey: 'test-api-key',
      });

      expect(client).toBeInstanceOf(GeminiClient);
      expect(client.getProvider()).toBe('gemini');
      expect(client.getModel()).toBe('gemini-1.5-flash');
    });

    it('should throw error for invalid provider', () => {
      expect(() => {
        new GeminiClient({
          provider: 'openai' as 'gemini',
          model: 'gemini-1.5-flash',
          apiKey: 'test-api-key',
        });
      }).toThrow('Invalid provider for Gemini client');
    });
  });

  describe('createChatCompletion', () => {
    it('should create chat completion with correct parameters', async () => {
      const mockResult: GenerateContentResult = {
        response: {
          text: () => 'Hello! How can I help?',
          usageMetadata: {
            promptTokenCount: 10,
            candidatesTokenCount: 5,
            totalTokenCount: 15,
          },
          candidates: [{ finishReason: 'STOP' }],
        },
      } as GenerateContentResult;

      mockSendMessage.mockResolvedValue(mockResult);

      const client = new GeminiClient({
        provider: 'gemini',
        model: 'gemini-1.5-flash',
        apiKey: 'test-api-key',
      });

      const response = await client.createChatCompletion({
        messages: [{ role: 'user', content: 'Hello!' }],
      });

      expect(mockGetGenerativeModel).toHaveBeenCalledWith({
        model: 'gemini-1.5-flash',
      });

      expect(mockStartChat).toHaveBeenCalledWith({
        history: [],
        generationConfig: {
          temperature: 0.7,
          maxOutputTokens: undefined,
          topP: undefined,
        },
        systemInstruction: undefined,
      });

      expect(mockSendMessage).toHaveBeenCalledWith('Hello!');

      expect(response.provider).toBe('gemini');
      expect(response.model).toBe('gemini-1.5-flash');
      expect(response.message.content).toBe('Hello! How can I help?');
      expect(response.usage.promptTokens).toBe(10);
      expect(response.usage.completionTokens).toBe(5);
      expect(response.usage.totalTokens).toBe(15);
    });

    it('should handle system instruction separately (Gemini-specific)', async () => {
      const mockResult: GenerateContentResult = {
        response: {
          text: () => 'I am helpful.',
          usageMetadata: {
            promptTokenCount: 20,
            candidatesTokenCount: 5,
            totalTokenCount: 25,
          },
          candidates: [{ finishReason: 'STOP' }],
        },
      } as GenerateContentResult;

      mockSendMessage.mockResolvedValue(mockResult);

      const client = new GeminiClient({
        provider: 'gemini',
        model: 'gemini-1.5-flash',
        apiKey: 'test-api-key',
      });

      await client.createChatCompletion({
        messages: [
          { role: 'system', content: 'You are a helpful assistant.' },
          { role: 'user', content: 'Tell me about yourself' },
        ],
      });

      // System instruction should be extracted and sent separately
      expect(mockStartChat).toHaveBeenCalledWith({
        history: [],
        generationConfig: expect.any(Object),
        systemInstruction: 'You are a helpful assistant.',
      });

      expect(mockSendMessage).toHaveBeenCalledWith('Tell me about yourself');
    });

    it('should build chat history correctly (Gemini-specific)', async () => {
      const mockResult: GenerateContentResult = {
        response: {
          text: () => 'Yes, I remember!',
          usageMetadata: {
            promptTokenCount: 50,
            candidatesTokenCount: 10,
            totalTokenCount: 60,
          },
          candidates: [{ finishReason: 'STOP' }],
        },
      } as GenerateContentResult;

      mockSendMessage.mockResolvedValue(mockResult);

      const client = new GeminiClient({
        provider: 'gemini',
        model: 'gemini-1.5-flash',
        apiKey: 'test-api-key',
      });

      await client.createChatCompletion({
        messages: [
          { role: 'user', content: 'Hello!' },
          { role: 'assistant', content: 'Hi there!' },
          { role: 'user', content: 'Do you remember our chat?' },
        ],
      });

      // History should contain all messages except the last one
      // assistant role should be mapped to 'model'
      expect(mockStartChat).toHaveBeenCalledWith({
        history: [
          { role: 'user', parts: [{ text: 'Hello!' }] },
          { role: 'model', parts: [{ text: 'Hi there!' }] },
        ],
        generationConfig: expect.any(Object),
        systemInstruction: undefined,
      });

      // Last message is sent separately
      expect(mockSendMessage).toHaveBeenCalledWith('Do you remember our chat?');
    });

    it('should use custom parameters when provided', async () => {
      const mockResult: GenerateContentResult = {
        response: {
          text: () => 'Response',
          usageMetadata: {
            promptTokenCount: 10,
            candidatesTokenCount: 3,
            totalTokenCount: 13,
          },
          candidates: [{ finishReason: 'STOP' }],
        },
      } as GenerateContentResult;

      mockSendMessage.mockResolvedValue(mockResult);

      const client = new GeminiClient({
        provider: 'gemini',
        model: 'gemini-1.5-flash',
        apiKey: 'test-api-key',
        temperature: 0.5,
        maxTokens: 500,
      });

      await client.createChatCompletion({
        messages: [{ role: 'user', content: 'Test' }],
        temperature: 0.2,
        maxTokens: 200,
        topP: 0.9,
      });

      expect(mockStartChat).toHaveBeenCalledWith({
        history: [],
        generationConfig: {
          temperature: 0.2,
          maxOutputTokens: 200,
          topP: 0.9,
        },
        systemInstruction: undefined,
      });
    });

    it('should calculate cost correctly', async () => {
      const mockResult: GenerateContentResult = {
        response: {
          text: () => 'Test',
          usageMetadata: {
            promptTokenCount: 1000,
            candidatesTokenCount: 500,
            totalTokenCount: 1500,
          },
          candidates: [{ finishReason: 'STOP' }],
        },
      } as GenerateContentResult;

      mockSendMessage.mockResolvedValue(mockResult);

      const client = new GeminiClient({
        provider: 'gemini',
        model: 'gemini-1.5-flash',
        apiKey: 'test-api-key',
      });

      const response = await client.createChatCompletion({
        messages: [{ role: 'user', content: 'Test' }],
      });

      // Gemini 1.5 Flash pricing: $0.075/1M prompt, $0.30/1M completion
      expect(response.cost).toBeDefined();
      expect(response.cost?.prompt).toBe(0.000075); // 1000 tokens * $0.075/1M
      expect(response.cost?.completion).toBe(0.00015); // 500 tokens * $0.30/1M
      expect(response.cost?.total).toBeCloseTo(0.000225, 6);
    });

    it('should map finish reason correctly', async () => {
      const testCases: Array<{
        finishReason: string | undefined;
        expectedFinishReason:
          | 'stop'
          | 'length'
          | 'function_call'
          | 'content_filter';
      }> = [
        { finishReason: 'STOP', expectedFinishReason: 'stop' },
        { finishReason: 'MAX_TOKENS', expectedFinishReason: 'length' },
        { finishReason: 'SAFETY', expectedFinishReason: 'content_filter' },
        { finishReason: 'RECITATION', expectedFinishReason: 'content_filter' },
        { finishReason: undefined, expectedFinishReason: 'stop' },
      ];

      const client = new GeminiClient({
        provider: 'gemini',
        model: 'gemini-1.5-flash',
        apiKey: 'test-api-key',
      });

      for (const { finishReason, expectedFinishReason } of testCases) {
        const mockResult: GenerateContentResult = {
          response: {
            text: () => 'Test',
            usageMetadata: {
              promptTokenCount: 10,
              candidatesTokenCount: 5,
              totalTokenCount: 15,
            },
            candidates: [{ finishReason }],
          },
        } as GenerateContentResult;

        mockSendMessage.mockResolvedValue(mockResult);

        const response = await client.createChatCompletion({
          messages: [{ role: 'user', content: 'Test' }],
        });

        expect(response.finishReason).toBe(expectedFinishReason);
      }
    });

    it('should throw error when no usage metadata in response', async () => {
      const mockResult: GenerateContentResult = {
        response: {
          text: () => 'Test',
          usageMetadata: undefined, // Missing usage metadata
          candidates: [{ finishReason: 'STOP' }],
        },
      } as GenerateContentResult;

      mockSendMessage.mockResolvedValue(mockResult);

      const client = new GeminiClient({
        provider: 'gemini',
        model: 'gemini-1.5-flash',
        apiKey: 'test-api-key',
      });

      try {
        await client.createChatCompletion({
          messages: [{ role: 'user', content: 'Test' }],
        });
        expect.fail('Should have thrown error');
      } catch (error) {
        expect(error).toBeDefined();
        expect((error as Error).message).toBe('No usage metadata in response');
      }
    });

    it('should throw error when no messages to send', async () => {
      const client = new GeminiClient({
        provider: 'gemini',
        model: 'gemini-1.5-flash',
        apiKey: 'test-api-key',
      });

      try {
        await client.createChatCompletion({
          messages: [{ role: 'system', content: 'Only system message' }],
        });
        expect.fail('Should have thrown error');
      } catch (error) {
        expect(error).toBeDefined();
        expect((error as Error).message).toBe('No messages to send');
      }
    });
  });

  describe('createStreamingChatCompletion', () => {
    it('should stream chat completion chunks', async () => {
      const mockStream = (async function* () {
        yield { text: () => 'Hello' };
        yield { text: () => ' World' };
      })();

      const mockStreamResult: GenerateContentStreamResult = {
        stream: mockStream,
        response: Promise.resolve({
          text: () => 'Hello World',
        }) as any,
      };

      mockSendMessageStream.mockResolvedValue(mockStreamResult);

      const client = new GeminiClient({
        provider: 'gemini',
        model: 'gemini-1.5-flash',
        apiKey: 'test-api-key',
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
      expect(mockSendMessageStream).toHaveBeenCalledWith('Hello');
    });

    it('should emit done signal at stream end', async () => {
      const mockStream = (async function* () {
        yield { text: () => 'Test' };
      })();

      const mockStreamResult: GenerateContentStreamResult = {
        stream: mockStream,
        response: Promise.resolve({
          text: () => 'Test',
        }) as any,
      };

      mockSendMessageStream.mockResolvedValue(mockStreamResult);

      const client = new GeminiClient({
        provider: 'gemini',
        model: 'gemini-1.5-flash',
        apiKey: 'test-api-key',
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

    it('should handle system instruction in streaming', async () => {
      const mockStream = (async function* () {
        yield { text: () => 'Response' };
      })();

      const mockStreamResult: GenerateContentStreamResult = {
        stream: mockStream,
        response: Promise.resolve({
          text: () => 'Response',
        }) as any,
      };

      mockSendMessageStream.mockResolvedValue(mockStreamResult);

      const client = new GeminiClient({
        provider: 'gemini',
        model: 'gemini-1.5-flash',
        apiKey: 'test-api-key',
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

      expect(mockStartChat).toHaveBeenCalledWith({
        history: [],
        generationConfig: expect.any(Object),
        systemInstruction: 'Be helpful',
      });
    });

    it('should handle chat history in streaming', async () => {
      const mockStream = (async function* () {
        yield { text: () => 'Yes!' };
      })();

      const mockStreamResult: GenerateContentStreamResult = {
        stream: mockStream,
        response: Promise.resolve({
          text: () => 'Yes!',
        }) as any,
      };

      mockSendMessageStream.mockResolvedValue(mockStreamResult);

      const client = new GeminiClient({
        provider: 'gemini',
        model: 'gemini-1.5-flash',
        apiKey: 'test-api-key',
      });

      const generator = client.createStreamingChatCompletion({
        messages: [
          { role: 'user', content: 'Hello' },
          { role: 'assistant', content: 'Hi' },
          { role: 'user', content: 'Remember me?' },
        ],
      });

      // Consume the generator
      for await (const _ of generator) {
        // Just consume
      }

      expect(mockStartChat).toHaveBeenCalledWith({
        history: [
          { role: 'user', parts: [{ text: 'Hello' }] },
          { role: 'model', parts: [{ text: 'Hi' }] },
        ],
        generationConfig: expect.any(Object),
        systemInstruction: undefined,
      });

      expect(mockSendMessageStream).toHaveBeenCalledWith('Remember me?');
    });

    it('should skip empty text chunks', async () => {
      const mockStream = (async function* () {
        yield { text: () => '' }; // Empty chunk
        yield { text: () => 'Valid text' };
        yield { text: () => '' }; // Another empty chunk
      })();

      const mockStreamResult: GenerateContentStreamResult = {
        stream: mockStream,
        response: Promise.resolve({
          text: () => 'Valid text',
        }) as any,
      };

      mockSendMessageStream.mockResolvedValue(mockStreamResult);

      const client = new GeminiClient({
        provider: 'gemini',
        model: 'gemini-1.5-flash',
        apiKey: 'test-api-key',
      });

      const chunks: string[] = [];
      for await (const chunk of client.createStreamingChatCompletion({
        messages: [{ role: 'user', content: 'Test' }],
      })) {
        if (!chunk.done) {
          chunks.push(chunk.delta);
        }
      }

      // Should only include the valid text chunk
      expect(chunks).toEqual(['Valid text']);
    });
  });

  describe('calculateCost', () => {
    it('should calculate cost for Gemini 1.5 Flash', () => {
      const client = new GeminiClient({
        provider: 'gemini',
        model: 'gemini-1.5-flash',
        apiKey: 'test-api-key',
      });

      const cost = client.calculateCost(1000, 500);

      // Gemini 1.5 Flash: $0.075/1M prompt, $0.30/1M completion
      expect(cost.prompt).toBe(0.000075);
      expect(cost.completion).toBe(0.00015);
      expect(cost.total).toBeCloseTo(0.000225, 6);
    });

    it('should calculate cost for Gemini 1.5 Flash-8B', () => {
      const client = new GeminiClient({
        provider: 'gemini',
        model: 'gemini-1.5-flash-8b',
        apiKey: 'test-api-key',
      });

      const cost = client.calculateCost(1000, 500);

      // Gemini 1.5 Flash-8B: $0.0375/1M prompt, $0.15/1M completion
      expect(cost.prompt).toBe(0.0000375);
      expect(cost.completion).toBe(0.000075);
      expect(cost.total).toBeCloseTo(0.0001125, 7);
    });

    it('should calculate cost for Gemini 1.5 Pro', () => {
      const client = new GeminiClient({
        provider: 'gemini',
        model: 'gemini-1.5-pro',
        apiKey: 'test-api-key',
      });

      const cost = client.calculateCost(1000, 500);

      // Gemini 1.5 Pro: $1.25/1M prompt, $5.00/1M completion
      expect(cost.prompt).toBe(0.00125);
      expect(cost.completion).toBe(0.0025);
      expect(cost.total).toBeCloseTo(0.00375, 5);
    });
  });

  describe('error handling', () => {
    it('should handle API key errors', async () => {
      const error = new Error('Invalid API key provided');
      mockSendMessage.mockRejectedValue(error);

      const client = new GeminiClient({
        provider: 'gemini',
        model: 'gemini-1.5-flash',
        apiKey: 'invalid-key',
      });

      try {
        await client.createChatCompletion({
          messages: [{ role: 'user', content: 'Test' }],
        });
        expect.fail('Should have thrown error');
      } catch (err) {
        expect(err).toBeDefined();
        expect((err as Error).message).toBe('Invalid API key provided');
      }
    });

    it('should handle quota exceeded errors', async () => {
      const error = new Error('API quota exceeded');
      mockSendMessage.mockRejectedValue(error);

      const client = new GeminiClient({
        provider: 'gemini',
        model: 'gemini-1.5-flash',
        apiKey: 'test-api-key',
      });

      try {
        await client.createChatCompletion({
          messages: [{ role: 'user', content: 'Test' }],
        });
        expect.fail('Should have thrown error');
      } catch (err) {
        expect(err).toBeDefined();
        expect((err as Error).message).toBe('API quota exceeded');
      }
    });

    it('should handle generic errors', async () => {
      const error = new Error('Network error');
      mockSendMessage.mockRejectedValue(error);

      const client = new GeminiClient({
        provider: 'gemini',
        model: 'gemini-1.5-flash',
        apiKey: 'test-api-key',
      });

      try {
        await client.createChatCompletion({
          messages: [{ role: 'user', content: 'Test' }],
        });
        expect.fail('Should have thrown error');
      } catch (err) {
        expect(err).toBeDefined();
        expect((err as Error).message).toBe('Network error');
      }
    });

    it('should handle unknown error types', async () => {
      mockSendMessage.mockRejectedValue('string error');

      const client = new GeminiClient({
        provider: 'gemini',
        model: 'gemini-1.5-flash',
        apiKey: 'test-api-key',
      });

      try {
        await client.createChatCompletion({
          messages: [{ role: 'user', content: 'Test' }],
        });
        expect.fail('Should have thrown error');
      } catch (err) {
        expect(err).toBeDefined();
        expect((err as Error).message).toBe('Unknown error occurred');
      }
    });

    it('should handle streaming errors', async () => {
      const error = new Error('Streaming failed');
      mockSendMessageStream.mockRejectedValue(error);

      const client = new GeminiClient({
        provider: 'gemini',
        model: 'gemini-1.5-flash',
        apiKey: 'test-api-key',
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
        expect((err as Error).message).toBe('Streaming failed');
      }
    });
  });

  describe('integration scenarios', () => {
    it('should handle complex multi-turn conversation', async () => {
      const mockResult: GenerateContentResult = {
        response: {
          text: () => 'I understand the context.',
          usageMetadata: {
            promptTokenCount: 100,
            candidatesTokenCount: 20,
            totalTokenCount: 120,
          },
          candidates: [{ finishReason: 'STOP' }],
        },
      } as GenerateContentResult;

      mockSendMessage.mockResolvedValue(mockResult);

      const client = new GeminiClient({
        provider: 'gemini',
        model: 'gemini-1.5-flash',
        apiKey: 'test-api-key',
      });

      await client.createChatCompletion({
        messages: [
          { role: 'system', content: 'You are a context-aware assistant.' },
          { role: 'user', content: 'Hello!' },
          { role: 'assistant', content: 'Hi there!' },
          { role: 'user', content: 'How are you?' },
          { role: 'assistant', content: 'I am well, thanks!' },
          { role: 'user', content: 'What did we talk about?' },
        ],
      });

      // System instruction extracted
      expect(mockStartChat).toHaveBeenCalledWith({
        history: [
          { role: 'user', parts: [{ text: 'Hello!' }] },
          { role: 'model', parts: [{ text: 'Hi there!' }] },
          { role: 'user', parts: [{ text: 'How are you?' }] },
          { role: 'model', parts: [{ text: 'I am well, thanks!' }] },
        ],
        generationConfig: expect.any(Object),
        systemInstruction: 'You are a context-aware assistant.',
      });

      // Last message sent separately
      expect(mockSendMessage).toHaveBeenCalledWith('What did we talk about?');
    });

    it('should work without system instruction', async () => {
      const mockResult: GenerateContentResult = {
        response: {
          text: () => 'Hello!',
          usageMetadata: {
            promptTokenCount: 5,
            candidatesTokenCount: 3,
            totalTokenCount: 8,
          },
          candidates: [{ finishReason: 'STOP' }],
        },
      } as GenerateContentResult;

      mockSendMessage.mockResolvedValue(mockResult);

      const client = new GeminiClient({
        provider: 'gemini',
        model: 'gemini-1.5-flash',
        apiKey: 'test-api-key',
      });

      await client.createChatCompletion({
        messages: [{ role: 'user', content: 'Hi!' }],
      });

      expect(mockStartChat).toHaveBeenCalledWith({
        history: [],
        generationConfig: expect.any(Object),
        systemInstruction: undefined,
      });
    });

    it('should generate unique IDs for responses', async () => {
      const mockResult: GenerateContentResult = {
        response: {
          text: () => 'Test',
          usageMetadata: {
            promptTokenCount: 5,
            candidatesTokenCount: 3,
            totalTokenCount: 8,
          },
          candidates: [{ finishReason: 'STOP' }],
        },
      } as GenerateContentResult;

      mockSendMessage.mockResolvedValue(mockResult);

      const client = new GeminiClient({
        provider: 'gemini',
        model: 'gemini-1.5-flash',
        apiKey: 'test-api-key',
      });

      const response1 = await client.createChatCompletion({
        messages: [{ role: 'user', content: 'Test 1' }],
      });

      const response2 = await client.createChatCompletion({
        messages: [{ role: 'user', content: 'Test 2' }],
      });

      // IDs should be unique
      expect(response1.id).toBeDefined();
      expect(response2.id).toBeDefined();
      expect(response1.id).not.toBe(response2.id);
      expect(response1.id).toMatch(/^gemini-/);
      expect(response2.id).toMatch(/^gemini-/);
    });
  });
});
