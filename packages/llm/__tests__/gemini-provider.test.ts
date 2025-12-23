/**
 * Gemini Provider Tests
 *
 * Comprehensive test suite for GeminiClient covering:
 * - Constructor validation and provider enforcement
 * - Chat completion creation with Gemini-specific content building
 * - System instruction handling (Gemini-specific)
 * - Streaming chat completion
 * - Cost calculation
 * - Error handling
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { GeminiClient } from '../src/providers/gemini';

// Mock response data
const mockGenerateContent = vi.fn();
const mockGenerateContentStream = vi.fn();

// Mock the @google/genai SDK (the new SDK the implementation uses)
vi.mock('@google/genai', () => {
  return {
    GoogleGenAI: vi.fn().mockImplementation(() => ({
      models: {
        generateContent: mockGenerateContent,
        generateContentStream: mockGenerateContentStream,
      },
    })),
  };
});

describe('GeminiClient', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
      mockGenerateContent.mockResolvedValue({
        text: 'Hello! How can I help?',
        usageMetadata: {
          promptTokenCount: 10,
          candidatesTokenCount: 5,
          totalTokenCount: 15,
        },
        candidates: [{ finishReason: 'STOP' }],
      });

      const client = new GeminiClient({
        provider: 'gemini',
        model: 'gemini-1.5-flash',
        apiKey: 'test-api-key',
      });

      const response = await client.createChatCompletion({
        messages: [{ role: 'user', content: 'Hello!' }],
      });

      expect(mockGenerateContent).toHaveBeenCalledWith({
        model: 'gemini-1.5-flash',
        contents: [{ role: 'user', parts: [{ text: 'Hello!' }] }],
        config: {
          systemInstruction: undefined,
          temperature: 0.7,
          maxOutputTokens: undefined,
          topP: undefined,
        },
      });

      expect(response.provider).toBe('gemini');
      expect(response.model).toBe('gemini-1.5-flash');
      expect(response.message.content).toBe('Hello! How can I help?');
      expect(response.usage.promptTokens).toBe(10);
      expect(response.usage.completionTokens).toBe(5);
      expect(response.usage.totalTokens).toBe(15);
    });

    it('should handle system instruction separately (Gemini-specific)', async () => {
      mockGenerateContent.mockResolvedValue({
        text: 'I am helpful.',
        usageMetadata: {
          promptTokenCount: 20,
          candidatesTokenCount: 5,
          totalTokenCount: 25,
        },
        candidates: [{ finishReason: 'STOP' }],
      });

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

      // System instruction should be extracted and sent in config
      expect(mockGenerateContent).toHaveBeenCalledWith({
        model: 'gemini-1.5-flash',
        contents: [
          { role: 'user', parts: [{ text: 'Tell me about yourself' }] },
        ],
        config: {
          systemInstruction: 'You are a helpful assistant.',
          temperature: 0.7,
          maxOutputTokens: undefined,
          topP: undefined,
        },
      });
    });

    it('should build chat contents correctly (Gemini-specific)', async () => {
      mockGenerateContent.mockResolvedValue({
        text: 'Yes, I remember!',
        usageMetadata: {
          promptTokenCount: 50,
          candidatesTokenCount: 10,
          totalTokenCount: 60,
        },
        candidates: [{ finishReason: 'STOP' }],
      });

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

      // All messages should be converted with assistant -> model
      expect(mockGenerateContent).toHaveBeenCalledWith({
        model: 'gemini-1.5-flash',
        contents: [
          { role: 'user', parts: [{ text: 'Hello!' }] },
          { role: 'model', parts: [{ text: 'Hi there!' }] },
          { role: 'user', parts: [{ text: 'Do you remember our chat?' }] },
        ],
        config: expect.any(Object),
      });
    });

    it('should use custom parameters when provided', async () => {
      mockGenerateContent.mockResolvedValue({
        text: 'Response',
        usageMetadata: {
          promptTokenCount: 10,
          candidatesTokenCount: 3,
          totalTokenCount: 13,
        },
        candidates: [{ finishReason: 'STOP' }],
      });

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

      expect(mockGenerateContent).toHaveBeenCalledWith({
        model: 'gemini-1.5-flash',
        contents: [{ role: 'user', parts: [{ text: 'Test' }] }],
        config: {
          systemInstruction: undefined,
          temperature: 0.2,
          maxOutputTokens: 200,
          topP: 0.9,
        },
      });
    });

    it('should calculate cost correctly', async () => {
      mockGenerateContent.mockResolvedValue({
        text: 'Test',
        usageMetadata: {
          promptTokenCount: 1000,
          candidatesTokenCount: 500,
          totalTokenCount: 1500,
        },
        candidates: [{ finishReason: 'STOP' }],
      });

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
        mockGenerateContent.mockResolvedValue({
          text: 'Test',
          usageMetadata: {
            promptTokenCount: 10,
            candidatesTokenCount: 5,
            totalTokenCount: 15,
          },
          candidates: [{ finishReason }],
        });

        const response = await client.createChatCompletion({
          messages: [{ role: 'user', content: 'Test' }],
        });

        expect(response.finishReason).toBe(expectedFinishReason);
      }
    });

    it('should throw error when no usage metadata in response', async () => {
      mockGenerateContent.mockResolvedValue({
        text: 'Test',
        usageMetadata: undefined, // Missing usage metadata
        candidates: [{ finishReason: 'STOP' }],
      });

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
        yield { text: 'Hello' };
        yield { text: ' World' };
      })();

      mockGenerateContentStream.mockResolvedValue(mockStream);

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
    });

    it('should emit done signal at stream end', async () => {
      const mockStream = (async function* () {
        yield { text: 'Test' };
      })();

      mockGenerateContentStream.mockResolvedValue(mockStream);

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

    it('should skip empty text chunks', async () => {
      const mockStream = (async function* () {
        yield { text: '' }; // Empty chunk
        yield { text: 'Valid text' };
        yield { text: '' }; // Another empty chunk
      })();

      mockGenerateContentStream.mockResolvedValue(mockStream);

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
      mockGenerateContent.mockRejectedValue(error);

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
      mockGenerateContent.mockRejectedValue(error);

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
      mockGenerateContent.mockRejectedValue(error);

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
      mockGenerateContent.mockRejectedValue('string error');

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
      mockGenerateContentStream.mockRejectedValue(error);

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
      mockGenerateContent.mockResolvedValue({
        text: 'I understand the context.',
        usageMetadata: {
          promptTokenCount: 100,
          candidatesTokenCount: 20,
          totalTokenCount: 120,
        },
        candidates: [{ finishReason: 'STOP' }],
      });

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

      // System instruction extracted, all other messages converted
      expect(mockGenerateContent).toHaveBeenCalledWith({
        model: 'gemini-1.5-flash',
        contents: [
          { role: 'user', parts: [{ text: 'Hello!' }] },
          { role: 'model', parts: [{ text: 'Hi there!' }] },
          { role: 'user', parts: [{ text: 'How are you?' }] },
          { role: 'model', parts: [{ text: 'I am well, thanks!' }] },
          { role: 'user', parts: [{ text: 'What did we talk about?' }] },
        ],
        config: {
          systemInstruction: 'You are a context-aware assistant.',
          temperature: 0.7,
          maxOutputTokens: undefined,
          topP: undefined,
        },
      });
    });

    it('should work without system instruction', async () => {
      mockGenerateContent.mockResolvedValue({
        text: 'Hello!',
        usageMetadata: {
          promptTokenCount: 5,
          candidatesTokenCount: 3,
          totalTokenCount: 8,
        },
        candidates: [{ finishReason: 'STOP' }],
      });

      const client = new GeminiClient({
        provider: 'gemini',
        model: 'gemini-1.5-flash',
        apiKey: 'test-api-key',
      });

      await client.createChatCompletion({
        messages: [{ role: 'user', content: 'Hi!' }],
      });

      expect(mockGenerateContent).toHaveBeenCalledWith({
        model: 'gemini-1.5-flash',
        contents: [{ role: 'user', parts: [{ text: 'Hi!' }] }],
        config: {
          systemInstruction: undefined,
          temperature: 0.7,
          maxOutputTokens: undefined,
          topP: undefined,
        },
      });
    });

    it('should generate unique IDs for responses', async () => {
      mockGenerateContent.mockResolvedValue({
        text: 'Test',
        usageMetadata: {
          promptTokenCount: 5,
          candidatesTokenCount: 3,
          totalTokenCount: 8,
        },
        candidates: [{ finishReason: 'STOP' }],
      });

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
