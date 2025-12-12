/**
 * LLM Client Factory
 *
 * Creates LLM clients with singleton pattern for connection reuse.
 * Supports environment-based configuration and manual override.
 */
import { AnthropicClient } from './providers/anthropic';
import { GeminiClient } from './providers/gemini';
import { LocalClient } from './providers/local';
import { OpenAIClient } from './providers/openai';
import { DeepSeekClient } from './providers/deepseek';
import type { LLMClient, LLMConfig, LLMProvider } from './types';
import { LLMError } from './types';

/**
 * Singleton instance
 */
let llmInstance: LLMClient | null = null;

/**
 * Load LLM configuration from environment variables
 *
 * Environment variables:
 * - LLM_PROVIDER: 'openai' | 'anthropic' | 'gemini' | 'local'
 * - LLM_MODEL: Model identifier (e.g., 'gpt-4o', 'claude-3-5-sonnet-20241022')
 * - LLM_API_KEY: API key for the provider (not needed for 'local')
 * - LLM_TEMPERATURE: Optional temperature (0-1)
 * - LLM_MAX_TOKENS: Optional max tokens
 * - LLM_TOP_P: Optional top_p (0-1)
 *
 * Provider-specific fallbacks:
 * - OPENAI_API_KEY: Falls back to this if LLM_PROVIDER=openai and LLM_API_KEY not set
 * - ANTHROPIC_API_KEY: Falls back to this if LLM_PROVIDER=anthropic and LLM_API_KEY not set
 * - GOOGLE_API_KEY: Falls back to this if LLM_PROVIDER=gemini and LLM_API_KEY not set
 * - LOCAL_API_URL: Base URL for local provider (default: http://127.0.0.1:8000/v1)
 */
export function loadConfigFromEnv(): LLMConfig {
  const provider = (process.env.LLM_PROVIDER ?? 'openai') as LLMProvider;

  // Get API key with provider-specific fallback
  let apiKey = process.env.LLM_API_KEY;

  if (!apiKey) {
    switch (provider) {
      case 'openai':
        apiKey = process.env.OPENAI_API_KEY;
        break;
      case 'anthropic':
        apiKey = process.env.ANTHROPIC_API_KEY;
        break;
      case 'gemini':
        apiKey = process.env.GOOGLE_API_KEY;
        break;
      case 'local':
        // Local provider doesn't need an API key
        apiKey = 'not-needed';
        break;
      case 'deepseek':
        apiKey = process.env.DEEPSEEK_API_KEY;
        break;
    }
  }

  if (!apiKey) {
    throw new LLMError(
      `No API key found for provider: ${provider}. Set LLM_API_KEY or provider-specific key (OPENAI_API_KEY, ANTHROPIC_API_KEY, GOOGLE_API_KEY)`,
      provider,
      'MISSING_API_KEY',
    );
  }

  // Get model with provider-specific defaults
  const model = process.env.LLM_MODEL ?? getDefaultModel(provider);

  // Get base URL for local provider
  const baseUrl = provider === 'local' ? process.env.LOCAL_API_URL : undefined;

  // Parse optional parameters
  const temperature = process.env.LLM_TEMPERATURE
    ? parseFloat(process.env.LLM_TEMPERATURE)
    : undefined;

  const maxTokens = process.env.LLM_MAX_TOKENS
    ? parseInt(process.env.LLM_MAX_TOKENS, 10)
    : undefined;

  const topP = process.env.LLM_TOP_P
    ? parseFloat(process.env.LLM_TOP_P)
    : undefined;

  return {
    provider,
    model,
    apiKey,
    baseUrl,
    temperature,
    maxTokens,
    topP,
  };
}

/**
 * Get default model for each provider
 */
function getDefaultModel(provider: LLMProvider): string {
  switch (provider) {
    case 'openai':
      return 'gpt-4o-mini'; // Cost-effective default
    case 'anthropic':
      return 'claude-3-5-sonnet-20241022'; // Latest Sonnet
    case 'gemini':
      return 'gemini-1.5-flash'; // Fast and cost-effective
    case 'local':
      return 'claude-sonnet-4-5'; // Latest local Claude model
    case 'deepseek':
      return 'deepseek-chat';
    default:
      throw new LLMError(
        `Unknown provider: ${provider}`,
        provider,
        'UNKNOWN_PROVIDER',
      );
  }
}

/**
 * Create LLM client
 *
 * Uses singleton pattern - returns existing instance if available.
 * Pass config to override environment variables.
 *
 * @param config - Optional configuration to override environment variables
 * @returns LLM client instance
 *
 * @example
 * ```typescript
 * // Use environment variables
 * const llm = createLLMClient();
 *
 * // Override with specific config
 * const llm = createLLMClient({
 *   provider: 'openai',
 *   model: 'gpt-4o',
 *   apiKey: process.env.OPENAI_API_KEY!,
 * });
 * ```
 */
export function createLLMClient(config?: LLMConfig): LLMClient {
  // Return singleton if exists and no config override provided
  if (llmInstance && !config) {
    return llmInstance;
  }

  // Load config from environment if not provided
  const finalConfig = config ?? loadConfigFromEnv();

  // Validate configuration
  if (!finalConfig.apiKey) {
    throw new LLMError(
      'API key is required',
      finalConfig.provider,
      'MISSING_API_KEY',
    );
  }

  if (!finalConfig.model) {
    throw new LLMError(
      'Model is required',
      finalConfig.provider,
      'MISSING_MODEL',
    );
  }

  // Create provider-specific client
  let client: LLMClient;

  switch (finalConfig.provider) {
    case 'openai':
      client = new OpenAIClient(finalConfig);
      break;
    case 'anthropic':
      client = new AnthropicClient(finalConfig);
      break;
    case 'gemini':
      client = new GeminiClient(finalConfig);
      break;
    case 'local':
      client = new LocalClient(finalConfig);
      break;
    case 'deepseek':
      client = new DeepSeekClient(finalConfig);
      break;
    default:
      throw new LLMError(
        `Unsupported provider: ${finalConfig.provider}`,
        finalConfig.provider,
        'UNSUPPORTED_PROVIDER',
      );
  }

  // Store singleton if no config override
  if (!config) {
    llmInstance = client;
  }

  return client;
}

/**
 * Reset singleton instance
 * Useful for testing or when switching providers at runtime
 */
export function resetLLMClient(): void {
  llmInstance = null;
}
