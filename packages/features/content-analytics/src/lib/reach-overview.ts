import {
  ANALYTICS_PLATFORMS,
  type AnalyticsPlatform,
  VIEWS_COLUMN_PLATFORMS,
  capabilityFor,
} from '@kit/clickhouse';

/**
 * The cross-platform reach page's rules (design approved 2026-09-28), kept
 * apart from the reads so they can be tested without a database.
 *
 * Unique accounts never add up: not across days, posts, channels or
 * platforms. So a unique figure is always one channel's or one post's, and
 * the only totals on the page are views, comments and shares.
 */

export const REACH_WINDOWS = [7, 30, 90] as const;
export type ReachWindow = (typeof REACH_WINDOWS)[number];

/** Meta's longest unique-reach window; anything longer is not measured. */
export const LONGEST_UNIQUE_WINDOW = 30;

export const NINETY_DAY_REASON =
  "Not measured: Meta's longest unique-reach window is 30 days, and a 90-day figure cannot be built by adding shorter ones — the same person would be counted more than once.";

export function parseReachWindow(value: string | undefined): ReachWindow {
  const days = Number(value);
  return (REACH_WINDOWS as readonly number[]).includes(days)
    ? (days as ReachWindow)
    : 7;
}

/**
 * The window's days, as `YYYY-MM-DD`, ending on the last complete day: a
 * window recorded "as of" yesterday covers yesterday and the days before.
 */
export function windowBounds(
  window: ReachWindow,
  now: Date,
): { from: string; to: string } {
  const to = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1),
  );
  const from = new Date(to);
  from.setUTCDate(to.getUTCDate() - (window - 1));

  return { from: isoDay(from), to: isoDay(to) };
}

export function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export type Measured<T> =
  | { measured: true; value: T }
  | { measured: false; reason: string };

/**
 * Whether a channel's unique reach exists for this platform and window, and
 * if not, the capability matrix's own sentence for why.
 */
export function channelReachAvailability(
  platform: AnalyticsPlatform,
  window: ReachWindow,
): Measured<true> {
  const capability = capabilityFor('channel_accounts_reached', platform);

  if (capability.level !== 'native' && capability.level !== 'derived') {
    return { measured: false, reason: `Not measured: ${capability.note}` };
  }

  if (window > LONGEST_UNIQUE_WINDOW) {
    return { measured: false, reason: NINETY_DAY_REASON };
  }

  return { measured: true, value: true };
}

/** Whether a post's first-time viewers exist for this platform. */
export function postReachAvailability(
  platform: AnalyticsPlatform,
): Measured<true> {
  const capability = capabilityFor('accounts_reached', platform);

  return capability.level === 'native' || capability.level === 'derived'
    ? { measured: true, value: true }
    : { measured: false, reason: `Not measured: ${capability.note}` };
}

export function isAnalyticsPlatform(
  platform: string,
): platform is AnalyticsPlatform {
  return (ANALYTICS_PLATFORMS as readonly string[]).includes(platform);
}

export interface Counts {
  /** Null on a platform with no single view (Facebook, FILM-1720): not measured. */
  views: number | null;
  comments: number;
  shares: number;
}

export const NO_SINGLE_VIEW_REASON =
  'Not measured: Facebook counts four different kinds of view, and none of them is a view in this sense, so its plays are not added to views.';

/** A platform's views as a reader hands them over: null where there is no single view. */
export function measuredViews(
  platform: AnalyticsPlatform,
  views: number | string | null,
): number | null {
  return VIEWS_COLUMN_PLATFORMS.includes(platform) && views !== null
    ? Number(views)
    : null;
}

/**
 * Views, comments and shares add up — one view is one view — so these are
 * the only figures the All tab totals. A platform with no single view adds
 * nothing to views; its comments and shares still count.
 */
export function totalCounts(rows: readonly Counts[]): Counts {
  return rows.reduce<Counts>(
    (total, row) => ({
      views: (total.views ?? 0) + (row.views ?? 0),
      comments: total.comments + row.comments,
      shares: total.shares + row.shares,
    }),
    { views: 0, comments: 0, shares: 0 },
  );
}
