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
 * How far a figure built on a rounded anchor can sit from the truth.
 *
 * Either way, not only low. The seed pins to the floor of the platform's
 * rounded band, so the first stretch can only read low; but a later anchor
 * can clamp a level to the band's top, or leave it anywhere inside, and then
 * it can read high. The true count is inside the band on every anchor day,
 * so the error is at most one less than the step in either direction.
 */
export function roundingErrorOf(roundingStep: number): number {
  return Math.max(0, roundingStep - 1);
}

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
