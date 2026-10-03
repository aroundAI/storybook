import 'server-only';

import type { CacheClient } from '@kit/cache';

export interface RateLimits {
  callsPerMinute: number;
  writesPerMinute: number;
}

export const DEFAULT_RATE_LIMITS: RateLimits = {
  callsPerMinute: 120,
  writesPerMinute: 60,
};

export type RateLimitName =
  | 'connection_calls'
  | 'team_calls'
  | 'connection_writes'
  | 'team_writes';

export type RateLimitDecision =
  | { allowed: true }
  | { allowed: false; limit: RateLimitName; retryAfterS: number };

const WINDOW_MS = 60_000;

/**
 * Fixed one-minute windows, counted atomically in the cache layer: per
 * connection and per team, for every call and again for writes. A counter
 * key carries its window start, so a new window starts at zero without
 * anything being reset; the TTL only tidies old windows away.
 */
export async function checkRateLimits(
  cache: CacheClient,
  input: {
    connectionId: string;
    accountId: string;
    isWrite: boolean;
    limits?: RateLimits;
    now?: number;
  },
): Promise<RateLimitDecision> {
  const limits = input.limits ?? DEFAULT_RATE_LIMITS;
  const now = input.now ?? Date.now();
  const windowStart = Math.floor(now / WINDOW_MS) * WINDOW_MS;
  const retryAfterS = Math.max(
    1,
    Math.ceil((windowStart + WINDOW_MS - now) / 1000),
  );
  const ttl = 2 * (WINDOW_MS / 1000);

  const counters: Array<{ limit: RateLimitName; key: string; max: number }> = [
    {
      limit: 'connection_calls',
      key: `mcp:rl:conn:${input.connectionId}:calls:${windowStart}`,
      max: limits.callsPerMinute,
    },
    {
      limit: 'team_calls',
      key: `mcp:rl:team:${input.accountId}:calls:${windowStart}`,
      max: limits.callsPerMinute,
    },
  ];

  if (input.isWrite) {
    counters.push(
      {
        limit: 'connection_writes',
        key: `mcp:rl:conn:${input.connectionId}:writes:${windowStart}`,
        max: limits.writesPerMinute,
      },
      {
        limit: 'team_writes',
        key: `mcp:rl:team:${input.accountId}:writes:${windowStart}`,
        max: limits.writesPerMinute,
      },
    );
  }

  for (const counter of counters) {
    const count = await cache.incr(counter.key, ttl);

    if (count > counter.max) {
      return { allowed: false, limit: counter.limit, retryAfterS };
    }
  }

  return { allowed: true };
}

export function rateLimitsFromEnv(): RateLimits {
  return {
    callsPerMinute: positiveInt(
      process.env.MCP_RATE_LIMIT_CALLS_PER_MIN,
      DEFAULT_RATE_LIMITS.callsPerMinute,
    ),
    writesPerMinute: positiveInt(
      process.env.MCP_RATE_LIMIT_WRITES_PER_MIN,
      DEFAULT_RATE_LIMITS.writesPerMinute,
    ),
  };
}

function positiveInt(value: string | undefined, fallback: number) {
  const parsed = Number.parseInt(value ?? '', 10);

  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}
