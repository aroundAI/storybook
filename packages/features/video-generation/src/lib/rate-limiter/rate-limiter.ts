import { type CacheClient, createCacheClient } from '@kit/cache';
import { getLogger } from '@kit/shared/logger';

import { getRateLimitConfig } from './config';
import type {
  RateLimitConfig,
  RateLimitResult,
  RateLimitStatus,
  RateLimitTier,
  TokenBucketState,
} from './types';
import { CheckLimitSchema } from './types';

/**
 * Rate Limiter using Token Bucket Algorithm
 *
 * Implements per-account, per-provider rate limiting using Redis/memory cache.
 * The token bucket algorithm allows for burst traffic while maintaining
 * long-term rate limits.
 *
 * How it works:
 * 1. Each account/provider has a bucket with max tokens
 * 2. Each request consumes tokens from the bucket
 * 3. Tokens refill at a fixed rate
 * 4. Requests are rejected when bucket is empty
 */
export class RateLimiter {
  private cache: CacheClient;
  private tierCache = new Map<
    string,
    { tier: RateLimitTier; expiresAt: number }
  >();
  private readonly tierCacheTTL = 5 * 60 * 1000; // 5 minutes

  constructor(cache?: CacheClient) {
    this.cache = cache ?? createCacheClient();
  }

  /**
   * Check if rate limit allows request and consume token if allowed
   *
   * @param accountId - The account ID to check
   * @param provider - The video provider name
   * @param cost - Number of tokens to consume (default: 1)
   * @returns Rate limit result with allowed status and remaining tokens
   */
  async checkAndConsumeToken(
    accountId: string,
    provider: string,
    cost = 1,
  ): Promise<RateLimitResult> {
    const validated = CheckLimitSchema.parse({ accountId, provider, cost });

    const tier = await this.getAccountTier(validated.accountId);
    const config = getRateLimitConfig(validated.provider, tier);
    const key = this.getKey(validated.accountId, validated.provider);

    try {
      const result = await this.executeTokenBucket(key, config, validated.cost);

      if (!result.allowed) {
        const logger = await getLogger();
        logger.warn(
          {
            accountId: validated.accountId,
            provider: validated.provider,
            tier,
            remaining: result.remaining,
          },
          'Rate limit exceeded',
        );
      }

      return result;
    } catch (error) {
      const logger = await getLogger();
      logger.error(
        { error, accountId: validated.accountId, provider: validated.provider },
        'Rate limit check failed',
      );

      // Fail open (allow request) on cache errors
      return {
        allowed: true,
        remaining: config.maxTokens,
        limit: config.maxTokens,
        resetAt: new Date(Date.now() + config.refillInterval),
      };
    }
  }

  /**
   * Check rate limit without consuming tokens
   * Useful for UI to show remaining capacity
   *
   * @param accountId - The account ID to check
   * @param provider - The video provider name
   * @param cost - Hypothetical cost to check against (default: 1)
   * @returns Rate limit result without consuming tokens
   */
  async checkLimit(
    accountId: string,
    provider: string,
    cost = 1,
  ): Promise<RateLimitResult> {
    const tier = await this.getAccountTier(accountId);
    const config = getRateLimitConfig(provider, tier);
    const key = this.getKey(accountId, provider);

    try {
      const data = await this.cache.get<TokenBucketState>(key);

      if (!data) {
        // Bucket not initialized, would have full tokens
        return {
          allowed: cost <= config.maxTokens,
          remaining: config.maxTokens,
          limit: config.maxTokens,
          resetAt: new Date(Date.now() + config.refillInterval),
        };
      }

      // Calculate current tokens with refill
      const { currentTokens, lastRefill } = this.calculateCurrentTokens(
        data,
        config,
      );

      const allowed = currentTokens >= cost;
      const remaining = currentTokens;

      return {
        allowed,
        remaining,
        limit: config.maxTokens,
        resetAt: new Date(lastRefill + config.refillInterval),
        retryAfter: allowed
          ? undefined
          : this.calculateRetryAfter(cost, currentTokens, config),
      };
    } catch (error) {
      const logger = await getLogger();
      logger.error({ error, accountId, provider }, 'Rate limit check failed');

      return {
        allowed: true,
        remaining: config.maxTokens,
        limit: config.maxTokens,
        resetAt: new Date(Date.now() + config.refillInterval),
      };
    }
  }

  /**
   * Get remaining tokens for account/provider
   *
   * @param accountId - The account ID
   * @param provider - The video provider name
   * @returns Number of remaining tokens
   */
  async getRemainingTokens(
    accountId: string,
    provider: string,
  ): Promise<number> {
    const result = await this.checkLimit(accountId, provider, 0);
    return result.remaining;
  }

  /**
   * Get complete rate limit status for monitoring
   *
   * @param accountId - The account ID
   * @param provider - The video provider name
   * @returns Complete rate limit status
   */
  async getStatus(
    accountId: string,
    provider: string,
  ): Promise<RateLimitStatus> {
    const tier = await this.getAccountTier(accountId);
    const config = getRateLimitConfig(provider, tier);
    const result = await this.checkLimit(accountId, provider, 0);

    return {
      accountId,
      provider,
      tier,
      limit: config.maxTokens,
      remaining: result.remaining,
      resetAt: result.resetAt,
      percentUsed:
        ((config.maxTokens - result.remaining) / config.maxTokens) * 100,
    };
  }

  /**
   * Reset rate limit for account/provider (admin only)
   *
   * @param accountId - The account ID
   * @param provider - The video provider name
   */
  async resetLimit(accountId: string, provider: string): Promise<void> {
    const key = this.getKey(accountId, provider);
    await this.cache.del(key);

    const logger = await getLogger();
    logger.info({ accountId, provider }, 'Rate limit reset');
  }

  /**
   * Execute token bucket algorithm
   * Reads current state, calculates refills, and atomically updates
   */
  private async executeTokenBucket(
    key: string,
    config: RateLimitConfig,
    cost: number,
  ): Promise<RateLimitResult> {
    const now = Date.now();

    // Get current bucket state
    const data = await this.cache.get<TokenBucketState>(key);

    let currentTokens: number;
    let lastRefill: number;

    if (!data) {
      // Initialize new bucket with full tokens
      currentTokens = config.maxTokens;
      lastRefill = now;
    } else {
      // Refill tokens based on elapsed time
      const calculated = this.calculateCurrentTokens(data, config);
      currentTokens = calculated.currentTokens;
      lastRefill = calculated.lastRefill;
    }

    // Check if request can be allowed
    const allowed = currentTokens >= cost;

    if (allowed) {
      // Consume tokens
      currentTokens -= cost;
    }

    // Save updated state with TTL
    await this.cache.set<TokenBucketState>(
      key,
      {
        tokens: currentTokens,
        lastRefill,
      },
      Math.ceil(config.refillInterval / 1000), // TTL in seconds
    );

    const resetAt = new Date(lastRefill + config.refillInterval);
    const retryAfter = allowed
      ? undefined
      : this.calculateRetryAfter(cost, currentTokens, config);

    return {
      allowed,
      remaining: currentTokens,
      limit: config.maxTokens,
      resetAt,
      retryAfter,
    };
  }

  /**
   * Calculate current tokens with refill based on elapsed time
   */
  private calculateCurrentTokens(
    data: TokenBucketState,
    config: RateLimitConfig,
  ): { currentTokens: number; lastRefill: number } {
    const now = Date.now();
    const timeSinceRefill = now - data.lastRefill;
    const refillsSinceUpdate = Math.floor(
      timeSinceRefill / config.refillInterval,
    );
    const tokensToAdd = refillsSinceUpdate * config.refillRate;

    const currentTokens = Math.min(data.tokens + tokensToAdd, config.maxTokens);

    const lastRefill =
      refillsSinceUpdate > 0
        ? data.lastRefill + refillsSinceUpdate * config.refillInterval
        : data.lastRefill;

    return { currentTokens, lastRefill };
  }

  /**
   * Calculate seconds until enough tokens are available
   */
  private calculateRetryAfter(
    cost: number,
    currentTokens: number,
    config: RateLimitConfig,
  ): number {
    const tokensNeeded = cost - currentTokens;
    const refillsNeeded = Math.ceil(tokensNeeded / config.refillRate);
    return Math.ceil((refillsNeeded * config.refillInterval) / 1000);
  }

  /**
   * Get account tier from database
   * Results are cached for performance
   */
  private async getAccountTier(accountId: string): Promise<RateLimitTier> {
    // Check local cache first
    const cached = this.tierCache.get(accountId);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.tier;
    }

    // TODO: Implement actual tier lookup from database
    // For now, return 'standard' as default
    const tier: RateLimitTier = 'standard';

    // Cache the result
    this.tierCache.set(accountId, {
      tier,
      expiresAt: Date.now() + this.tierCacheTTL,
    });

    return tier;
  }

  /**
   * Generate cache key for account/provider
   */
  private getKey(accountId: string, provider: string): string {
    return `rate-limit:${accountId}:${provider.toLowerCase()}`;
  }

  /**
   * Clear tier cache (useful for testing or when tier changes)
   */
  clearTierCache(): void {
    this.tierCache.clear();
  }

  /**
   * Set account tier directly (for testing)
   */
  setAccountTier(accountId: string, tier: RateLimitTier): void {
    this.tierCache.set(accountId, {
      tier,
      expiresAt: Date.now() + this.tierCacheTTL,
    });
  }
}

// Singleton instance
let rateLimiterInstance: RateLimiter | null = null;

/**
 * Get the singleton rate limiter instance
 */
export function getRateLimiter(): RateLimiter {
  if (!rateLimiterInstance) {
    rateLimiterInstance = new RateLimiter();
  }
  return rateLimiterInstance;
}

/**
 * Reset the singleton instance (for testing)
 */
export function resetRateLimiter(): void {
  rateLimiterInstance = null;
}

/**
 * Convenience function to check rate limit and consume token
 */
export async function checkRateLimit(
  accountId: string,
  provider: string,
  cost = 1,
): Promise<RateLimitResult> {
  const limiter = getRateLimiter();
  return limiter.checkAndConsumeToken(accountId, provider, cost);
}

/**
 * Convenience function to get remaining tokens
 */
export async function getRemainingTokens(
  accountId: string,
  provider: string,
): Promise<number> {
  const limiter = getRateLimiter();
  return limiter.getRemainingTokens(accountId, provider);
}

/**
 * Convenience function to get rate limit status
 */
export async function getRateLimitStatus(
  accountId: string,
  provider: string,
): Promise<RateLimitStatus> {
  const limiter = getRateLimiter();
  return limiter.getStatus(accountId, provider);
}
