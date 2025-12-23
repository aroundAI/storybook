/**
 * Google Gemini Provider Implementation
 *
 * Implements LLMClient interface for Google Gemini models using the new @google/genai SDK.
 * Supports:
 * - Gemini 3 Flash Preview (latest)
 * - Gemini 2.5 Flash
 * - Gemini 1.5 Pro/Flash
 */
import { GoogleGenAI } from '@google/genai';

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
 * Content part for Gemini API
 */
interface ContentPart {
  text: string;
}

/**
 * Content object for Gemini API
 */
interface Content {
  role: 'user' | 'model';
  parts: ContentPart[];
}

/**
 * Gemini client implementation using new @google/genai SDK
 */
export class GeminiClient implements LLMClient {
  private client: GoogleGenAI;
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
    this.client = new GoogleGenAI({ apiKey: config.apiKey });
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
      const { systemInstruction, contents } = this.buildContents(
        request.messages,
      );

      const response = await this.client.models.generateContent({
        model: this.config.model,
        contents,
        config: {
          systemInstruction,
          temperature: request.temperature ?? this.config.temperature ?? 0.7,
          maxOutputTokens: request.maxTokens ?? this.config.maxTokens,
          topP: request.topP ?? this.config.topP,
        },
      });

      const text = response.text;

      if (!text) {
        throw new LLMError('No text in response', 'gemini', 'NO_CONTENT');
      }

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
        usageMetadata.promptTokenCount ?? 0,
        usageMetadata.candidatesTokenCount ?? 0,
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
          promptTokens: usageMetadata.promptTokenCount ?? 0,
          completionTokens: usageMetadata.candidatesTokenCount ?? 0,
          totalTokens: usageMetadata.totalTokenCount ?? 0,
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
      const { systemInstruction, contents } = this.buildContents(
        request.messages,
      );

      const stream = await this.client.models.generateContentStream({
        model: this.config.model,
        contents,
        config: {
          systemInstruction,
          temperature: request.temperature ?? this.config.temperature ?? 0.7,
          maxOutputTokens: request.maxTokens ?? this.config.maxTokens,
          topP: request.topP ?? this.config.topP,
        },
      });

      for await (const chunk of stream) {
        const text = chunk.text;

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
   * Build contents array from ChatMessage format
   *
   * The new SDK expects:
   * - systemInstruction as a plain string in config
   * - contents as array of { role: 'user' | 'model', parts: [{ text }] }
   */
  private buildContents(messages: ChatMessage[]): {
    systemInstruction: string | undefined;
    contents: Content[];
  } {
    // Extract system message
    const systemMessage = messages.find((m) => m.role === 'system');

    // Filter out system messages and convert to Gemini format
    const contents: Content[] = messages
      .filter((m) => m.role !== 'system')
      .map((msg) => ({
        role: msg.role === 'assistant' ? ('model' as const) : ('user' as const),
        parts: [{ text: msg.content }],
      }));

    if (contents.length === 0) {
      throw new LLMError('No messages to send', 'gemini', 'NO_MESSAGES');
    }

    return {
      systemInstruction: systemMessage?.content,
      contents,
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
    if (error instanceof LLMError) {
      return error;
    }

    if (error instanceof Error) {
      // Check for specific error patterns in message
      if (error.message.includes('API key')) {
        return new LLMError(error.message, 'gemini', 'INVALID_API_KEY');
      }

      if (error.message.includes('quota')) {
        return new LLMError(error.message, 'gemini', 'QUOTA_EXCEEDED');
      }

      if (
        error.message.includes('not found') ||
        error.message.includes('404')
      ) {
        return new LLMError(
          `Model not found: ${this.config.model}. Check if the model name is correct.`,
          'gemini',
          'MODEL_NOT_FOUND',
        );
      }

      return new LLMError(error.message, 'gemini', 'UNKNOWN_ERROR');
    }

    return new LLMError('Unknown error occurred', 'gemini', 'UNKNOWN_ERROR');
  }
}
