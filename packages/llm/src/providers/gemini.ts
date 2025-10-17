/**
 * Google Gemini Provider Implementation
 *
 * Implements LLMClient interface for Google Gemini models:
 * - Gemini 1.5 Pro (most capable)
 * - Gemini 1.5 Flash (fastest)
 * - Gemini 1.5 Flash-8B (ultra-efficient)
 */
import { GoogleGenerativeAI } from '@google/generative-ai';

import { calculateTokenCost, getModelPricing } from '../pricing';
import type {
  ChatCompletionRequest,
  ChatCompletionResponse,
  ChatMessage,
  CostBreakdown,
  LLMClient,
  LLMConfig,
  StreamChunk,
} from '../types';
import { LLMError } from '../types';

/**
 * Gemini client implementation
 */
export class GeminiClient implements LLMClient {
  private client: GoogleGenerativeAI;
  private config: LLMConfig;

  constructor(config: LLMConfig) {
    if (config.provider !== 'gemini') {
      throw new LLMError(
        'Invalid provider for Gemini client',
        'gemini',
        'INVALID_PROVIDER',
      );
    }

    this.config = config;
    this.client = new GoogleGenerativeAI(config.apiKey);
  }

  getProvider() {
    return 'gemini' as const;
  }

  getModel() {
    return this.config.model;
  }

  /**
   * Create a chat completion
   */
  async createChatCompletion(
    request: ChatCompletionRequest,
  ): Promise<ChatCompletionResponse> {
    try {
      const model = this.client.getGenerativeModel({
        model: this.config.model,
      });

      // Build Gemini chat history
      const { systemInstruction, history, currentMessage } =
        this.buildChatHistory(request.messages);

      // Start chat with history
      const chat = model.startChat({
        history,
        generationConfig: {
          temperature: request.temperature ?? this.config.temperature ?? 0.7,
          maxOutputTokens: request.maxTokens ?? this.config.maxTokens,
          topP: request.topP ?? this.config.topP,
        },
        systemInstruction,
      });

      // Send message and get response
      const result = await chat.sendMessage(currentMessage);
      const response = result.response;

      const text = response.text();

      // Get usage metadata
      const usageMetadata = response.usageMetadata;

      if (!usageMetadata) {
        throw new LLMError(
          'No usage metadata in response',
          'gemini',
          'NO_USAGE',
        );
      }

      const cost = this.calculateCost(
        usageMetadata.promptTokenCount,
        usageMetadata.candidatesTokenCount,
      );

      return {
        id: this.generateId(),
        provider: 'gemini',
        model: this.config.model,
        message: {
          role: 'assistant',
          content: text,
        },
        usage: {
          promptTokens: usageMetadata.promptTokenCount,
          completionTokens: usageMetadata.candidatesTokenCount,
          totalTokens: usageMetadata.totalTokenCount,
        },
        cost,
        finishReason: this.mapFinishReason(
          response.candidates?.[0]?.finishReason,
        ),
      };
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Create a streaming chat completion
   */
  async *createStreamingChatCompletion(
    request: ChatCompletionRequest,
  ): AsyncGenerator<StreamChunk, void, unknown> {
    try {
      const model = this.client.getGenerativeModel({
        model: this.config.model,
      });

      // Build Gemini chat history
      const { systemInstruction, history, currentMessage } =
        this.buildChatHistory(request.messages);

      // Start chat with history
      const chat = model.startChat({
        history,
        generationConfig: {
          temperature: request.temperature ?? this.config.temperature ?? 0.7,
          maxOutputTokens: request.maxTokens ?? this.config.maxTokens,
          topP: request.topP ?? this.config.topP,
        },
        systemInstruction,
      });

      // Send message and stream response
      const result = await chat.sendMessageStream(currentMessage);

      for await (const chunk of result.stream) {
        const text = chunk.text();

        if (text) {
          yield {
            delta: text,
            done: false,
          };
        }
      }

      yield {
        delta: '',
        done: true,
      };
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Calculate cost for token usage
   */
  calculateCost(promptTokens: number, completionTokens: number): CostBreakdown {
    const pricing = getModelPricing('gemini', this.config.model);
    return calculateTokenCost(promptTokens, completionTokens, pricing);
  }

  /**
   * Build Gemini chat history from our ChatMessage format
   *
   * Gemini requires:
   * - System instructions separate from chat history
   * - History as array of { role: 'user' | 'model', parts: [{ text }] }
   * - Last message separate for sending
   */
  private buildChatHistory(messages: ChatMessage[]): {
    systemInstruction: string | undefined;
    history: Array<{ role: string; parts: Array<{ text: string }> }>;
    currentMessage: string;
  } {
    // Extract system message
    const systemMessage = messages.find((m) => m.role === 'system');

    // Filter out system messages and get conversation messages
    const conversationMessages = messages.filter((m) => m.role !== 'system');

    // Last message is what we're sending
    const lastMessage = conversationMessages[conversationMessages.length - 1];

    if (!lastMessage) {
      throw new LLMError('No messages to send', 'gemini', 'NO_MESSAGES');
    }

    // Build history (all messages except the last one)
    const history = conversationMessages.slice(0, -1).map((msg) => ({
      role: msg.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: msg.content }],
    }));

    return {
      systemInstruction: systemMessage?.content,
      history,
      currentMessage: lastMessage.content,
    };
  }

  /**
   * Map Gemini finish reason to our type
   */
  private mapFinishReason(
    reason: string | undefined,
  ): 'stop' | 'length' | 'function_call' | 'content_filter' {
    switch (reason) {
      case 'STOP':
        return 'stop';
      case 'MAX_TOKENS':
        return 'length';
      case 'SAFETY':
        return 'content_filter';
      case 'RECITATION':
        return 'content_filter';
      default:
        return 'stop';
    }
  }

  /**
   * Generate a unique ID for the response
   */
  private generateId(): string {
    return `gemini-${Date.now()}-${Math.random().toString(36).substring(7)}`;
  }

  /**
   * Handle Gemini-specific errors
   */
  private handleError(error: unknown): LLMError {
    if (error instanceof Error) {
      // Check for specific error patterns in message
      if (error.message.includes('API key')) {
        return new LLMError(error.message, 'gemini', 'INVALID_API_KEY');
      }

      if (error.message.includes('quota')) {
        return new LLMError(error.message, 'gemini', 'QUOTA_EXCEEDED');
      }

      return new LLMError(error.message, 'gemini', 'UNKNOWN_ERROR');
    }

    return new LLMError('Unknown error occurred', 'gemini', 'UNKNOWN_ERROR');
  }
}
