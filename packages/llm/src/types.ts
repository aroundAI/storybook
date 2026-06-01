/**
 * LLM Abstraction Layer - Core Types
 *
 * Provides unified interfaces for multiple LLM providers:
 * - OpenAI (GPT-4, GPT-3.5-turbo)
 * - Anthropic (Claude 3.5, Claude 3)
 * - Google Gemini (Gemini 1.5 Pro/Flash)
 * - Local (OpenAI-compatible local API)
 */

/**
 * Supported LLM providers
 */
export type LLMProvider =
  | 'openai'
  | 'anthropic'
  | 'gemini'
  | 'local'
  | 'deepseek';

/**
 * Message role in chat conversation
 */
export type MessageRole = 'system' | 'user' | 'assistant' | 'function';

/**
 * Chat message structure
 */
export interface ChatMessage {
  role: MessageRole;
  content: string;
  name?: string;
}

/**
 * LLM client configuration
 */
export interface LLMConfig {
  provider: LLMProvider;
  model: string;
  apiKey?: string;
  baseUrl?: string; // Optional base URL for custom/local providers
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  // Gemini-specific: Vertex AI / Cloud Console configuration
  vertexai?: boolean; // Enable Vertex AI Express mode (Cloud Console API key)
  project?: string; // GCP project ID (e.g., 'stbook')
  location?: string; // GCP region (default: 'us-central1')
}

/**
 * Function calling definition (for OpenAI and compatible providers)
 */
export interface FunctionDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

/**
 * Chat completion request options
 */
export interface ChatCompletionRequest {
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  stream?: boolean;
  functions?: FunctionDefinition[];
}

/**
 * Token usage information
 */
export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

/**
 * Cost breakdown
 */
export interface CostBreakdown {
  prompt: number;
  completion: number;
  total: number;
}

/**
 * Finish reason for completion
 */
export type FinishReason =
  | 'stop'
  | 'length'
  | 'function_call'
  | 'content_filter';

/**
 * Chat completion response
 */
export interface ChatCompletionResponse {
  id: string;
  provider: LLMProvider;
  model: string;
  message: ChatMessage;
  usage: TokenUsage;
  cost?: CostBreakdown;
  finishReason: FinishReason;
}

/**
 * Streaming chunk
 */
export interface StreamChunk {
  delta: string;
  done: boolean;
}

/**
 * LLM client interface
 *
 * All providers must implement this interface to ensure consistent behavior
 */
export interface LLMClient {
  /**
   * Get the provider name
   */
  getProvider(): LLMProvider;

  /**
   * Get the model name
   */
  getModel(): string;

  /**
   * Create a chat completion
   * @param request - Chat completion options
   * @returns Completion response with usage and cost information
   */
  createChatCompletion(
    request: ChatCompletionRequest,
  ): Promise<ChatCompletionResponse>;

  /**
   * Create a streaming chat completion
   * @param request - Chat completion options
   * @returns Async generator yielding chunks
   */
  createStreamingChatCompletion(
    request: ChatCompletionRequest,
  ): AsyncGenerator<StreamChunk, void, unknown>;

  /**
   * Calculate cost for given token usage
   * @param promptTokens - Number of prompt tokens
   * @param completionTokens - Number of completion tokens
   * @returns Cost breakdown in USD
   */
  calculateCost(promptTokens: number, completionTokens: number): CostBreakdown;
}

/**
 * LLM-specific error class
 */
export class LLMError extends Error {
  constructor(
    message: string,
    public provider: LLMProvider,
    public code?: string,
    public statusCode?: number,
  ) {
    super(message);
    this.name = 'LLMError';
  }
}
