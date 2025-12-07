import { z } from 'zod';

/**
 * Rate limit tier definitions
 */
export type RateLimitTier = 'free' | 'standard' | 'pro' | 'enterprise';

/**
 * Rate limit configuration for a provider/tier combination
 */
export interface RateLimitConfig {
  /** Maximum tokens in bucket */
  maxTokens: number;
  /** Tokens added per refillInterval */
  refillRate: number;
  /** Milliseconds between refills */
  refillInterval: number;
  /** Default tokens consumed per request */
  costPerRequest: number;
}

/**
 * Result of a rate limit check
 */
export interface RateLimitResult {
  /** Whether the request is allowed */
  allowed: boolean;
  /** Remaining tokens after this request */
  remaining: number;
  /** Maximum tokens for this tier */
  limit: number;
  /** When the bucket will refill */
  resetAt: Date;
  /** Seconds to wait before retry (if rejected) */
  retryAfter?: number;
}

/**
 * Complete rate limit status for monitoring
 */
export interface RateLimitStatus {
  /** Account ID */
  accountId: string;
  /** Provider name */
  provider: string;
  /** Account's tier */
  tier: RateLimitTier;
  /** Maximum tokens for this tier */
  limit: number;
  /** Current remaining tokens */
  remaining: number;
  /** When the bucket will refill */
  resetAt: Date;
  /** Percentage of limit used (0-100) */
  percentUsed: number;
}

/**
 * Token bucket state stored in cache
 */
export interface TokenBucketState {
  /** Current tokens in bucket */
  tokens: number;
  /** Timestamp of last refill */
  lastRefill: number;
}

/**
 * Schema for validating rate limit check input
 */
export const CheckLimitSchema = z.object({
  accountId: z.string().uuid(),
  provider: z.string().min(1),
  cost: z.number().int().positive().default(1),
});

export type CheckLimitInput = z.infer<typeof CheckLimitSchema>;

/**
 * Schema for getting remaining tokens
 */
export const GetRemainingSchema = z.object({
  accountId: z.string().uuid(),
  provider: z.string().min(1),
});

export type GetRemainingInput = z.infer<typeof GetRemainingSchema>;

/**
 * Video generation cost mappings
 */
export interface VideoCostMapping {
  /** 5 second standard quality video */
  video_5s_std: number;
  /** 10 second standard quality video */
  video_10s_std: number;
  /** 5 second pro quality video */
  video_5s_pro: number;
  /** 10 second pro quality video */
  video_10s_pro: number;
}

/**
 * Error thrown when an unsupported provider is used
 */
export class UnsupportedProviderError extends Error {
  constructor(
    public readonly provider: string,
    public readonly supportedProviders: string[],
  ) {
    super(
      `Unsupported video provider: '${provider}'. Supported providers: ${supportedProviders.join(', ')}`,
    );
    this.name = 'UnsupportedProviderError';
  }
}

/**
 * Tier lookup function type for dependency injection
 */
export type TierLookupFn = (accountId: string) => Promise<RateLimitTier>;
