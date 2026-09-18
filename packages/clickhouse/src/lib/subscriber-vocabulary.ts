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
 * above 1,000. Only `interpolated` is reconstructed.
 */
export const SUBSCRIBER_SOURCE_LABEL: Record<SubscriberSource, string> = {
  snapshot: 'measured',
  constrained: 'measured, rounded by the platform',
  clamped: 'measured, held to the edge of the platform’s rounded figure',
  interpolated: 'reconstructed from daily movement, no snapshot that day',
};

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
