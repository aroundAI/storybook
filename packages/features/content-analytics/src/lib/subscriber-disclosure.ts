import { SUBSCRIBER_SOURCE_LABEL, roundingErrorOf } from '@kit/clickhouse';

/**
 * What every surface showing a subscriber level must say about it
 * (FILM-1617 §3), kept in one place so the Deep Dive curve and the YPP card
 * cannot describe the same number differently.
 */

// One table for every surface, the follower chip included: defined in
// @kit/clickhouse, which the publishing package also depends on.
export { SUBSCRIBER_SOURCE_LABEL, roundingErrorOf };

/** Why a channel has no level. The data cannot tell these two apart. */
export const NO_SUBSCRIBER_LEVEL =
  'No subscriber count yet — the channel owner may hide it, or no snapshot has been captured.';

/**
 * A rounded seed offsets every reconstructed day by the same amount, so the
 * curve's shape is exact while its height is not.
 *
 * Takes the error bound itself, not a step: a total adds its channels'
 * bounds, which no single step describes.
 */
export function describeRounding(maxError: number): string | null {
  if (maxError <= 0) return null;

  return `The platform rounds this count, so it may be off by up to ${maxError.toLocaleString(
    'en-US',
  )} either way. The shape of the curve is exact; its height is approximate.`;
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
