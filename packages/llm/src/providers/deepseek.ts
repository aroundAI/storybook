/**
 * DeepSeek Provider Implementation
 *
 * Implements LLMClient interface for DeepSeek models:
 * - deepseek-chat (V3)
 * - deepseek-coder (V2)
 *
 * DeepSeek is API-compatible with OpenAI.
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
 * DeepSeek client implementation (OpenAI compatible)
 */
export class DeepSeekClient implements LLMClient {
  private client: OpenAI;
  private config: LLMConfig;

  constructor(config: LLMConfig) {
    if (config.provider !== 'deepseek') {
      throw new LLMError(
        'Invalid provider for DeepSeek client',
        'deepseek',
        'INVALID_PROVIDER',
      );
    }

    this.config = config;
    this.client = new OpenAI({
      apiKey: config.apiKey,
      baseURL: 'https://api.deepseek.com',
    });
  }

  getProvider() {
    return 'deepseek' as const;
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
          'deepseek',
          'NO_CHOICES',
        );
      }

      const usage = response.usage;

      if (!usage) {
        throw new LLMError(
          'No usage information returned',
          'deepseek',
          'NO_USAGE',
        );
      }

      const cost = this.calculateCost(
        usage.prompt_tokens,
        usage.completion_tokens,
      );

      return {
        id: response.id,
        provider: 'deepseek',
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
   * DeepSeek V3 is very cheap: ~$0.14/1M input, $0.28/1M output (cache hit cheaper)
   * We'll add this to pricing.ts later, for now we will stub or assume standard rate if not found
   */
  calculateCost(promptTokens: number, completionTokens: number): CostBreakdown {
    // Fallback to simple calculation if needed or just use getModelPricing which might throw or return 0
    try {
      const pricing = getModelPricing('deepseek', this.config.model);
      return calculateTokenCost(promptTokens, completionTokens, pricing);
    } catch {
      // Fallback pricing for DeepSeek V3 if not in registry
      // Input: $0.14 / 1M tokens
      // Output: $0.28 / 1M tokens
      const pricing = {
        prompt: 0.14,
        completion: 0.28,
      };
      return calculateTokenCost(promptTokens, completionTokens, pricing);
    }
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
   * Handle OpenAI-specific errors (DeepSeek uses same error structure)
   */
  private handleError(error: unknown): LLMError {
    if (error instanceof OpenAI.APIError) {
      return new LLMError(
        error.message,
        'deepseek',
        error.code ?? 'UNKNOWN_ERROR',
        error.status,
      );
    }

    if (error instanceof Error) {
      return new LLMError(error.message, 'deepseek', 'UNKNOWN_ERROR');
    }

    return new LLMError('Unknown error occurred', 'deepseek', 'UNKNOWN_ERROR');
  }
}
