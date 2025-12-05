import type { RateLimitConfig, RateLimitTier, VideoCostMapping } from './types';

/**
 * 24 hours in milliseconds
 */
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Default rate limit configurations per provider and tier
 *
 * Rate limits are designed to:
 * - Prevent abuse and manage infrastructure load
 * - Ensure fair usage across accounts
 * - Allow bursts while maintaining daily limits
 */
export const RATE_LIMIT_CONFIGS: Record<
  string,
  Record<RateLimitTier, RateLimitConfig>
> = {
  kling: {
    free: {
      maxTokens: 10,
      refillRate: 10,
      refillInterval: ONE_DAY_MS,
      costPerRequest: 1,
    },
    standard: {
      maxTokens: 100,
      refillRate: 100,
      refillInterval: ONE_DAY_MS,
      costPerRequest: 1,
    },
    pro: {
      maxTokens: 1000,
      refillRate: 1000,
      refillInterval: ONE_DAY_MS,
      costPerRequest: 1,
    },
    enterprise: {
      maxTokens: 10000,
      refillRate: 10000,
      refillInterval: ONE_DAY_MS,
      costPerRequest: 1,
    },
  },
  runway: {
    free: {
      maxTokens: 5,
      refillRate: 5,
      refillInterval: ONE_DAY_MS,
      costPerRequest: 1,
    },
    standard: {
      maxTokens: 50,
      refillRate: 50,
      refillInterval: ONE_DAY_MS,
      costPerRequest: 1,
    },
    pro: {
      maxTokens: 500,
      refillRate: 500,
      refillInterval: ONE_DAY_MS,
      costPerRequest: 1,
    },
    enterprise: {
      maxTokens: 5000,
      refillRate: 5000,
      refillInterval: ONE_DAY_MS,
      costPerRequest: 1,
    },
  },
  luma: {
    free: {
      maxTokens: 3,
      refillRate: 3,
      refillInterval: ONE_DAY_MS,
      costPerRequest: 1,
    },
    standard: {
      maxTokens: 30,
      refillRate: 30,
      refillInterval: ONE_DAY_MS,
      costPerRequest: 1,
    },
    pro: {
      maxTokens: 300,
      refillRate: 300,
      refillInterval: ONE_DAY_MS,
      costPerRequest: 1,
    },
    enterprise: {
      maxTokens: 3000,
      refillRate: 3000,
      refillInterval: ONE_DAY_MS,
      costPerRequest: 1,
    },
  },
  hailuo: {
    free: {
      maxTokens: 5,
      refillRate: 5,
      refillInterval: ONE_DAY_MS,
      costPerRequest: 1,
    },
    standard: {
      maxTokens: 50,
      refillRate: 50,
      refillInterval: ONE_DAY_MS,
      costPerRequest: 1,
    },
    pro: {
      maxTokens: 500,
      refillRate: 500,
      refillInterval: ONE_DAY_MS,
      costPerRequest: 1,
    },
    enterprise: {
      maxTokens: 5000,
      refillRate: 5000,
      refillInterval: ONE_DAY_MS,
      costPerRequest: 1,
    },
  },
};

/**
 * Default configuration when provider is not found
 */
export const DEFAULT_RATE_LIMIT_CONFIG: RateLimitConfig = {
  maxTokens: 10,
  refillRate: 10,
  refillInterval: ONE_DAY_MS,
  costPerRequest: 1,
};

/**
 * Video generation cost mappings
 * Different operations may cost different amounts of tokens
 */
export const VIDEO_COSTS: VideoCostMapping = {
  video_5s_std: 1,
  video_10s_std: 2,
  video_5s_pro: 3,
  video_10s_pro: 6,
};

/**
 * Get rate limit configuration for a provider and tier
 *
 * @param provider - The video provider name (e.g., 'kling', 'runway')
 * @param tier - The account tier
 * @returns Rate limit configuration or default if not found
 */
export function getRateLimitConfig(
  provider: string,
  tier: RateLimitTier,
): RateLimitConfig {
  const providerConfig = RATE_LIMIT_CONFIGS[provider.toLowerCase()];

  if (!providerConfig) {
    return DEFAULT_RATE_LIMIT_CONFIG;
  }

  const tierConfig = providerConfig[tier];

  if (!tierConfig) {
    return DEFAULT_RATE_LIMIT_CONFIG;
  }

  return tierConfig;
}

/**
 * List of supported video providers
 */
export const SUPPORTED_PROVIDERS = Object.keys(RATE_LIMIT_CONFIGS);

/**
 * Check if a provider is supported
 */
export function isProviderSupported(provider: string): boolean {
  return provider.toLowerCase() in RATE_LIMIT_CONFIGS;
}
