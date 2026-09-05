/**
 * The result of asking a platform for a channel's current follower count
 * (FILM-1607 §2).
 *
 * A bare `number | null` is not enough. The capture has to tell a count that
 * is *permanently* unavailable — YouTube's `hiddenSubscriberCount`, which is
 * a creator setting and will be absent every night forever — from one that is
 * *transiently* unavailable, such as a missing `statistics` block, a 5xx, or
 * a revoked scope. The first must never raise an alert; the second always
 * must. Collapsing both into `null` makes those two requirements
 * unsatisfiable at once.
 *
 * Shared rather than duplicated because the three providers live in two
 * packages — YouTube in `@kit/publishing`, TikTok and Instagram in
 * `@kit/content-analytics` — and the capture reads all three.
 */
export type SubscriberCountResult =
  | { ok: true; count: number }
  | { ok: false; reason: 'hidden' | 'unavailable' };

/**
 * The granularity a platform reports a follower count at, for the given
 * magnitude. `0` means the figure is exact.
 *
 * YouTube rounds the public subscriber count to three significant figures
 * above 1,000 — for the channel owner too; the Analytics API exposes no exact
 * absolute metric to work around it. Stated in full rather than derived at
 * the reader, so an anchor's band is fixed once, at capture, where the
 * platform and magnitude are both known.
 */
export function youtubeRoundingStep(count: number): number {
  if (count < 1_000) return 0;

  // Three significant figures: the step is 10^(digits - 3).
  const digits = Math.floor(Math.log10(count)) + 1;

  return 10 ** (digits - 3);
}
