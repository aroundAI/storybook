import { describe, expect, it } from 'vitest';

import {
  MIN_MATURE_VIDEOS,
  computeCheckpointGrowth,
  computeCohortGrowth,
} from '../src/lib/cohort-growth';

const solid = (medianViews: number) => ({
  medianViews,
  matureVideoCount: MIN_MATURE_VIDEOS,
});

describe('computeCheckpointGrowth', () => {
  it('reports the fractional change against the prior cohort', () => {
    expect(computeCheckpointGrowth(solid(1500), solid(1000))).toEqual({
      growth: 0.5,
      reason: null,
    });
  });

  it('reports a decline as a negative figure', () => {
    expect(computeCheckpointGrowth(solid(750), solid(1000)).growth).toBe(-0.25);
  });

  it('suppresses the first cohort, which has nothing to compare against', () => {
    expect(computeCheckpointGrowth(solid(1000), undefined)).toEqual({
      growth: null,
      reason: 'no_prior_cohort',
    });
  });

  it('suppresses when the current cohort rests on too few mature videos', () => {
    // Four mature videos is one video's luck, and a headline computed from
    // it is worse than no headline.
    const thin = { medianViews: 5000, matureVideoCount: 4 };

    expect(computeCheckpointGrowth(thin, solid(1000))).toEqual({
      growth: null,
      reason: 'insufficient_sample',
    });
  });

  it('suppresses when the prior cohort rests on too few mature videos', () => {
    const thin = { medianViews: 1000, matureVideoCount: 4 };

    expect(computeCheckpointGrowth(solid(1500), thin).reason).toBe(
      'insufficient_sample',
    );
  });

  it('reports at exactly the threshold', () => {
    const atThreshold = {
      medianViews: 1200,
      matureVideoCount: MIN_MATURE_VIDEOS,
    };

    expect(computeCheckpointGrowth(atThreshold, solid(1000)).reason).toBeNull();
  });

  it('suppresses a ratio against a zero baseline rather than reporting infinity', () => {
    // "The prior cohort had no views" is a real state, but it says nothing
    // about a rate of change.
    const result = computeCheckpointGrowth(solid(1000), solid(0));

    expect(result).toEqual({ growth: null, reason: 'no_prior_baseline' });
    expect(Number.isFinite(result.growth as number)).toBe(false);
  });

  it('reports zero growth when a cohort matches its predecessor', () => {
    expect(computeCheckpointGrowth(solid(1000), solid(1000)).growth).toBe(0);
  });

  it('honours a caller-supplied threshold', () => {
    const two = { medianViews: 1000, matureVideoCount: 2 };

    expect(computeCheckpointGrowth(two, two, 2).reason).toBeNull();
    expect(computeCheckpointGrowth(two, two, 3).reason).toBe(
      'insufficient_sample',
    );
  });
});

describe('computeCohortGrowth', () => {
  const cohort = (median: number, mature = MIN_MATURE_VIDEOS) => ({
    checkpoints: {
      30: { medianViews: median, matureVideoCount: mature },
      90: { medianViews: median * 2, matureVideoCount: mature },
    },
  });

  it('compares each cohort against its immediate predecessor', () => {
    const growth = computeCohortGrowth(
      [cohort(1000), cohort(1500), cohort(3000)],
      [30, 90],
    );

    expect(growth[0]![30]!.reason).toBe('no_prior_cohort');
    expect(growth[1]![30]!.growth).toBe(0.5);
    expect(growth[2]![30]!.growth).toBe(1);
  });

  it('evaluates each checkpoint independently', () => {
    // A cohort can have enough mature videos at 30 days and not at 90 —
    // that is the normal case for a recent cohort, and the 30-day figure
    // must survive it.
    const cohorts = [
      {
        checkpoints: {
          30: { medianViews: 1000, matureVideoCount: 8 },
          90: { medianViews: 2000, matureVideoCount: 8 },
        },
      },
      {
        checkpoints: {
          30: { medianViews: 1500, matureVideoCount: 8 },
          90: { medianViews: 3000, matureVideoCount: 1 },
        },
      },
    ];

    const growth = computeCohortGrowth(cohorts, [30, 90]);

    expect(growth[1]![30]!.growth).toBe(0.5);
    expect(growth[1]![90]!.reason).toBe('insufficient_sample');
  });

  it('returns an entry for every requested checkpoint, even unknown ones', () => {
    const growth = computeCohortGrowth([cohort(1000), cohort(1500)], [30, 180]);

    // 180 is absent from the data, so it must read as suppressed rather
    // than be missing from the map and crash a renderer.
    expect(growth[1]![180]).toEqual({
      growth: null,
      reason: 'no_prior_cohort',
    });
  });

  it('returns an empty list for no cohorts', () => {
    expect(computeCohortGrowth([], [30])).toEqual([]);
  });
});
