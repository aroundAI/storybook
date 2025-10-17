/**
 * OpenAI Provider Implementation
 *
 * Implements LLMClient interface for OpenAI GPT models:
 * - GPT-4o (latest flagship)
 * - GPT-4 Turbo
 * - GPT-3.5 Turbo
 */
import OpenAI from 'openai';

import { calculateTokenCost, getModelPricing } from '../pricing';
import type {
  ChatCompletionRequest,
  ChatCompletionResponse,
  CostBreakdown,
  LLMClient,
  LLMConfig,
  MessageRole,
  StreamChunk,
} from '../types';
import { LLMError } from '../types';

/**
 * OpenAI client implementation
 */
export class OpenAIClient implements LLMClient {
  private client: OpenAI;
  private config: LLMConfig;

  constructor(config: LLMConfig) {
    if (config.provider !== 'openai') {
      throw new LLMError(
        'Invalid provider for OpenAI client',
        'openai',
        'INVALID_PROVIDER',
      );
    }

    this.config = config;
    this.client = new OpenAI({
      apiKey: config.apiKey,
    });
  }

  getProvider() {
    return 'openai' as const;
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
      const response = await this.client.chat.completions.create({
        model: this.config.model,
        messages: request.messages.map((msg) => {
          const message: Record<string, unknown> = {
            role: this.mapRole(msg.role),
            content: msg.content,
          };
          if (msg.name) {
            message.name = msg.name;
          }
          return message as unknown as OpenAI.ChatCompletionMessageParam;
        }),
        temperature: request.temperature ?? this.config.temperature ?? 0.7,
        max_tokens: request.maxTokens ?? this.config.maxTokens,
        top_p: request.topP ?? this.config.topP,
        functions: request.functions,
      });

      const choice = response.choices[0];

      if (!choice) {
        throw new LLMError(
          'No completion choices returned',
          'openai',
          'NO_CHOICES',
        );
      }

      const usage = response.usage;

      if (!usage) {
        throw new LLMError(
          'No usage information returned',
          'openai',
          'NO_USAGE',
        );
      }

      const cost = this.calculateCost(
        usage.prompt_tokens,
        usage.completion_tokens,
      );

      return {
        id: response.id,
        provider: 'openai',
        model: this.config.model,
        message: {
          role: 'assistant',
          content: choice.message.content ?? '',
        },
        usage: {
          promptTokens: usage.prompt_tokens,
          completionTokens: usage.completion_tokens,
          totalTokens: usage.total_tokens,
        },
        cost,
        finishReason: this.mapFinishReason(choice.finish_reason),
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
      const stream = await this.client.chat.completions.create({
        model: this.config.model,
        messages: request.messages.map((msg) => {
          const message: Record<string, unknown> = {
            role: this.mapRole(msg.role),
            content: msg.content,
          };
          if (msg.name) {
            message.name = msg.name;
          }
          return message as unknown as OpenAI.ChatCompletionMessageParam;
        }),
        temperature: request.temperature ?? this.config.temperature ?? 0.7,
        max_tokens: request.maxTokens ?? this.config.maxTokens,
        top_p: request.topP ?? this.config.topP,
        stream: true,
      });

      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta?.content;

        if (delta) {
          yield {
            delta,
            done: false,
          };
        }

        if (chunk.choices[0]?.finish_reason) {
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
    const pricing = getModelPricing('openai', this.config.model);
    return calculateTokenCost(promptTokens, completionTokens, pricing);
  }

  /**
   * Map our MessageRole to OpenAI's role type
   */
  private mapRole(
    role: MessageRole,
  ): 'system' | 'user' | 'assistant' | 'function' {
    return role;
  }

  /**
   * Map OpenAI finish reason to our type
   */
  private mapFinishReason(
    reason: string | null | undefined,
  ): 'stop' | 'length' | 'function_call' | 'content_filter' {
    switch (reason) {
      case 'stop':
        return 'stop';
      case 'length':
        return 'length';
      case 'function_call':
        return 'function_call';
      case 'content_filter':
        return 'content_filter';
      default:
        return 'stop';
    }
  }

  /**
   * Handle OpenAI-specific errors
   */
  private handleError(error: unknown): LLMError {
    if (error instanceof OpenAI.APIError) {
      return new LLMError(
        error.message,
        'openai',
        error.code ?? 'UNKNOWN_ERROR',
        error.status,
      );
    }

    if (error instanceof Error) {
      return new LLMError(error.message, 'openai', 'UNKNOWN_ERROR');
    }

    return new LLMError('Unknown error occurred', 'openai', 'UNKNOWN_ERROR');
  }
}
