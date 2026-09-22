/**
 * The published asset's duration, or the named reason there is none
 * (FILM-1710).
 *
 * A duration used to travel as a bare number whose absence was `0`, which is
 * how an episode's 22 minutes stood in for a 45-second Short without anything
 * noticing. Here absence is a state a consumer has to handle: there is no
 * number to read until `known` has been checked.
 */
export type AssetDuration =
  | { known: true; seconds: number }
  | { known: false; reason: 'duration_unknown' };

export const DURATION_UNKNOWN: AssetDuration = {
  known: false,
  reason: 'duration_unknown',
};

/**
 * A provider's or a column's raw value as whole seconds, or null.
 *
 * Zero, a negative, a non-finite number and anything that is not a number
 * are all "no measurement". Zero in particular: no platform serves a
 * zero-second video, so a 0 is a default that leaked.
 */
export function normalizeAssetDurationSeconds(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;

  const seconds = Math.round(value);

  return seconds > 0 ? seconds : null;
}

export function resolveAssetDuration(value: unknown): AssetDuration {
  const seconds = normalizeAssetDurationSeconds(value);

  return seconds === null ? DURATION_UNKNOWN : { known: true, seconds };
}

/**
 * Which platforms can be asked for a published asset's duration.
 *
 * Instagram is absent on purpose: Meta's IG Media node has no duration
 * field (docs/platform-capability-reference.md, forbidden list), so its
 * publishes are `duration_unknown` rather than something to request.
 */
export const ASSET_DURATION_PLATFORMS = ['youtube', 'tiktok'] as const;

export type AssetDurationPlatform = (typeof ASSET_DURATION_PLATFORMS)[number];
