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
 * A rounded seed offsets every reconstructed day by the same amount, so the
 * curve's shape is exact while its height is not. YouTube rounds down, so the
 * true count is at or above the figure shown.
 */
export function describeRounding(roundingStep: number): string | null {
  if (roundingStep <= 1) return null;

  return `The platform reports this count rounded down, so the true figure may be up to ${(
    roundingStep - 1
  ).toLocaleString()} higher. The shape of the curve is exact; its height is approximate.`;
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
