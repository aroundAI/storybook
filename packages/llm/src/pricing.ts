/**
 * LLM Pricing Data
 *
 * Prices are per 1 million tokens (USD)
 * Updated: October 2025
 */

export interface ModelPricing {
  prompt: number; // USD per 1M prompt tokens
  completion: number; // USD per 1M completion tokens
}

/**
 * OpenAI model pricing
 * Source: https://openai.com/pricing
 */
export const OPENAI_PRICING: Record<string, ModelPricing> = {
  // GPT-4o models
  'gpt-4o': { prompt: 2.5, completion: 10 },
  'gpt-4o-mini': { prompt: 0.15, completion: 0.6 },
  'gpt-4o-2024-08-06': { prompt: 2.5, completion: 10 },
  'gpt-4o-2024-05-13': { prompt: 5, completion: 15 },

  // GPT-4 Turbo
  'gpt-4-turbo': { prompt: 10, completion: 30 },
  'gpt-4-turbo-preview': { prompt: 10, completion: 30 },
  'gpt-4-turbo-2024-04-09': { prompt: 10, completion: 30 },
  'gpt-4-0125-preview': { prompt: 10, completion: 30 },
  'gpt-4-1106-preview': { prompt: 10, completion: 30 },

  // GPT-4 (original)
  'gpt-4': { prompt: 30, completion: 60 },
  'gpt-4-0613': { prompt: 30, completion: 60 },
  'gpt-4-0314': { prompt: 30, completion: 60 },
  'gpt-4-32k': { prompt: 60, completion: 120 },
  'gpt-4-32k-0613': { prompt: 60, completion: 120 },

  // GPT-3.5 Turbo
  'gpt-3.5-turbo': { prompt: 0.5, completion: 1.5 },
  'gpt-3.5-turbo-0125': { prompt: 0.5, completion: 1.5 },
  'gpt-3.5-turbo-1106': { prompt: 1, completion: 2 },
  'gpt-3.5-turbo-16k': { prompt: 3, completion: 4 },
};

/**
 * Anthropic Claude pricing
 * Source: https://www.anthropic.com/pricing
 */
export const ANTHROPIC_PRICING: Record<string, ModelPricing> = {
  // Claude 3.5
  'claude-3-5-sonnet-20241022': { prompt: 3, completion: 15 },
  'claude-3-5-sonnet-20240620': { prompt: 3, completion: 15 },

  // Claude 3 Opus
  'claude-3-opus-20240229': { prompt: 15, completion: 75 },

  // Claude 3 Sonnet
  'claude-3-sonnet-20240229': { prompt: 3, completion: 15 },

  // Claude 3 Haiku
  'claude-3-haiku-20240307': { prompt: 0.25, completion: 1.25 },

  // Legacy models
  'claude-2.1': { prompt: 8, completion: 24 },
  'claude-2.0': { prompt: 8, completion: 24 },
  'claude-instant-1.2': { prompt: 0.8, completion: 2.4 },
};

/**
 * Google Gemini pricing
 * Source: https://ai.google.dev/pricing
 */
export const GEMINI_PRICING: Record<string, ModelPricing> = {
  // Gemini 1.5 Pro
  'gemini-1.5-pro': { prompt: 1.25, completion: 5 },
  'gemini-1.5-pro-001': { prompt: 1.25, completion: 5 },
  'gemini-1.5-pro-002': { prompt: 1.25, completion: 5 },

  // Gemini 1.5 Flash
  'gemini-1.5-flash': { prompt: 0.075, completion: 0.3 },
  'gemini-1.5-flash-001': { prompt: 0.075, completion: 0.3 },
  'gemini-1.5-flash-002': { prompt: 0.075, completion: 0.3 },
  'gemini-1.5-flash-8b': { prompt: 0.0375, completion: 0.15 },

  // Gemini 1.0 Pro (legacy)
  'gemini-pro': { prompt: 0.5, completion: 1.5 },
  'gemini-1.0-pro': { prompt: 0.5, completion: 1.5 },
  'gemini-1.0-pro-001': { prompt: 0.5, completion: 1.5 },
};

/**
 * Local provider pricing (OpenAI-compatible local API)
 * Source: Local development - no cost
 */
export const LOCAL_PRICING: Record<string, ModelPricing> = {
  // Claude 4 models via local API
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
  provider: 'openai' | 'anthropic' | 'gemini' | 'local',
  model: string,
): ModelPricing {
  switch (provider) {
    case 'openai':
      return OPENAI_PRICING[model] ?? OPENAI_PRICING['gpt-4o-mini']!;
    case 'anthropic':
      return (
        ANTHROPIC_PRICING[model] ??
        ANTHROPIC_PRICING['claude-3-haiku-20240307']!
      );
    case 'gemini':
      return GEMINI_PRICING[model] ?? GEMINI_PRICING['gemini-1.5-flash']!;
    case 'local':
      return LOCAL_PRICING[model] ?? LOCAL_PRICING['claude-sonnet-4-5']!;
    default:
      // Fallback to cheapest option
      return { prompt: 0.15, completion: 0.6 };
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
