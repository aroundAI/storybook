/**
 * Rate Limiter Module
 *
 * Provides rate limiting for video generation providers using token bucket algorithm.
 *
 * @example
 * ```typescript
 * import { checkRateLimit, getRateLimitStatus } from '@kit/video-generation/rate-limiter';
 *
 * // Check and consume token
 * const result = await checkRateLimit(accountId, 'kling', 1);
 * if (!result.allowed) {
 *   throw new Error(`Rate limit exceeded. Retry after ${result.retryAfter} seconds`);
 * }
 *
 * // Get status for UI
 * const status = await getRateLimitStatus(accountId, 'kling');
 * console.log(`${status.remaining}/${status.limit} tokens remaining`);
 * ```
 */

// Export class and singleton functions
export {
  RateLimiter,
  getRateLimiter,
  resetRateLimiter,
  checkRateLimit,
  getRemainingTokens,
  getRateLimitStatus,
} from './rate-limiter';

// Export types
export type {
  RateLimitTier,
  RateLimitConfig,
  RateLimitResult,
  RateLimitStatus,
  TokenBucketState,
  CheckLimitInput,
  GetRemainingInput,
  VideoCostMapping,
  TierLookupFn,
} from './types';

// Export schemas and errors
export { CheckLimitSchema, GetRemainingSchema, UnsupportedProviderError } from './types';

// Export configuration
export {
  RATE_LIMIT_CONFIGS,
  DEFAULT_RATE_LIMIT_CONFIG,
  VIDEO_COSTS,
  getRateLimitConfig,
  SUPPORTED_PROVIDERS,
  isProviderSupported,
} from './config';
