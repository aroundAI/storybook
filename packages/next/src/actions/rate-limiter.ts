/**
 * Simple in-memory rate limiter for server actions.
 * Limits per user per action to prevent abuse of expensive API calls.
 */
const rateLimitStore = new Map<string, { count: number; resetAt: number }>();

// Cleanup old entries every 5 minutes
if (typeof setInterval !== 'undefined') {
  setInterval(
    () => {
      const now = Date.now();
      for (const [key, value] of rateLimitStore) {
        if (now > value.resetAt) {
          rateLimitStore.delete(key);
        }
      }
    },
    5 * 60 * 1000,
  );
}

export function checkRateLimit(
  userId: string,
  actionName: string,
  opts: { maxRequests: number; windowMs: number } = {
    maxRequests: 10,
    windowMs: 60_000,
  },
): void {
  const key = `${userId}:${actionName}`;
  const now = Date.now();
  const entry = rateLimitStore.get(key);

  if (!entry || now > entry.resetAt) {
    rateLimitStore.set(key, { count: 1, resetAt: now + opts.windowMs });
    return;
  }

  if (entry.count >= opts.maxRequests) {
    throw new Error(
      `Rate limit exceeded for ${actionName}. Please wait before trying again.`,
    );
  }

  entry.count++;
}
