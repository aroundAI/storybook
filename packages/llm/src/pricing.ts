/**
 * LLM Pricing Data
 *
 * Prices are per 1 million tokens (USD)
 * Updated: May 2026
 *
 * Sources:
 *   - Google: https://ai.google.dev/gemini-api/docs/pricing
 *   - OpenAI: https://openai.com/api/pricing
 *   - Anthropic: https://www.anthropic.com/pricing
 *   - DeepSeek: https://platform.deepseek.com
 */

export interface ModelPricing {
  prompt: number; // USD per 1M prompt tokens
  completion: number; // USD per 1M completion tokens
}

/**
 * OpenAI model pricing
 * Source: https://openai.com/api/pricing (May 2026)
 */
export const OPENAI_PRICING: Record<string, ModelPricing> = {
  // GPT-4.1 family (Apr 2025+)
  'gpt-4.1': { prompt: 2, completion: 8 },
  'gpt-4.1-mini': { prompt: 0.4, completion: 1.6 },
  'gpt-4.1-nano': { prompt: 0.1, completion: 0.4 },

  // o-series reasoning models
  'o4-mini': { prompt: 1.1, completion: 4.4 },
  o3: { prompt: 2, completion: 8 },
  'o3-mini': { prompt: 1.1, completion: 4.4 },

  // GPT-4o models (legacy — still available)
  'gpt-4o': { prompt: 2.5, completion: 10 },
  'gpt-4o-mini': { prompt: 0.15, completion: 0.6 },
  'gpt-4o-2024-08-06': { prompt: 2.5, completion: 10 },
  'gpt-4o-2024-05-13': { prompt: 5, completion: 15 },

  // GPT-4 Turbo (legacy)
  'gpt-4-turbo': { prompt: 10, completion: 30 },
  'gpt-4-turbo-preview': { prompt: 10, completion: 30 },
  'gpt-4-turbo-2024-04-09': { prompt: 10, completion: 30 },

  // GPT-4 (legacy)
  'gpt-4': { prompt: 30, completion: 60 },

  // GPT-3.5 Turbo (legacy)
  'gpt-3.5-turbo': { prompt: 0.5, completion: 1.5 },
};

/**
 * Anthropic Claude pricing
 * Source: https://www.anthropic.com/pricing (May 2026)
 */
export const ANTHROPIC_PRICING: Record<string, ModelPricing> = {
  // Claude 4.x (current generation — May 2026)
  'claude-opus-4-7': { prompt: 5, completion: 25 },
  'claude-sonnet-4-6': { prompt: 3, completion: 15 },
  'claude-haiku-4-5': { prompt: 1, completion: 5 },

  // Claude 4.0 (deprecated — retiring June 15, 2026)
  'claude-sonnet-4-5': { prompt: 3, completion: 15 },
  'claude-sonnet-4': { prompt: 3, completion: 15 },
  'claude-opus-4': { prompt: 15, completion: 75 },
  'claude-haiku-4': { prompt: 1, completion: 5 },

  // Claude 3.5 (legacy)
  'claude-3-5-sonnet-20241022': { prompt: 3, completion: 15 },
  'claude-3-5-sonnet-20240620': { prompt: 3, completion: 15 },

  // Claude 3 (legacy)
  'claude-3-opus-20240229': { prompt: 15, completion: 75 },
  'claude-3-sonnet-20240229': { prompt: 3, completion: 15 },
  'claude-3-haiku-20240307': { prompt: 0.25, completion: 1.25 },
};

/**
 * Google Gemini pricing (standard context ≤200K tokens)
 * Source: https://ai.google.dev/gemini-api/docs/pricing (May 2026)
 *
 * Note: Pro models have tiered pricing (2x input / 1.5x output above 200K).
 * We use the standard tier here since our prompts are well under 200K.
 */
export const GEMINI_PRICING: Record<string, ModelPricing> = {
  // Gemini 3.1 (latest — May 2026)
  'gemini-3.1-pro-preview': { prompt: 2, completion: 12 },
  'gemini-3.1-flash-lite': { prompt: 0.25, completion: 1.5 },
  'gemini-3.1-flash-lite-preview': { prompt: 0.25, completion: 1.5 },

  // Gemini 3 (active preview — frontier class, restrictive rate limits)
  'gemini-3-flash-preview': { prompt: 0.5, completion: 3 },

  // Gemini 2.5 (stable GA — recommended for production)
  'gemini-2.5-flash': { prompt: 0.3, completion: 2.5 },
  'gemini-2.5-flash-lite': { prompt: 0.1, completion: 0.4 },
  'gemini-2.5-pro': { prompt: 1.25, completion: 10 },

  // Gemini 2.0 (deprecated — shut down per Google pricing page May 2026)
  'gemini-2.0-flash': { prompt: 0.1, completion: 0.4 },

  // Gemini 1.5 (legacy)
  'gemini-1.5-pro': { prompt: 1.25, completion: 5 },
  'gemini-1.5-flash': { prompt: 0.075, completion: 0.3 },
  'gemini-1.5-flash-8b': { prompt: 0.0375, completion: 0.15 },
};

/**
 * DeepSeek pricing (cache-miss rates)
 * Source: https://platform.deepseek.com (May 2026)
 */
export const DEEPSEEK_PRICING: Record<string, ModelPricing> = {
  // DeepSeek V4 (current)
  'deepseek-v4-flash': { prompt: 0.14, completion: 0.28 },
  'deepseek-v4-pro': { prompt: 0.435, completion: 0.87 },

  // Legacy aliases (deprecated — retiring July 24, 2026)
  'deepseek-chat': { prompt: 0.14, completion: 0.28 },
  'deepseek-coder': { prompt: 0.14, completion: 0.28 },
};

/**
 * Local provider pricing (OpenAI-compatible local API)
 * Source: Local development - no cost
 */
export const LOCAL_PRICING: Record<string, ModelPricing> = {
  'claude-sonnet-4-5': { prompt: 0, completion: 0 },
  'claude-sonnet-4': { prompt: 0, completion: 0 },
  'claude-opus-4': { prompt: 0, completion: 0 },
  'claude-haiku-4': { prompt: 0, completion: 0 },
};

/**
 * Get pricing for a model
 * @param provider - LLM provider
 * @param model - Model name
 * @returns Pricing information or default fallback
 */
export function getModelPricing(
  provider: 'openai' | 'anthropic' | 'gemini' | 'local' | 'deepseek',
  model: string,
): ModelPricing {
  switch (provider) {
    case 'openai':
      return OPENAI_PRICING[model] ?? OPENAI_PRICING['gpt-4o-mini']!;
    case 'anthropic':
      return ANTHROPIC_PRICING[model] ?? ANTHROPIC_PRICING['claude-haiku-4-5']!;
    case 'gemini':
      return GEMINI_PRICING[model] ?? GEMINI_PRICING['gemini-2.5-flash']!;
    case 'deepseek':
      return DEEPSEEK_PRICING[model] ?? DEEPSEEK_PRICING['deepseek-v4-flash']!;
    case 'local':
      return LOCAL_PRICING[model] ?? LOCAL_PRICING['claude-sonnet-4-5']!;
    default:
      // Fallback to cheapest option
      return { prompt: 0.14, completion: 0.28 };
  }
}

/**
 * Calculate cost for token usage
 * @param promptTokens - Number of prompt tokens
 * @param completionTokens - Number of completion tokens
 * @param pricing - Model pricing information
 * @returns Cost breakdown in USD
 */
export function calculateTokenCost(
  promptTokens: number,
  completionTokens: number,
  pricing: ModelPricing,
): { prompt: number; completion: number; total: number } {
  const promptCost = (promptTokens / 1_000_000) * pricing.prompt;
  const completionCost = (completionTokens / 1_000_000) * pricing.completion;

  return {
    prompt: promptCost,
    completion: completionCost,
    total: promptCost + completionCost,
  };
}
