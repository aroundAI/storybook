/**
 * What an X analytics read costs, and when one is allowed (FILM-1727).
 *
 * X is the one platform where a sync costs money. The pay-per-use tier bills
 * *"Posts: Read"* at $0.005 per post returned, charges a post read twice in
 * one UTC day once, and caps a billing cycle at 3,000,000 post reads
 * (https://docs.x.com/x-api/getting-started/pricing, read 2026-10-01). The
 * playback quartiles we read are non-public metrics, which exist only for
 * posts created within the last 30 days
 * (https://docs.x.com/x-api/fundamentals/metrics, read 2026-10-01).
 *
 * So every rule below is a ceiling on spend, stated here once:
 *
 * - **Dark until switched on.** Nothing reads X unless `X_ANALYTICS_ENABLED`
 *   is `true` — off until the owner holds a funded pay-per-use account.
 * - **Never past the wall.** A read is refused from day 29 after publish. The
 *   publish row's timestamp is ours, written after X answered, so X's own
 *   creation time is a little earlier; the spare day keeps us inside.
 * - **Once per UTC day per post.** X would not charge a second read that day,
 *   but the cap must not depend on a vendor's deduplication.
 * - **A hard daily ceiling.** At most `X_MAX_POST_READS_PER_UTC_DAY` post
 *   reads a UTC day across every account, counted from the database so a
 *   second run in the same day sees the first.
 *
 * Pure and client-safe: the sync applies it, and the tests read it.
 */

const DAY_MS = 86_400_000;

/** USD per post returned by `GET /2/tweets`, pay-per-use. */
export const X_POST_READ_USD = 0.005;

/** X's documented wall on non-public metrics, from the post's creation. */
export const X_NON_PUBLIC_WINDOW_DAYS = 30;

/** The last post age, in whole days, we still read at. One day inside the wall. */
export const X_LAST_READ_AGE_DAYS = X_NON_PUBLIC_WINDOW_DAYS - 2;

/**
 * At most this many post reads in one UTC day, every account together:
 * $0.50 a day, $15 for a 30-day month. Raising it is a cost decision, so it is
 * a code change reviewed as one, not an environment variable.
 */
export const X_MAX_POST_READS_PER_UTC_DAY = 100;

/** The most one post can ever cost us: one read a day for the days it is read. */
export const X_MAX_USD_PER_POST = X_POST_READ_USD * (X_LAST_READ_AGE_DAYS + 1);

export const X_MAX_USD_PER_UTC_DAY =
  X_POST_READ_USD * X_MAX_POST_READS_PER_UTC_DAY;

export type XReadRefusal =
  | 'disabled'
  | 'outside_window'
  | 'read_today'
  | 'daily_budget_spent';

export type XReadDecision =
  | { read: true }
  | { read: false; reason: XReadRefusal };

/** Midnight UTC at the start of `now`'s day, as an ISO string. */
export function utcDayStart(now: Date): string {
  const start = new Date(now);
  start.setUTCHours(0, 0, 0, 0);
  return start.toISOString();
}

/** Whole days since `publishedAt`, rounded down. */
export function postAgeDays(publishedAt: Date, now: Date): number {
  return Math.floor((now.getTime() - publishedAt.getTime()) / DAY_MS);
}

/** `X_ANALYTICS_ENABLED`, read strictly: only the literal `true` turns it on. */
export function xAnalyticsEnabled(
  env: Record<string, string | undefined>,
): boolean {
  return env.X_ANALYTICS_ENABLED === 'true';
}

/**
 * Whether one post may be read now. `readsToday` is the number of X post
 * reads already made since `utcDayStart(now)`, this one excluded.
 */
export function decideXRead(input: {
  enabled: boolean;
  publishedAt: Date;
  now: Date;
  lastReadAt: Date | null;
  readsToday: number;
}): XReadDecision {
  if (!input.enabled) return { read: false, reason: 'disabled' };

  const age = postAgeDays(input.publishedAt, input.now);

  if (age < 0 || age > X_LAST_READ_AGE_DAYS) {
    return { read: false, reason: 'outside_window' };
  }

  if (
    input.lastReadAt !== null &&
    input.lastReadAt.toISOString() >= utcDayStart(input.now)
  ) {
    return { read: false, reason: 'read_today' };
  }

  if (input.readsToday >= X_MAX_POST_READS_PER_UTC_DAY) {
    return { read: false, reason: 'daily_budget_spent' };
  }

  return { read: true };
}

/**
 * The posts to read this run, in the order given, with the daily ceiling
 * applied across them: the decision for each counts the reads granted to the
 * ones before it.
 */
export function planXReads<T>(
  candidates: readonly T[],
  input: {
    enabled: boolean;
    now: Date;
    readsToday: number;
    publishedAt: (candidate: T) => Date;
    lastReadAt: (candidate: T) => Date | null;
  },
): { read: T[]; refused: Array<{ candidate: T; reason: XReadRefusal }> } {
  const read: T[] = [];
  const refused: Array<{ candidate: T; reason: XReadRefusal }> = [];

  for (const candidate of candidates) {
    const decision = decideXRead({
      enabled: input.enabled,
      now: input.now,
      publishedAt: input.publishedAt(candidate),
      lastReadAt: input.lastReadAt(candidate),
      readsToday: input.readsToday + read.length,
    });

    if (decision.read) read.push(candidate);
    else refused.push({ candidate, reason: decision.reason });
  }

  return { read, refused };
}
