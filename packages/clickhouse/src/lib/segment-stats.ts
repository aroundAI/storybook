/**
 * Segment statistics (FILM-1606).
 *
 * Pure, so the rules that decide whether a segment's figure can be trusted
 * are testable on their own — which matters more than usual here, because
 * CLICKHOUSE_ENABLED is false in every environment today, so these rules
 * are the only part of segment performance that can be proved at all.
 *
 * The aggregation stays in SQL; only the statistics live here. Same line
 * FILM-1604 drew between queryCohortMedians and lib/cohort-growth.ts.
 */

/** Mature videos a segment needs before its figures stop being noise. */
export const CONFIDENCE_DIRECTIONAL_MIN = 5;

/** Mature videos a segment needs before its figures are worth reporting. */
export const CONFIDENCE_REPORTABLE_MIN = 15;

/** Spread at or above which a segment is no longer internally consistent. */
export const SPREAD_CONSISTENT_MAX = 2;

/** Spread above which one video is carrying the segment. */
export const SPREAD_CARRIED_MIN = 4;

/** How much weight a segment's figures can bear. */
export type SegmentConfidence = 'insufficient' | 'directional' | 'reportable';

/** What the gap between a segment's top video and its median means. */
export type SpreadInterpretation = 'consistent' | 'mixed' | 'carried_by_one';

/**
 * How much weight a segment's figures can bear, from the number of videos
 * that actually reached the checkpoint.
 *
 * Disclosed, never enforced. A hard gate hides the only information a new
 * channel has, and an undisclosed sample size invites a decision made on
 * two videos' luck — so every tier renders, carrying its own n.
 *
 * Takes `matureVideoCount`, never `videoCount`: a segment of forty videos
 * where three have reached 30 days is a three-video sample wearing a
 * forty-video label.
 */
export function resolveConfidence(matureVideoCount: number): SegmentConfidence {
  if (matureVideoCount >= CONFIDENCE_REPORTABLE_MIN) return 'reportable';
  if (matureVideoCount >= CONFIDENCE_DIRECTIONAL_MIN) return 'directional';

  return 'insufficient';
}

/**
 * Revenue per thousand views for a whole segment, pooled.
 *
 * Σrevenue / Σviews, never a mean of per-video RPMs — that mean is
 * dominated by videos with a handful of views, where one purchase produces
 * a four-figure rate that says nothing about the segment.
 *
 * Null rather than zero when there are no views to divide by: "this
 * segment earned nothing per view" and "this segment has no views yet" are
 * different facts, and only the first is a finding.
 */
export function pooledRpmCents(
  revenueCents: number,
  views: number,
): number | null {
  if (views <= 0) return null;

  return (revenueCents / views) * 1000;
}

/**
 * How far the segment's best video sits above its median.
 *
 * Null rather than Infinity when the median is zero — the same suppression
 * `computeCheckpointGrowth` applies to a zero baseline. A ratio against
 * zero is undefined, not infinitely large, and a card rendering "Infinity"
 * is a bug the user has to interpret.
 */
export function computeSpread(
  maxViews: number,
  medianViews: number,
): number | null {
  if (medianViews <= 0) return null;

  return maxViews / medianViews;
}

/**
 * Reads a spread as a sentence about the segment.
 *
 * The thresholds are the workbook's own. Both are strict, so the
 * boundaries fall in the middle band rather than being claimed by either
 * end — a segment sitting exactly on 4.0 is not yet evidence that one
 * video is carrying it.
 */
export function interpretSpread(
  spread: number | null,
): SpreadInterpretation | null {
  if (spread === null) return null;

  if (spread < SPREAD_CONSISTENT_MAX) return 'consistent';
  if (spread > SPREAD_CARRIED_MIN) return 'carried_by_one';

  return 'mixed';
}
