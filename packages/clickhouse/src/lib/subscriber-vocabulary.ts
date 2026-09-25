import type { SubscriberSource } from './subscriber-series';

/**
 * The words and rules every subscriber surface shares (FILM-1617): the Deep
 * Dive curve, its tooltip and legend, the YPP card and the publish screen's
 * follower count. One definition each, here, because two copies of the same
 * label drifted apart within a week — a rounded snapshot day read "measured"
 * on one surface and "reconstructed" on another.
 *
 * Pure and client-safe.
 */

/**
 * How a day's level was arrived at, in words.
 *
 * `constrained` and `clamped` only occur on days with an anchor, so they are
 * measured days whose figure the platform rounded — every YouTube snapshot
 * above 1,000. `interpolated` and `between_snapshots` are reconstructed: the
 * first from measured daily movement, the second — for a channel whose
 * platform reports none (KB-114) — as a straight line between two recorded
 * follower counts.
 */
export const SUBSCRIBER_SOURCE_LABEL: Record<SubscriberSource, string> = {
  snapshot: 'measured',
  constrained: 'measured, rounded by the platform',
  clamped: 'measured, held to the edge of the platform’s rounded figure',
  interpolated: 'reconstructed from daily movement, no snapshot that day',
  between_snapshots:
    'reconstructed from follower snapshots — a straight line between two recorded counts, not measured that day',
};

/**
 * Whether a day's level was measured — a snapshot that day, exact or
 * rounded — rather than reconstructed from movement alone.
 *
 * The one statement of this rule. Four copies of it once existed, and a
 * redefinition of `constrained` and `clamped` as measured updated three:
 * the fourth drew a capture gap in a total as measured.
 */
export function isMeasuredSource(source: SubscriberSource): boolean {
  return source !== 'interpolated' && source !== 'between_snapshots';
}

// Least to most measured. A reconstructed part makes any combination
// reconstructed; among measured parts, the one furthest from an exact
// snapshot wins.
const SOURCE_ORDER: readonly SubscriberSource[] = [
  // Weakest: no movement measured at all, only a line between two counts.
  'between_snapshots',
  'interpolated',
  'clamped',
  'constrained',
  'snapshot',
];

/** How a total's day was arrived at: the weakest of its parts. */
export function weakestSource(
  a: SubscriberSource,
  b: SubscriberSource,
): SubscriberSource {
  return SOURCE_ORDER.indexOf(a) <= SOURCE_ORDER.indexOf(b) ? a : b;
}

/**
 * How far a figure built on a rounded anchor can sit from the truth, either
 * way. The seed pins to the floor of the platform's rounded band, but a
 * later anchor can clamp a level to the band's top or leave it anywhere
 * inside, so the error runs both ways, by at most one less than the step.
 */
export function roundingErrorOf(roundingStep: number): number {
  return Math.max(0, roundingStep - 1);
}

/**
 * The platforms `captureSubscriberSnapshots` reads a count from. Others —
 * Facebook, X, LinkedIn — are allowed connections but are never snapshotted,
 * so "no count yet" would be the wrong explanation for them.
 */
export const SUBSCRIBER_TRACKED_PLATFORMS = [
  'youtube',
  'tiktok',
  'instagram',
] as const;

export type SubscriberTrackedPlatform =
  (typeof SUBSCRIBER_TRACKED_PLATFORMS)[number];

export function isSubscriberTracked(
  platform: string,
): platform is SubscriberTrackedPlatform {
  return (SUBSCRIBER_TRACKED_PLATFORMS as readonly string[]).includes(platform);
}

/**
 * How old a level may be before a surface marks it as old. A week clears
 * YouTube's usual 2-3 day reporting lag, so a healthy channel is never
 * marked; a disconnected one, or one whose capture broke, soon is.
 */
export const SUBSCRIBER_LEVEL_FRESH_DAYS = 7;

export function isLevelOutdated(asOf: string, today: string): boolean {
  const days = Math.round(
    (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${asOf}T00:00:00Z`)) /
      86_400_000,
  );

  return days > SUBSCRIBER_LEVEL_FRESH_DAYS;
}
