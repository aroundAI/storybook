/**
 * @kit/llm - Unified LLM Abstraction Layer
 *
 * Provides a consistent interface for multiple LLM providers:
 * - OpenAI (GPT-4, GPT-3.5-turbo)
 * - Anthropic (Claude 3.5, Claude 3)
 * - Google Gemini (Gemini 1.5 Pro/Flash)
 * - Local (OpenAI-compatible local API)
 *
 * @example
 * ```typescript
 * import { createLLMClient } from '@kit/llm';
 *
 * // Use environment variables
 * const llm = createLLMClient();
 *
 * // Create completion
 * const response = await llm.createChatCompletion({
 *   messages: [
 *     { role: 'system', content: 'You are a helpful assistant.' },
 *     { role: 'user', content: 'Hello!' }
 *   ]
 * });
 *
 * console.log(response.message.content);
 * console.log('Cost:', response.cost?.total);
 * ```
 */

// Factory
export {
  createLLMClient,
  resetLLMClient,
  loadConfigFromEnv,
  DEFAULT_LOCAL_MODEL,
} from './factory';
export { forcedLocalConfig } from './force-local';

// Types
export type {
  LLMProvider,
  MessageRole,
  ChatMessage,
  LLMConfig,
  FunctionDefinition,
  ChatCompletionRequest,
  TokenUsage,
  CostBreakdown,
  FinishReason,
  ChatCompletionResponse,
  StreamChunk,
  LLMClient,
} from './types';

// Error class
export { LLMError } from './types';

// Pricing utilities
export type { ModelPricing } from './pricing';
export {
  OPENAI_PRICING,
  ANTHROPIC_PRICING,
  GEMINI_PRICING,
  LOCAL_PRICING,
  getModelPricing,
  calculateTokenCost,
} from './pricing';

// Provider implementations (for advanced use cases)
export { OpenAIClient } from './providers/openai';
export { AnthropicClient } from './providers/anthropic';
export { GeminiClient } from './providers/gemini';
export { LocalClient } from './providers/local';

// Analytics (for usage tracking)
export type { LLMUsageEvent } from './analytics';
export { logLLMUsage } from './analytics';
