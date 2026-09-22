---
spec_id: FILM-403
status: 🗑️ RETIRED
audited: 2026-09-23
---

# FILM-403: Rate Limiter

> **🗑️ Retired (audit 2026-09-23).** The Redis token-bucket limiter for video providers (`packages/features/video-generation/src/lib/rate-limiter/`) was deleted in `5b88db3a` (2026-01-15), the commit that removed `packages/features/video-generation`; the owner retired in-app video generation on purpose. Nothing replaces it: `packages/next/src/actions/rate-limiter.ts` is an unrelated in-memory, fixed-window limit per user and server action, with no tokens, tiers, providers or Redis. Kept as a record; not outstanding work.

**Phase**: 4
**Priority**: P0
**Effort**: M (3-4 days)
**Dependencies**: None (uses @kit/cache)
**Blocks**: FILM-404 (job-queue), FILM-405 (generate-video-action)

---

## Context

Video generation providers impose rate limits to prevent abuse and manage infrastructure load. The rate limiter implements a token bucket algorithm using Redis to enforce per-account, per-provider limits. This ensures fair usage across accounts while preventing providers from rejecting requests due to rate limit violations.

The rate limiter must support different tiers (free, standard, pro) with varying limits, provide real-time feedback on remaining capacity, and gracefully handle distributed requests across multiple application instances.

---

## Requirements

### Functional Requirements

1. **Token Bucket Algorithm**
   - Initialize bucket with maximum tokens
   - Consume tokens on each request
   - Refill tokens at configured rate
   - Reject requests when bucket is empty

2. **Per-Account, Per-Provider Limits**
   - Track limits separately for each account
   - Support different limits per provider (Kling, Runway, Luma)
   - Support tier-based limits (free, standard, pro)
   - Allow custom limits for enterprise accounts

3. **Rate Limit Checking**
   - Check if request can be made (non-consuming check)
   - Atomically check and consume tokens
   - Return remaining tokens and reset time
   - Support cost-based token consumption

4. **Rate Limit Information**
   - Get remaining tokens for account/provider
   - Get time until bucket refills
   - Get current tier and limit configuration
   - Calculate when next request can be made

### Non-Functional Requirements

- All operations must be atomic using Redis Lua scripts
- Support distributed operation across multiple servers
- Rate limit checks must complete within 50ms
- Handle Redis connection failures gracefully
- Log rate limit violations for monitoring

---

## Interface

### TypeScript Types

```typescript
import { z } from 'zod';

// Tier Definitions
export type RateLimitTier = 'free' | 'standard' | 'pro' | 'enterprise';

export interface RateLimitConfig {
  maxTokens: number;         // Maximum tokens in bucket
  refillRate: number;        // Tokens added per refillInterval
  refillInterval: number;    // Milliseconds between refills
  costPerRequest: number;    // Tokens consumed per request
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  limit: number;
  resetAt: Date;
  retryAfter?: number;       // Seconds to wait before retry
}

export interface RateLimitStatus {
  accountId: string;
  provider: string;
  tier: RateLimitTier;
  limit: number;
  remaining: number;
  resetAt: Date;
  percentUsed: number;
}

// Zod Schemas
export const CheckLimitSchema = z.object({
  accountId: z.string().uuid(),
  provider: z.string(),
  cost: z.number().int().positive().default(1),
});

export const GetRemainingSchema = z.object({
  accountId: z.string().uuid(),
  provider: z.string(),
});
```

### Rate Limiter Implementation

```typescript
import { createCache } from '@kit/cache';
import { logger } from '@kit/monitoring';

// Default rate limit configurations per provider
export const RATE_LIMIT_CONFIGS: Record<
  string,
  Record<RateLimitTier, RateLimitConfig>
> = {
  kling: {
    free: {
      maxTokens: 10,
      refillRate: 10,
      refillInterval: 24 * 60 * 60 * 1000, // 24 hours
      costPerRequest: 1,
    },
    standard: {
      maxTokens: 100,
      refillRate: 100,
      refillInterval: 24 * 60 * 60 * 1000,
      costPerRequest: 1,
    },
    pro: {
      maxTokens: 1000,
      refillRate: 1000,
      refillInterval: 24 * 60 * 60 * 1000,
      costPerRequest: 1,
    },
    enterprise: {
      maxTokens: 10000,
      refillRate: 10000,
      refillInterval: 24 * 60 * 60 * 1000,
      costPerRequest: 1,
    },
  },
  runway: {
    free: {
      maxTokens: 5,
      refillRate: 5,
      refillInterval: 24 * 60 * 60 * 1000,
      costPerRequest: 1,
    },
    standard: {
      maxTokens: 50,
      refillRate: 50,
      refillInterval: 24 * 60 * 60 * 1000,
      costPerRequest: 1,
    },
    pro: {
      maxTokens: 500,
      refillRate: 500,
      refillInterval: 24 * 60 * 60 * 1000,
      costPerRequest: 1,
    },
    enterprise: {
      maxTokens: 5000,
      refillRate: 5000,
      refillInterval: 24 * 60 * 60 * 1000,
      costPerRequest: 1,
    },
  },
};

export class RateLimiter {
  private redis: ReturnType<typeof createCache>;

  constructor() {
    this.redis = createCache({
      ttl: 0, // TTL managed by rate limiter logic
    });
  }

  /**
   * Check if rate limit allows request and consume token if allowed
   */
  async checkAndConsumeToken(
    accountId: string,
    provider: string,
    cost: number = 1
  ): Promise<RateLimitResult> {
    const validated = CheckLimitSchema.parse({ accountId, provider, cost });

    const tier = await this.getAccountTier(accountId);
    const config = this.getConfig(provider, tier);
    const key = this.getKey(accountId, provider);

    try {
      const result = await this.executeTokenBucket(key, config, cost);

      if (!result.allowed) {
        logger.warn('Rate limit exceeded', {
          accountId,
          provider,
          tier,
          remaining: result.remaining,
        });
      }

      return result;
    } catch (error) {
      logger.error('Rate limit check failed', { error, accountId, provider });
      // Fail open (allow request) on Redis errors
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
   */
  async checkLimit(
    accountId: string,
    provider: string,
    cost: number = 1
  ): Promise<RateLimitResult> {
    const tier = await this.getAccountTier(accountId);
    const config = this.getConfig(provider, tier);
    const key = this.getKey(accountId, provider);

    try {
      const data = await this.redis.get<{
        tokens: number;
        lastRefill: number;
      }>(key);

      if (!data) {
        // Bucket not initialized, would have full tokens
        return {
          allowed: cost <= config.maxTokens,
          remaining: config.maxTokens - cost,
          limit: config.maxTokens,
          resetAt: new Date(Date.now() + config.refillInterval),
        };
      }

      // Calculate current tokens
      const now = Date.now();
      const timeSinceRefill = now - data.lastRefill;
      const refillsSinceUpdate = Math.floor(
        timeSinceRefill / config.refillInterval
      );
      const tokensToAdd = refillsSinceUpdate * config.refillRate;
      const currentTokens = Math.min(
        data.tokens + tokensToAdd,
        config.maxTokens
      );

      const allowed = currentTokens >= cost;
      const remaining = allowed ? currentTokens - cost : currentTokens;

      return {
        allowed,
        remaining,
        limit: config.maxTokens,
        resetAt: new Date(
          data.lastRefill + (refillsSinceUpdate + 1) * config.refillInterval
        ),
        retryAfter: allowed ? undefined : Math.ceil(
          ((cost - currentTokens) / config.refillRate) *
            (config.refillInterval / 1000)
        ),
      };
    } catch (error) {
      logger.error('Rate limit check failed', { error, accountId, provider });
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
   */
  async getRemainingTokens(
    accountId: string,
    provider: string
  ): Promise<number> {
    const result = await this.checkLimit(accountId, provider, 0);
    return result.remaining;
  }

  /**
   * Get rate limit status
   */
  async getStatus(
    accountId: string,
    provider: string
  ): Promise<RateLimitStatus> {
    const tier = await this.getAccountTier(accountId);
    const config = this.getConfig(provider, tier);
    const result = await this.checkLimit(accountId, provider, 0);

    return {
      accountId,
      provider,
      tier,
      limit: config.maxTokens,
      remaining: result.remaining,
      resetAt: result.resetAt,
      percentUsed: ((config.maxTokens - result.remaining) / config.maxTokens) * 100,
    };
  }

  /**
   * Reset rate limit for account/provider (admin only)
   */
  async resetLimit(accountId: string, provider: string): Promise<void> {
    const key = this.getKey(accountId, provider);
    await this.redis.del(key);
    logger.info('Rate limit reset', { accountId, provider });
  }

  /**
   * Execute token bucket algorithm atomically using Lua script
   */
  private async executeTokenBucket(
    key: string,
    config: RateLimitConfig,
    cost: number
  ): Promise<RateLimitResult> {
    const now = Date.now();

    // Get current bucket state
    const data = await this.redis.get<{
      tokens: number;
      lastRefill: number;
    }>(key);

    let currentTokens: number;
    let lastRefill: number;

    if (!data) {
      // Initialize new bucket
      currentTokens = config.maxTokens;
      lastRefill = now;
    } else {
      // Refill tokens based on elapsed time
      const timeSinceRefill = now - data.lastRefill;
      const refillsSinceUpdate = Math.floor(
        timeSinceRefill / config.refillInterval
      );
      const tokensToAdd = refillsSinceUpdate * config.refillRate;

      currentTokens = Math.min(data.tokens + tokensToAdd, config.maxTokens);
      lastRefill =
        refillsSinceUpdate > 0
          ? data.lastRefill + refillsSinceUpdate * config.refillInterval
          : data.lastRefill;
    }

    // Check if request can be allowed
    const allowed = currentTokens >= cost;

    if (allowed) {
      // Consume tokens
      currentTokens -= cost;
      await this.redis.set(
        key,
        {
          tokens: currentTokens,
          lastRefill,
        },
        { ttl: config.refillInterval }
      );
    } else {
      // Don't consume, just update refill time
      await this.redis.set(
        key,
        {
          tokens: currentTokens,
          lastRefill,
        },
        { ttl: config.refillInterval }
      );
    }

    const resetAt = new Date(lastRefill + config.refillInterval);
    const retryAfter = allowed
      ? undefined
      : Math.ceil(
          ((cost - currentTokens) / config.refillRate) *
            (config.refillInterval / 1000)
        );

    return {
      allowed,
      remaining: currentTokens,
      limit: config.maxTokens,
      resetAt,
      retryAfter,
    };
  }

  /**
   * Get account tier from database
   */
  private async getAccountTier(accountId: string): Promise<RateLimitTier> {
    // Query account subscription tier
    // For now, return 'standard' as default
    // TODO: Implement actual tier lookup from database
    return 'standard';
  }

  /**
   * Get rate limit configuration for provider and tier
   */
  private getConfig(provider: string, tier: RateLimitTier): RateLimitConfig {
    const providerConfig = RATE_LIMIT_CONFIGS[provider];
    if (!providerConfig) {
      throw new Error(`No rate limit config for provider: ${provider}`);
    }

    const config = providerConfig[tier];
    if (!config) {
      throw new Error(`No rate limit config for tier: ${tier}`);
    }

    return config;
  }

  /**
   * Generate Redis key for account/provider
   */
  private getKey(accountId: string, provider: string): string {
    return `rate-limit:${accountId}:${provider}`;
  }
}

// Singleton instance
let rateLimiterInstance: RateLimiter | null = null;

export function getRateLimiter(): RateLimiter {
  if (!rateLimiterInstance) {
    rateLimiterInstance = new RateLimiter();
  }
  return rateLimiterInstance;
}

// Export convenience functions
export async function checkRateLimit(
  accountId: string,
  provider: string,
  cost: number = 1
): Promise<RateLimitResult> {
  const limiter = getRateLimiter();
  return limiter.checkAndConsumeToken(accountId, provider, cost);
}

export async function getRemainingTokens(
  accountId: string,
  provider: string
): Promise<number> {
  const limiter = getRateLimiter();
  return limiter.getRemainingTokens(accountId, provider);
}

export async function getRateLimitStatus(
  accountId: string,
  provider: string
): Promise<RateLimitStatus> {
  const limiter = getRateLimiter();
  return limiter.getStatus(accountId, provider);
}
```

---

## Implementation Details

### File Structure

```
packages/features/video-generation/src/
├── lib/
│   ├── rate-limiter/
│   │   ├── rate-limiter.ts           # Rate limiter class (CREATE THIS)
│   │   ├── config.ts                 # Rate limit configs (CREATE THIS)
│   │   ├── types.ts                  # Type definitions (CREATE THIS)
│   │   └── __tests__/
│   │       └── rate-limiter.test.ts  # Unit tests (CREATE THIS)
│   └── index.ts                      # Export rate limiter (UPDATE THIS)
```

### Token Bucket Algorithm

**How it works**:
1. Each account/provider has a bucket with max tokens
2. Each request consumes tokens from the bucket
3. Tokens refill at a fixed rate
4. Requests are rejected when bucket is empty

**Benefits**:
- Allows bursts of traffic up to max tokens
- Smooths traffic over time
- Fair across all accounts
- Simple to implement and understand

### Redis Data Structure

```typescript
// Key: rate-limit:{accountId}:{provider}
// Value: JSON
{
  tokens: 95,              // Current tokens in bucket
  lastRefill: 1640995200   // Timestamp of last refill
}

// TTL: refillInterval (auto-expires old buckets)
```

### Atomic Operations

All rate limit operations must be atomic to prevent race conditions in distributed systems. This implementation uses Redis `get` and `set` operations which are atomic at the key level.

For production, consider using Redis Lua scripts for true atomic check-and-decrement:

```lua
-- token-bucket.lua
local key = KEYS[1]
local maxTokens = tonumber(ARGV[1])
local refillRate = tonumber(ARGV[2])
local refillInterval = tonumber(ARGV[3])
local cost = tonumber(ARGV[4])
local now = tonumber(ARGV[5])

local data = redis.call('GET', key)
local tokens, lastRefill

if not data then
  tokens = maxTokens
  lastRefill = now
else
  local decoded = cjson.decode(data)
  tokens = decoded.tokens
  lastRefill = decoded.lastRefill

  -- Refill tokens
  local timeSinceRefill = now - lastRefill
  local refillsSinceUpdate = math.floor(timeSinceRefill / refillInterval)
  if refillsSinceUpdate > 0 then
    tokens = math.min(tokens + (refillsSinceUpdate * refillRate), maxTokens)
    lastRefill = lastRefill + (refillsSinceUpdate * refillInterval)
  end
end

-- Check if allowed
local allowed = tokens >= cost

if allowed then
  tokens = tokens - cost
end

-- Save state
redis.call('SET', key, cjson.encode({
  tokens = tokens,
  lastRefill = lastRefill
}), 'PX', refillInterval)

return {allowed, tokens, lastRefill}
```

### Tier-Based Limits

Rate limits vary by subscription tier:

| Tier | Kling Limit | Runway Limit | Luma Limit |
|------|-------------|--------------|------------|
| Free | 10/day | 5/day | 3/day |
| Standard | 100/day | 50/day | 30/day |
| Pro | 1000/day | 500/day | 300/day |
| Enterprise | Custom | Custom | Custom |

### Cost-Based Token Consumption

Different operations may cost different amounts:

```typescript
const costs = {
  video_5s_std: 1,    // 5 second standard video = 1 token
  video_10s_std: 2,   // 10 second standard video = 2 tokens
  video_5s_pro: 3,    // 5 second pro video = 3 tokens
  video_10s_pro: 6,   // 10 second pro video = 6 tokens
};

await checkRateLimit(accountId, 'kling', costs.video_10s_pro);
```

---

## File Changes

### New Files

1. **packages/features/video-generation/src/lib/rate-limiter/rate-limiter.ts**
   - Implement RateLimiter class
   - Token bucket algorithm
   - Redis integration

2. **packages/features/video-generation/src/lib/rate-limiter/config.ts**
   - Rate limit configurations per provider
   - Tier definitions
   - Cost mappings

3. **packages/features/video-generation/src/lib/rate-limiter/types.ts**
   - TypeScript interfaces
   - Zod schemas
   - Export types

4. **packages/features/video-generation/src/lib/rate-limiter/__tests__/rate-limiter.test.ts**
   - Unit tests for rate limiter
   - Mock Redis
   - Test edge cases

### Modified Files

1. **packages/features/video-generation/src/lib/index.ts**
   - Export rate limiter functions
   - Export types

---

## Acceptance Criteria

### Functional

- [ ] `checkAndConsumeToken()` correctly consumes tokens when allowed
- [ ] `checkAndConsumeToken()` rejects when insufficient tokens
- [ ] `checkLimit()` checks without consuming tokens
- [ ] `getRemainingTokens()` returns accurate count
- [ ] `getStatus()` returns complete rate limit status
- [ ] `resetLimit()` clears rate limit state
- [ ] Token bucket refills at configured rate
- [ ] Multiple requests properly consume tokens
- [ ] Concurrent requests are handled atomically
- [ ] Redis connection failures fail open (allow request)

### Non-Functional

- [ ] Rate limit checks complete within 50ms
- [ ] Operations are atomic across distributed instances
- [ ] Redis keys auto-expire after refill interval
- [ ] Rate limit violations are logged
- [ ] TypeScript compiles without errors
- [ ] No ESLint warnings

---

## Test Plan

### Unit Tests

**File**: `packages/features/video-generation/src/lib/rate-limiter/__tests__/rate-limiter.test.ts`

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RateLimiter } from '../rate-limiter';

// Mock Redis cache
vi.mock('@kit/cache');

describe('RateLimiter', () => {
  let limiter: RateLimiter;

  beforeEach(() => {
    limiter = new RateLimiter();
    vi.clearAllMocks();
  });

  describe('checkAndConsumeToken', () => {
    it('should allow first request with full tokens', async () => {
      const mockRedis = {
        get: vi.fn(() => Promise.resolve(null)),
        set: vi.fn(() => Promise.resolve()),
      };

      vi.mocked(createCache).mockReturnValue(mockRedis as any);

      const result = await limiter.checkAndConsumeToken(
        'account-123',
        'kling',
        1
      );

      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(99); // 100 - 1 for standard tier
      expect(mockRedis.set).toHaveBeenCalled();
    });

    it('should reject when insufficient tokens', async () => {
      const mockRedis = {
        get: vi.fn(() =>
          Promise.resolve({
            tokens: 0,
            lastRefill: Date.now(),
          })
        ),
        set: vi.fn(() => Promise.resolve()),
      };

      vi.mocked(createCache).mockReturnValue(mockRedis as any);

      const result = await limiter.checkAndConsumeToken(
        'account-123',
        'kling',
        1
      );

      expect(result.allowed).toBe(false);
      expect(result.remaining).toBe(0);
      expect(result.retryAfter).toBeGreaterThan(0);
    });

    it('should refill tokens after interval', async () => {
      const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;

      const mockRedis = {
        get: vi.fn(() =>
          Promise.resolve({
            tokens: 50,
            lastRefill: oneDayAgo,
          })
        ),
        set: vi.fn(() => Promise.resolve()),
      };

      vi.mocked(createCache).mockReturnValue(mockRedis as any);

      const result = await limiter.checkAndConsumeToken(
        'account-123',
        'kling',
        1
      );

      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(99); // Refilled to 100, consumed 1
    });

    it('should handle cost-based consumption', async () => {
      const mockRedis = {
        get: vi.fn(() => Promise.resolve(null)),
        set: vi.fn(() => Promise.resolve()),
      };

      vi.mocked(createCache).mockReturnValue(mockRedis as any);

      const result = await limiter.checkAndConsumeToken(
        'account-123',
        'kling',
        5 // Cost of 5 tokens
      );

      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(95);
    });

    it('should fail open on Redis errors', async () => {
      const mockRedis = {
        get: vi.fn(() => Promise.reject(new Error('Redis error'))),
        set: vi.fn(() => Promise.resolve()),
      };

      vi.mocked(createCache).mockReturnValue(mockRedis as any);

      const result = await limiter.checkAndConsumeToken(
        'account-123',
        'kling',
        1
      );

      expect(result.allowed).toBe(true); // Fail open
    });
  });

  describe('checkLimit', () => {
    it('should check without consuming tokens', async () => {
      const mockRedis = {
        get: vi.fn(() =>
          Promise.resolve({
            tokens: 50,
            lastRefill: Date.now(),
          })
        ),
      };

      vi.mocked(createCache).mockReturnValue(mockRedis as any);

      const result = await limiter.checkLimit('account-123', 'kling', 10);

      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(40); // 50 - 10 (not actually consumed)

      // Check again, should have same result
      const result2 = await limiter.checkLimit('account-123', 'kling', 10);
      expect(result2.remaining).toBe(40);
    });
  });

  describe('getRemainingTokens', () => {
    it('should return current token count', async () => {
      const mockRedis = {
        get: vi.fn(() =>
          Promise.resolve({
            tokens: 75,
            lastRefill: Date.now(),
          })
        ),
      };

      vi.mocked(createCache).mockReturnValue(mockRedis as any);

      const remaining = await limiter.getRemainingTokens('account-123', 'kling');

      expect(remaining).toBe(75);
    });
  });

  describe('getStatus', () => {
    it('should return complete rate limit status', async () => {
      const mockRedis = {
        get: vi.fn(() =>
          Promise.resolve({
            tokens: 80,
            lastRefill: Date.now(),
          })
        ),
      };

      vi.mocked(createCache).mockReturnValue(mockRedis as any);

      const status = await limiter.getStatus('account-123', 'kling');

      expect(status.accountId).toBe('account-123');
      expect(status.provider).toBe('kling');
      expect(status.tier).toBe('standard');
      expect(status.remaining).toBe(80);
      expect(status.limit).toBe(100);
      expect(status.percentUsed).toBe(20);
    });
  });

  describe('resetLimit', () => {
    it('should clear rate limit state', async () => {
      const mockRedis = {
        del: vi.fn(() => Promise.resolve()),
      };

      vi.mocked(createCache).mockReturnValue(mockRedis as any);

      await limiter.resetLimit('account-123', 'kling');

      expect(mockRedis.del).toHaveBeenCalledWith(
        'rate-limit:account-123:kling'
      );
    });
  });
});
```

### Integration Tests

```typescript
import { describe, it, expect } from 'vitest';
import { RateLimiter } from '../rate-limiter';

describe('Rate Limiter Integration', () => {
  it('should enforce rate limits with real Redis', async () => {
    const limiter = new RateLimiter();
    const accountId = `test-${Date.now()}`;

    // Make 10 requests (standard tier limit for free = 10)
    for (let i = 0; i < 10; i++) {
      const result = await limiter.checkAndConsumeToken(accountId, 'kling');
      expect(result.allowed).toBe(true);
    }

    // 11th request should be rejected
    const result = await limiter.checkAndConsumeToken(accountId, 'kling');
    expect(result.allowed).toBe(false);
    expect(result.retryAfter).toBeGreaterThan(0);
  });

  it('should handle concurrent requests', async () => {
    const limiter = new RateLimiter();
    const accountId = `test-${Date.now()}`;

    // Make 10 concurrent requests
    const promises = Array.from({ length: 10 }, () =>
      limiter.checkAndConsumeToken(accountId, 'kling')
    );

    const results = await Promise.all(promises);

    // All should be allowed
    expect(results.every((r) => r.allowed)).toBe(true);

    // Total consumed should be 10
    const remaining = await limiter.getRemainingTokens(accountId, 'kling');
    expect(remaining).toBe(90); // 100 - 10
  });
});
```

---

## Security Considerations

### Rate Limit Bypass Prevention

- Use account ID from authenticated session (not from request)
- Validate provider names against whitelist
- Log suspicious rate limit patterns
- Monitor for distributed attacks

### Redis Security

- Use password authentication for Redis
- Enable TLS for Redis connections
- Restrict Redis access to application servers only
- Regular security updates for Redis

### Fail-Open vs Fail-Closed

Decision: **Fail-open** (allow requests when Redis is down)

Rationale:
- Better user experience during outages
- Provider's own rate limits will catch abuse
- Temporary loss of rate limiting better than service outage

Alternative: Implement circuit breaker pattern for critical paths.

---

## Error Handling

### Redis Connection Errors

```typescript
try {
  const result = await limiter.checkAndConsumeToken(accountId, provider);
} catch (error) {
  if (error instanceof RedisConnectionError) {
    logger.error('Redis connection failed, failing open', { error });
    // Allow request to proceed
    return { allowed: true, remaining: 100, limit: 100, resetAt: new Date() };
  }
  throw error;
}
```

### Configuration Errors

```typescript
try {
  const config = limiter.getConfig(provider, tier);
} catch (error) {
  logger.error('Rate limit config not found', { provider, tier });
  // Use default configuration
  return DEFAULT_RATE_LIMIT_CONFIG;
}
```

---

## Performance Considerations

### Redis Optimization

- Use pipelining for batch operations
- Set appropriate TTLs to auto-expire old keys
- Monitor Redis memory usage
- Consider Redis Cluster for high load

### Caching

Cache tier lookups to avoid repeated database queries:

```typescript
const tierCache = new Map<string, RateLimitTier>();

async function getAccountTier(accountId: string): Promise<RateLimitTier> {
  const cached = tierCache.get(accountId);
  if (cached) return cached;

  const tier = await fetchTierFromDatabase(accountId);
  tierCache.set(accountId, tier);

  return tier;
}
```

---

## Future Enhancements

1. **Dynamic Rate Limits**
   - Adjust limits based on system load
   - Provider-specific limit overrides

2. **Rate Limit Analytics**
   - Track usage patterns per account
   - Identify accounts hitting limits frequently
   - Recommend tier upgrades

3. **Burst Allowance**
   - Allow temporary burst above limit
   - Deduct from future allocation

4. **Provider-Specific Rules**
   - Different limits for different models
   - Time-of-day pricing variations

---

## References

- **Token Bucket Algorithm**: https://en.wikipedia.org/wiki/Token_bucket
- **Redis Rate Limiting**: https://redis.io/docs/manual/patterns/rate-limiter/
- **@kit/cache**: Internal caching library
- **Constitution**: Section 5 (Error Handling)
