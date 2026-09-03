/**
 * Cohort-over-cohort growth.
 *
 * Pure, so the rule that decides whether a growth figure is reportable can
 * be tested directly — that rule is the whole value of the calculation.
 */

/** Mature videos each side needs before a comparison is reportable. */
export const MIN_MATURE_VIDEOS = 5;

/** Why a growth figure is absent, when it is. */
export type GrowthSuppressionReason =
  | 'no_prior_cohort'
  | 'insufficient_sample'
  | 'no_prior_baseline';

export interface CheckpointStats {
  medianViews: number;
  matureVideoCount: number;
}

export interface CohortGrowth {
  /** Fractional change against the prior cohort, or null when suppressed. */
  growth: number | null;
  reason: GrowthSuppressionReason | null;
}

/**
 * Growth of one cohort's median against the previous cohort's, at one
 * checkpoint.
 *
 * Suppressed rather than approximated. A median resting on two videos is
 * one video's luck, and a "+340%" headline computed from it is worse than
 * no headline — so the reason is returned in place of the number, for the
 * caller to show instead of a figure.
 */
export function computeCheckpointGrowth(
  current: CheckpointStats | undefined,
  prior: CheckpointStats | undefined,
  minMatureVideos: number = MIN_MATURE_VIDEOS,
): CohortGrowth {
  if (!prior || !current) {
    return { growth: null, reason: 'no_prior_cohort' };
  }

  if (
    current.matureVideoCount < minMatureVideos ||
    prior.matureVideoCount < minMatureVideos
  ) {
    return { growth: null, reason: 'insufficient_sample' };
  }

  // A ratio against zero is undefined, not infinite growth. "The prior
  // cohort had no views" is a real state and says nothing about the rate.
  if (prior.medianViews === 0) {
    return { growth: null, reason: 'no_prior_baseline' };
  }

  return {
    growth: current.medianViews / prior.medianViews - 1,
    reason: null,
  };
}

/**
 * Growth for every cohort against its immediate predecessor.
 *
 * `cohorts` must be in chronological order — the caller's query orders by
 * cohort ascending, and comparing against the wrong neighbour would invert
 * the sign silently.
 */
export function computeCohortGrowth<
  T extends { checkpoints: Record<number, CheckpointStats> },
>(
  cohorts: T[],
  checkpoints: number[],
  minMatureVideos: number = MIN_MATURE_VIDEOS,
): Array<Record<number, CohortGrowth>> {
  return cohorts.map((cohort, index) => {
    const prior = index > 0 ? cohorts[index - 1] : undefined;
    const growthByCheckpoint: Record<number, CohortGrowth> = {};

    for (const days of checkpoints) {
      growthByCheckpoint[days] = computeCheckpointGrowth(
        cohort.checkpoints[days],
        prior?.checkpoints[days],
        minMatureVideos,
      );
    }

    return growthByCheckpoint;
  });
}
