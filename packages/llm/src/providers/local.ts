/**
 * Local Provider Implementation
 *
 * Implements LLMClient interface for a local OpenAI-compatible server,
 * Ollama by default (`ollama pull llama3.1`). LM Studio, vLLM and llama.cpp's
 * server speak the same protocol; point LOCAL_API_URL at them instead.
 *
 * Uses OpenAI SDK with custom base URL pointing to local server.
 */
import OpenAI from 'openai';

import { localApiUrl, vendorSandboxEnabled } from '@kit/shared/vendors';

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
 * Default local API base URL
 */
const DEFAULT_LOCAL_BASE_URL = 'http://localhost:11434/v1';

/**
 * Local client implementation using OpenAI-compatible API
 */
export class LocalClient implements LLMClient {
  private client: OpenAI;
  private config: LLMConfig;

  constructor(config: LLMConfig) {
    if (config.provider !== 'local') {
      throw new LLMError(
        'Invalid provider for Local client',
        'local',
        'INVALID_PROVIDER',
      );
    }

    // Prompts go to whatever this points at, so it only runs in a sandbox
    // (KB-21): dev or test by name, VENDOR_SANDBOX=1, and never in a Lambda.
    if (!vendorSandboxEnabled()) {
      throw new LLMError(
        'The local provider only runs in a vendor sandbox: it needs NODE_ENV=development or test, VENDOR_SANDBOX=1, and a process that is not an AWS Lambda',
        'local',
        'LOCAL_PROVIDER_DISABLED',
      );
    }

    this.config = config;

    // A custom base URL must be a local address; a bad one throws rather than
    // falling back to the default port.
    const baseURL = config.baseUrl
      ? localApiUrl(config.baseUrl)
      : DEFAULT_LOCAL_BASE_URL;

    this.client = new OpenAI({
      apiKey: 'not-needed', // Local API doesn't require auth
      baseURL,
    });
  }

  getProvider() {
    return 'local' as const;
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
      });

      const choice = response.choices[0];

      if (!choice) {
        throw new LLMError(
          'No completion choices returned',
          'local',
          'NO_CHOICES',
        );
      }

      const usage = response.usage;

      if (!usage) {
        throw new LLMError(
          'No usage information returned',
          'local',
          'NO_USAGE',
        );
      }

      const cost = this.calculateCost(
        usage.prompt_tokens,
        usage.completion_tokens,
      );

      return {
        id: response.id,
        provider: 'local',
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
   * Calculate cost for token usage (free for local)
   */
  calculateCost(promptTokens: number, completionTokens: number): CostBreakdown {
    const pricing = getModelPricing('local', this.config.model);
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
   * Handle local API errors
   */
  private handleError(error: unknown): LLMError {
    if (error instanceof OpenAI.APIError) {
      return new LLMError(
        error.message,
        'local',
        error.code ?? 'UNKNOWN_ERROR',
        error.status,
      );
    }

    if (error instanceof Error) {
      // Check for connection errors
      if (error.message.includes('ECONNREFUSED')) {
        return new LLMError(
          'Cannot connect to local API. Make sure the server is running at the configured base URL.',
          'local',
          'CONNECTION_REFUSED',
        );
      }

      return new LLMError(error.message, 'local', 'UNKNOWN_ERROR');
    }

    return new LLMError('Unknown error occurred', 'local', 'UNKNOWN_ERROR');
  }
}
