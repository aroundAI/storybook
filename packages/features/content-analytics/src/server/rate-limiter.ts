import 'server-only';

import { SYNC_PLATFORMS } from './types';
import type { RateLimitConfig, SyncPlatform } from './types';

/**
 * Platform-specific rate limits
 *
 * YouTube Analytics API: 200 queries/day per project
 * TikTok Creator Tools API: 1000 requests/day
 * Instagram Graph API: 200 calls/hour per user token
 */
const RATE_LIMITS: Record<SyncPlatform, RateLimitConfig> = {
  youtube: {
    requestsPerMinute: 10,
    requestsPerDay: 200,
  },
  tiktok: {
    requestsPerMinute: 20,
    requestsPerDay: 1000,
  },
  instagram: {
    requestsPerMinute: 30,
    requestsPerDay: 4800, // 200/hour * 24
  },
  // One sync is up to five Graph calls (video node, two video_insights,
  // post, post insights) against a Page's BUC allowance of 4800 × engaged
  // users a day, so a fifth of Instagram's per-sync budget.
  facebook: {
    requestsPerMinute: 6,
    requestsPerDay: 960,
  },
};

/**
 * In-memory rate limiter with sliding window
 */
class PlatformRateLimiter {
  private requests: Map<SyncPlatform, number[]> = new Map();
  private dailyCounts: Map<SyncPlatform, { count: number; resetAt: number }> =
    new Map();

  constructor() {
    // Initialize maps for all platforms
    for (const platform of SYNC_PLATFORMS) {
      this.requests.set(platform, []);
      this.dailyCounts.set(platform, {
        count: 0,
        resetAt: this.getNextMidnight(),
      });
    }
  }

  private getNextMidnight(): number {
    const tomorrow = new Date();
    tomorrow.setUTCHours(24, 0, 0, 0);
    return tomorrow.getTime();
  }

  /**
   * Check if a request can be made for the given platform
   */
  canRequest(platform: SyncPlatform): boolean {
    const limits = RATE_LIMITS[platform];
    if (!limits) return false;

    const now = Date.now();
    const oneMinuteAgo = now - 60 * 1000;

    // Clean up old requests
    const requests = this.requests.get(platform) ?? [];
    const recentRequests = requests.filter((time) => time > oneMinuteAgo);
    this.requests.set(platform, recentRequests);

    // Check minute limit
    if (recentRequests.length >= limits.requestsPerMinute) {
      return false;
    }

    // Check daily limit
    const daily = this.dailyCounts.get(platform);
    if (!daily) return false;

    if (now >= daily.resetAt) {
      // Reset daily counter
      daily.count = 0;
      daily.resetAt = this.getNextMidnight();
    }

    if (daily.count >= limits.requestsPerDay) {
      return false;
    }

    return true;
  }

  /**
   * Record a request for rate limiting
   */
  recordRequest(platform: SyncPlatform): void {
    const now = Date.now();

    // Record for minute window
    const requests = this.requests.get(platform) ?? [];
    requests.push(now);
    this.requests.set(platform, requests);

    // Increment daily counter
    const daily = this.dailyCounts.get(platform);
    if (daily) {
      daily.count++;
    }
  }

  /**
   * Get time to wait before next request (ms)
   */
  getWaitTime(platform: SyncPlatform): number {
    const limits = RATE_LIMITS[platform];
    if (!limits) return 0;

    const now = Date.now();
    const oneMinuteAgo = now - 60 * 1000;

    const requests = this.requests.get(platform) ?? [];
    const recentRequests = requests.filter((time) => time > oneMinuteAgo);

    if (recentRequests.length >= limits.requestsPerMinute) {
      // Wait until oldest request expires from window
      const oldestInWindow = Math.min(...recentRequests);
      return oldestInWindow + 60 * 1000 - now + 100; // +100ms buffer
    }

    // Check daily limit
    const daily = this.dailyCounts.get(platform);
    if (daily && daily.count >= limits.requestsPerDay) {
      return daily.resetAt - now;
    }

    return 0;
  }

  /**
   * Get remaining requests for a platform
   */
  getRemainingRequests(platform: SyncPlatform): {
    perMinute: number;
    perDay: number;
  } {
    const limits = RATE_LIMITS[platform];
    if (!limits) return { perMinute: 0, perDay: 0 };

    const now = Date.now();
    const oneMinuteAgo = now - 60 * 1000;

    const requests = this.requests.get(platform) ?? [];
    const recentRequests = requests.filter((time) => time > oneMinuteAgo);
    const daily = this.dailyCounts.get(platform);

    return {
      perMinute: Math.max(0, limits.requestsPerMinute - recentRequests.length),
      perDay: Math.max(0, limits.requestsPerDay - (daily?.count ?? 0)),
    };
  }
}

// Singleton instance
let rateLimiterInstance: PlatformRateLimiter | null = null;

/**
 * Get the rate limiter singleton
 */
export function getRateLimiter(): PlatformRateLimiter {
  if (!rateLimiterInstance) {
    rateLimiterInstance = new PlatformRateLimiter();
  }
  return rateLimiterInstance;
}

/**
 * Reset rate limiter (for testing)
 */
export function resetRateLimiter(): void {
  rateLimiterInstance = null;
}

/**
 * Get rate limit configuration for a platform
 */
export function getRateLimitConfig(platform: SyncPlatform): RateLimitConfig {
  return RATE_LIMITS[platform];
}
