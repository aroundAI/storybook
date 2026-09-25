/**
 * Anthropic Provider Implementation
 *
 * Implements LLMClient interface for Anthropic Claude models:
 * - Claude 3.5 Sonnet (latest)
 * - Claude 3 Opus (most capable)
 * - Claude 3 Sonnet
 * - Claude 3 Haiku (fastest)
 */
import Anthropic from '@anthropic-ai/sdk';

import { vendorUrl } from '@kit/shared/vendors';

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
 * Anthropic client implementation
 */
export class AnthropicClient implements LLMClient {
  private client: Anthropic;
  private config: LLMConfig;

  constructor(config: LLMConfig) {
    if (config.provider !== 'anthropic') {
      throw new LLMError(
        'Invalid provider for Anthropic client',
        'anthropic',
        'INVALID_PROVIDER',
      );
    }

    this.config = config;
    // An explicit baseURL, so the SDK never reads ANTHROPIC_BASE_URL (FILM-1805).
    this.client = new Anthropic({
      apiKey: config.apiKey,
      baseURL: vendorUrl('anthropic'),
    });
  }

  getProvider() {
    return 'anthropic' as const;
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
      // Extract system message (Anthropic handles it separately)
      const systemMessage = request.messages.find((m) => m.role === 'system');
      const messages = request.messages
        .filter((m) => m.role !== 'system')
        .map(this.mapMessage);

      const response = await this.client.messages.create({
        model: this.config.model,
        messages,
        system: systemMessage?.content,
        temperature: request.temperature ?? this.config.temperature ?? 0.7,
        max_tokens: request.maxTokens ?? this.config.maxTokens ?? 1024,
        top_p: request.topP ?? this.config.topP,
      });

      const content = response.content[0];

      if (!content || content.type !== 'text') {
        throw new LLMError(
          'No text content in response',
          'anthropic',
          'NO_CONTENT',
        );
      }

      const cost = this.calculateCost(
        response.usage.input_tokens,
        response.usage.output_tokens,
      );

      return {
        id: response.id,
        provider: 'anthropic',
        model: this.config.model,
        message: {
          role: 'assistant',
          content: content.text,
        },
        usage: {
          promptTokens: response.usage.input_tokens,
          completionTokens: response.usage.output_tokens,
          totalTokens:
            response.usage.input_tokens + response.usage.output_tokens,
        },
        cost,
        finishReason: this.mapFinishReason(response.stop_reason),
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
      // Extract system message
      const systemMessage = request.messages.find((m) => m.role === 'system');
      const messages = request.messages
        .filter((m) => m.role !== 'system')
        .map(this.mapMessage);

      const stream = await this.client.messages.create({
        model: this.config.model,
        messages,
        system: systemMessage?.content,
        temperature: request.temperature ?? this.config.temperature ?? 0.7,
        max_tokens: request.maxTokens ?? this.config.maxTokens ?? 1024,
        top_p: request.topP ?? this.config.topP,
        stream: true,
      });

      for await (const event of stream) {
        if (event.type === 'content_block_delta') {
          if (event.delta.type === 'text_delta') {
            yield {
              delta: event.delta.text,
              done: false,
            };
          }
        }

        if (event.type === 'message_stop') {
          yield {
            delta: '',
            done: true,
          };
        }
      }
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Calculate cost for token usage
   */
  calculateCost(promptTokens: number, completionTokens: number): CostBreakdown {
    const pricing = getModelPricing('anthropic', this.config.model);
    return calculateTokenCost(promptTokens, completionTokens, pricing);
  }

  /**
   * Map our ChatMessage to Anthropic's message format
   */
  private mapMessage(message: ChatMessage): Anthropic.MessageParam {
    return {
      role: message.role === 'assistant' ? 'assistant' : 'user',
      content: message.content,
    };
  }

  /**
   * Map Anthropic stop reason to our type
   */
  private mapFinishReason(
    reason: string | null,
  ): 'stop' | 'length' | 'function_call' | 'content_filter' {
    switch (reason) {
      case 'end_turn':
        return 'stop';
      case 'max_tokens':
        return 'length';
      case 'stop_sequence':
        return 'stop';
      default:
        return 'stop';
    }
  }

  /**
   * Handle Anthropic-specific errors
   */
  private handleError(error: unknown): LLMError {
    if (error instanceof Anthropic.APIError) {
      return new LLMError(
        error.message,
        'anthropic',
        'API_ERROR',
        error.status,
      );
    }

    if (error instanceof Error) {
      return new LLMError(error.message, 'anthropic', 'UNKNOWN_ERROR');
    }

    return new LLMError('Unknown error occurred', 'anthropic', 'UNKNOWN_ERROR');
  }
}
