/**
 * Meta's rate limits, as the Graph API reports them
 * (https://developers.facebook.com/docs/graph-api/overview/rate-limiting/):
 *
 * - `X-Business-Use-Case-Usage`: `{ "<business-id>": [{ type, call_count,
 *   total_cputime, total_time, estimated_time_to_regain_access }] }`, each a
 *   whole-number percentage of the allowance over a rolling hour. Instagram
 *   calls carry `"type": "instagram"`. Throttling starts at 100.
 * - `X-App-Usage`: `{ call_count, total_time, total_cputime }`, the same
 *   percentages for the app as a whole.
 * - Throttled calls answer with code 4 (app), 17 (user), 32 (Pages), 613
 *   (custom) or 80002 (Instagram).
 */

/** Stop a channel's calls for the night at this share of the hourly allowance. */
export const USAGE_CEILING = 80;

export const THROTTLE_CODES: ReadonlySet<number> = new Set([
  4, 17, 32, 613, 80002,
]);

type UsageFigures = {
  call_count?: unknown;
  total_cputime?: unknown;
  total_time?: unknown;
};

function highest(figures: UsageFigures) {
  return Math.max(
    ...[figures.call_count, figures.total_cputime, figures.total_time].map(
      (value) => (typeof value === 'number' ? value : 0),
    ),
  );
}

/**
 * The highest percentage either header reports, or null when neither is
 * present or readable. The worst figure decides: Meta throttles when any one
 * reaches 100.
 */
export function metaUsagePercent(headers: {
  get(name: string): string | null;
}): number | null {
  const found: number[] = [];

  const business = headers.get('x-business-use-case-usage');
  if (business) {
    try {
      const parsed = JSON.parse(business) as Record<string, UsageFigures[]>;
      for (const entries of Object.values(parsed)) {
        for (const figures of Array.isArray(entries) ? entries : []) {
          found.push(highest(figures));
        }
      }
    } catch {
      // Unreadable: treated as absent, not as zero usage.
    }
  }

  const app = headers.get('x-app-usage');
  if (app) {
    try {
      found.push(highest(JSON.parse(app) as UsageFigures));
    } catch {
      // As above.
    }
  }

  return found.length > 0 ? Math.max(...found) : null;
}

/** A call Meta refused because a rate limit was reached. */
export class MetaRateLimitError extends Error {
  constructor(
    readonly code: number,
    message: string,
  ) {
    super(message);
    this.name = 'MetaRateLimitError';
  }
}

export function isMetaThrottle(code: unknown): code is number {
  return typeof code === 'number' && THROTTLE_CODES.has(code);
}
