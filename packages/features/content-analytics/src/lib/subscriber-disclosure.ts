import type { SubscriberSource } from '@kit/clickhouse';

/**
 * What every surface showing a subscriber level must say about it
 * (FILM-1617 §3), kept in one place so the Deep Dive curve and the YPP card
 * cannot describe the same number differently.
 */

export const SUBSCRIBER_SOURCE_LABEL: Record<SubscriberSource, string> = {
  snapshot: 'measured',
  interpolated: 'reconstructed from daily movement',
  constrained: 'reconstructed, within the platform’s rounded figure',
  clamped: 'held to the edge of the platform’s rounded figure',
};

/** Why a channel has no level. The data cannot tell these two apart. */
export const NO_SUBSCRIBER_LEVEL =
  'No subscriber count yet — the channel owner may hide it, or no snapshot has been captured.';

/**
 * How far below the truth a figure seeded from a rounded anchor can sit.
 * YouTube rounds down, so the true count is at or above the reported one, by
 * at most one less than the rounding step.
 */
export function shortfallOf(roundingStep: number): number {
  return Math.max(0, roundingStep - 1);
}

/**
 * A rounded seed offsets every reconstructed day by the same amount, so the
 * curve's shape is exact while its height is not.
 *
 * Takes the largest possible shortfall, not a step: a total adds its
 * channels' shortfalls, which no single step describes.
 */
export function describeRounding(maxShortfall: number): string | null {
  if (maxShortfall <= 0) return null;

  return `The platform reports this count rounded down, so the true figure may be up to ${maxShortfall.toLocaleString(
    'en-US',
  )} higher. The shape of the curve is exact; its height is approximate.`;
}

/** `YYYY-MM-DD` as "Sep 12, 2026", read in UTC so it never shifts a day. */
export function formatSubscriberDay(date: string): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
}
