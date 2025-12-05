import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RATE_LIMIT_CONFIGS } from '../config';
import {
  RateLimiter,
  checkRateLimit,
  getRateLimitStatus,
  getRateLimiter,
  getRemainingTokens,
  resetRateLimiter,
} from '../rate-limiter';
import type { TokenBucketState } from '../types';

// Test UUIDs
const TEST_ACCOUNT_ID = '00000000-0000-0000-0000-000000000001';
const TEST_ACCOUNT_ID_2 = '00000000-0000-0000-0000-000000000002';

// Mock the cache module
const mockCache = {
  get: vi.fn(),
  set: vi.fn(),
  del: vi.fn(),
  mget: vi.fn(),
  mset: vi.fn(),
  mdel: vi.fn(),
  clear: vi.fn(),
  isHealthy: vi.fn(() => Promise.resolve(true)),
  getMetrics: vi.fn(() => ({ hits: 0, misses: 0, operations: 0, hitRate: 0 })),
  resetMetrics: vi.fn(),
  disconnect: vi.fn(),
};

vi.mock('@kit/cache', () => ({
  createCacheClient: vi.fn(() => mockCache),
}));

// Mock the logger
const mockLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  fatal: vi.fn(),
};

vi.mock('@kit/shared/logger', () => ({
  getLogger: vi.fn(() => Promise.resolve(mockLogger)),
}));

describe('RateLimiter', () => {
  let limiter: RateLimiter;

  beforeEach(() => {
    vi.clearAllMocks();
    resetRateLimiter();
    limiter = new RateLimiter(mockCache as never);
    limiter.setAccountTier(TEST_ACCOUNT_ID, 'standard');
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe('checkAndConsumeToken', () => {
    it('should allow first request with full tokens', async () => {
      mockCache.get.mockResolvedValue(null);
      mockCache.set.mockResolvedValue(undefined);

      const result = await limiter.checkAndConsumeToken(
        TEST_ACCOUNT_ID,
        'kling',
        1,
      );

      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(99); // 100 - 1 for standard tier
      expect(result.limit).toBe(100);
      expect(mockCache.set).toHaveBeenCalled();
    });

    it('should reject when insufficient tokens', async () => {
      const bucketState: TokenBucketState = {
        tokens: 0,
        lastRefill: Date.now(),
      };
      mockCache.get.mockResolvedValue(bucketState);
      mockCache.set.mockResolvedValue(undefined);

      const result = await limiter.checkAndConsumeToken(
        TEST_ACCOUNT_ID,
        'kling',
        1,
      );

      expect(result.allowed).toBe(false);
      expect(result.remaining).toBe(0);
      expect(result.retryAfter).toBeGreaterThan(0);
      expect(mockLogger.warn).toHaveBeenCalled();
    });

    it('should refill tokens after interval', async () => {
      const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;

      const bucketState: TokenBucketState = {
        tokens: 50,
        lastRefill: oneDayAgo,
      };
      mockCache.get.mockResolvedValue(bucketState);
      mockCache.set.mockResolvedValue(undefined);

      const result = await limiter.checkAndConsumeToken(
        TEST_ACCOUNT_ID,
        'kling',
        1,
      );

      expect(result.allowed).toBe(true);
      // Should refill to max (100) and consume 1
      expect(result.remaining).toBe(99);
    });

    it('should handle cost-based consumption', async () => {
      mockCache.get.mockResolvedValue(null);
      mockCache.set.mockResolvedValue(undefined);

      const result = await limiter.checkAndConsumeToken(
        TEST_ACCOUNT_ID,
        'kling',
        5, // Cost of 5 tokens
      );

      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(95); // 100 - 5
    });

    it('should reject when cost exceeds remaining tokens', async () => {
      const bucketState: TokenBucketState = {
        tokens: 3,
        lastRefill: Date.now(),
      };
      mockCache.get.mockResolvedValue(bucketState);
      mockCache.set.mockResolvedValue(undefined);

      const result = await limiter.checkAndConsumeToken(
        TEST_ACCOUNT_ID,
        'kling',
        5, // Requesting 5 but only 3 available
      );

      expect(result.allowed).toBe(false);
      expect(result.remaining).toBe(3);
      expect(result.retryAfter).toBeDefined();
    });

    it('should fail open on cache errors', async () => {
      mockCache.get.mockRejectedValue(new Error('Redis error'));

      const result = await limiter.checkAndConsumeToken(
        TEST_ACCOUNT_ID,
        'kling',
        1,
      );

      expect(result.allowed).toBe(true); // Fail open
      expect(mockLogger.error).toHaveBeenCalled();
    });

    it('should validate input with schema', async () => {
      await expect(
        limiter.checkAndConsumeToken('invalid-uuid', 'kling', 1),
      ).rejects.toThrow();
    });

    it('should handle different providers', async () => {
      mockCache.get.mockResolvedValue(null);
      mockCache.set.mockResolvedValue(undefined);

      // Runway has different limits
      const result = await limiter.checkAndConsumeToken(
        TEST_ACCOUNT_ID,
        'runway',
        1,
      );

      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(49); // 50 - 1 for runway standard
      expect(result.limit).toBe(50);
    });
  });

  describe('checkLimit', () => {
    it('should check without consuming tokens', async () => {
      const bucketState: TokenBucketState = {
        tokens: 50,
        lastRefill: Date.now(),
      };
      mockCache.get.mockResolvedValue(bucketState);

      const result1 = await limiter.checkLimit(TEST_ACCOUNT_ID, 'kling', 10);
      const result2 = await limiter.checkLimit(TEST_ACCOUNT_ID, 'kling', 10);

      expect(result1.allowed).toBe(true);
      expect(result1.remaining).toBe(50);
      expect(result2.remaining).toBe(50); // Unchanged
      expect(mockCache.set).not.toHaveBeenCalled();
    });

    it('should return full tokens for uninitialized bucket', async () => {
      mockCache.get.mockResolvedValue(null);

      const result = await limiter.checkLimit(TEST_ACCOUNT_ID, 'kling', 1);

      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(100);
    });

    it('should calculate refill correctly', async () => {
      const halfDayAgo = Date.now() - 12 * 60 * 60 * 1000;

      const bucketState: TokenBucketState = {
        tokens: 50,
        lastRefill: halfDayAgo,
      };
      mockCache.get.mockResolvedValue(bucketState);

      const result = await limiter.checkLimit(TEST_ACCOUNT_ID, 'kling', 1);

      // No refill yet (only half day passed)
      expect(result.remaining).toBe(50);
    });
  });

  describe('getRemainingTokens', () => {
    it('should return current token count', async () => {
      const bucketState: TokenBucketState = {
        tokens: 75,
        lastRefill: Date.now(),
      };
      mockCache.get.mockResolvedValue(bucketState);

      const remaining = await limiter.getRemainingTokens(
        TEST_ACCOUNT_ID,
        'kling',
      );

      expect(remaining).toBe(75);
    });

    it('should return max tokens for new bucket', async () => {
      mockCache.get.mockResolvedValue(null);

      const remaining = await limiter.getRemainingTokens(
        TEST_ACCOUNT_ID,
        'kling',
      );

      expect(remaining).toBe(100);
    });
  });

  describe('getStatus', () => {
    it('should return complete rate limit status', async () => {
      const bucketState: TokenBucketState = {
        tokens: 80,
        lastRefill: Date.now(),
      };
      mockCache.get.mockResolvedValue(bucketState);

      const status = await limiter.getStatus(TEST_ACCOUNT_ID, 'kling');

      expect(status.accountId).toBe(TEST_ACCOUNT_ID);
      expect(status.provider).toBe('kling');
      expect(status.tier).toBe('standard');
      expect(status.remaining).toBe(80);
      expect(status.limit).toBe(100);
      expect(status.percentUsed).toBe(20);
      expect(status.resetAt).toBeInstanceOf(Date);
    });

    it('should calculate percent used correctly', async () => {
      const bucketState: TokenBucketState = {
        tokens: 25,
        lastRefill: Date.now(),
      };
      mockCache.get.mockResolvedValue(bucketState);

      const status = await limiter.getStatus(TEST_ACCOUNT_ID, 'kling');

      expect(status.percentUsed).toBe(75);
    });
  });

  describe('resetLimit', () => {
    it('should clear rate limit state', async () => {
      mockCache.del.mockResolvedValue(undefined);

      await limiter.resetLimit(TEST_ACCOUNT_ID, 'kling');

      expect(mockCache.del).toHaveBeenCalledWith(
        `rate-limit:${TEST_ACCOUNT_ID}:kling`,
      );
      expect(mockLogger.info).toHaveBeenCalled();
    });
  });

  describe('tier handling', () => {
    it('should use different limits for different tiers', async () => {
      mockCache.get.mockResolvedValue(null);
      mockCache.set.mockResolvedValue(undefined);

      // Set to free tier
      limiter.setAccountTier(TEST_ACCOUNT_ID, 'free');

      const result = await limiter.checkAndConsumeToken(
        TEST_ACCOUNT_ID,
        'kling',
        1,
      );

      expect(result.limit).toBe(10); // Free tier limit
      expect(result.remaining).toBe(9);
    });

    it('should cache tier lookups', async () => {
      mockCache.get.mockResolvedValue(null);
      mockCache.set.mockResolvedValue(undefined);

      limiter.setAccountTier(TEST_ACCOUNT_ID, 'pro');

      await limiter.checkAndConsumeToken(TEST_ACCOUNT_ID, 'kling', 1);
      await limiter.checkAndConsumeToken(TEST_ACCOUNT_ID, 'kling', 1);

      // Tier should be cached after first call
      const status = await limiter.getStatus(TEST_ACCOUNT_ID, 'kling');
      expect(status.tier).toBe('pro');
    });

    it('should clear tier cache', async () => {
      limiter.setAccountTier(TEST_ACCOUNT_ID, 'pro');
      limiter.clearTierCache();

      // After clearing, should default to 'standard'
      const status = await limiter.getStatus(TEST_ACCOUNT_ID, 'kling');
      expect(status.tier).toBe('standard');
    });
  });

  describe('provider case handling', () => {
    it('should handle uppercase provider names', async () => {
      mockCache.get.mockResolvedValue(null);
      mockCache.set.mockResolvedValue(undefined);

      const result = await limiter.checkAndConsumeToken(
        TEST_ACCOUNT_ID,
        'KLING',
        1,
      );

      expect(result.allowed).toBe(true);
      expect(mockCache.set).toHaveBeenCalledWith(
        `rate-limit:${TEST_ACCOUNT_ID}:kling`,
        expect.any(Object),
        expect.any(Number),
      );
    });
  });
});

describe('Singleton functions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetRateLimiter();
  });

  describe('getRateLimiter', () => {
    it('should return singleton instance', () => {
      const limiter1 = getRateLimiter();
      const limiter2 = getRateLimiter();

      expect(limiter1).toBe(limiter2);
    });

    it('should create new instance after reset', () => {
      const limiter1 = getRateLimiter();
      resetRateLimiter();
      const limiter2 = getRateLimiter();

      expect(limiter1).not.toBe(limiter2);
    });
  });

  describe('checkRateLimit', () => {
    it('should use singleton limiter', async () => {
      mockCache.get.mockResolvedValue(null);
      mockCache.set.mockResolvedValue(undefined);

      const limiter = getRateLimiter();
      limiter.setAccountTier(TEST_ACCOUNT_ID_2, 'standard');

      const result = await checkRateLimit(TEST_ACCOUNT_ID_2, 'kling', 1);

      expect(result.allowed).toBe(true);
    });
  });

  describe('getRemainingTokens', () => {
    it('should use singleton limiter', async () => {
      mockCache.get.mockResolvedValue(null);

      const limiter = getRateLimiter();
      limiter.setAccountTier(TEST_ACCOUNT_ID_2, 'standard');

      const remaining = await getRemainingTokens(TEST_ACCOUNT_ID_2, 'kling');

      expect(remaining).toBe(100);
    });
  });

  describe('getRateLimitStatus', () => {
    it('should use singleton limiter', async () => {
      mockCache.get.mockResolvedValue(null);

      const limiter = getRateLimiter();
      limiter.setAccountTier(TEST_ACCOUNT_ID_2, 'standard');

      const status = await getRateLimitStatus(TEST_ACCOUNT_ID_2, 'kling');

      expect(status.accountId).toBe(TEST_ACCOUNT_ID_2);
      expect(status.provider).toBe('kling');
    });
  });
});

describe('Configuration', () => {
  it('should have configs for all documented providers', () => {
    const expectedProviders = ['kling', 'runway', 'luma', 'hailuo'];

    for (const provider of expectedProviders) {
      expect(RATE_LIMIT_CONFIGS[provider]).toBeDefined();
    }
  });

  it('should have all tiers for each provider', () => {
    const expectedTiers = ['free', 'standard', 'pro', 'enterprise'];

    for (const provider of Object.keys(RATE_LIMIT_CONFIGS)) {
      for (const tier of expectedTiers) {
        expect(RATE_LIMIT_CONFIGS[provider]?.[tier as never]).toBeDefined();
      }
    }
  });

  it('should have valid config structure', () => {
    for (const provider of Object.keys(RATE_LIMIT_CONFIGS)) {
      const providerConfigs = RATE_LIMIT_CONFIGS[provider];
      if (!providerConfigs) continue;

      for (const tier of Object.keys(providerConfigs)) {
        const config = providerConfigs[tier as keyof typeof providerConfigs];
        if (!config) continue;

        expect(config.maxTokens).toBeGreaterThan(0);
        expect(config.refillRate).toBeGreaterThan(0);
        expect(config.refillInterval).toBeGreaterThan(0);
        expect(config.costPerRequest).toBeGreaterThan(0);
      }
    }
  });
});
