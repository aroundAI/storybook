import { describe, expect, it } from 'vitest';

import {
  CONFIDENCE_DIRECTIONAL_MIN,
  CONFIDENCE_REPORTABLE_MIN,
  computeSpread,
  interpretSpread,
  pooledRpmCents,
  resolveConfidence,
} from '../src/lib/segment-stats';

describe('resolveConfidence', () => {
  it('reports a segment with enough mature videos', () => {
    expect(resolveConfidence(CONFIDENCE_REPORTABLE_MIN)).toBe('reportable');
    expect(resolveConfidence(40)).toBe('reportable');
  });

  it('calls a mid-sized segment directional', () => {
    expect(resolveConfidence(CONFIDENCE_DIRECTIONAL_MIN)).toBe('directional');
    expect(resolveConfidence(CONFIDENCE_REPORTABLE_MIN - 1)).toBe(
      'directional',
    );
  });

  it('calls a thin segment insufficient', () => {
    expect(resolveConfidence(CONFIDENCE_DIRECTIONAL_MIN - 1)).toBe(
      'insufficient',
    );
    expect(resolveConfidence(0)).toBe('insufficient');
  });

  it('treats a negative count as insufficient rather than throwing', () => {
    expect(resolveConfidence(-1)).toBe('insufficient');
  });
});

describe('pooledRpmCents', () => {
  it('pools revenue over views rather than averaging per-video rates', () => {
    // 5000 cents over 10,000 views is 500 cents per thousand.
    expect(pooledRpmCents(5000, 10_000)).toBe(500);
  });

  it('lets a high-view video dominate the pool, which is the point', () => {
    // A 100-view video earning 100c has an RPM of 1000, but pooled against
    // a 99,900-view video earning 900c the segment RPM stays near 10 — a
    // mean of per-video RPMs would report ~505 instead.
    expect(pooledRpmCents(1000, 100_000)).toBe(10);
  });

  it('is absent, not zero, when the segment has no views', () => {
    expect(pooledRpmCents(0, 0)).toBeNull();
    expect(pooledRpmCents(500, 0)).toBeNull();
  });

  it('reports zero revenue over real views as zero, which is a fact', () => {
    expect(pooledRpmCents(0, 10_000)).toBe(0);
  });

  it('is absent when views are negative, which cannot happen but must not divide', () => {
    expect(pooledRpmCents(100, -10)).toBeNull();
  });
});

describe('computeSpread', () => {
  it('reports the ratio of the top video to the median', () => {
    expect(computeSpread(4000, 1000)).toBe(4);
  });

  it('is null rather than Infinity when the median is zero', () => {
    // The same suppression discipline computeCohortGrowth applies to a
    // zero baseline: a ratio against zero is undefined, not infinite.
    expect(computeSpread(5000, 0)).toBeNull();
  });

  it('is null when the median is negative, which cannot happen but must not invert', () => {
    expect(computeSpread(5000, -10)).toBeNull();
  });
});

describe('interpretSpread', () => {
  it('calls a tight segment consistent', () => {
    expect(interpretSpread(1.9)).toBe('consistent');
  });

  it('calls a top-heavy segment carried by one video', () => {
    expect(interpretSpread(4.1)).toBe('carried_by_one');
  });

  it('leaves the band between the two thresholds mixed', () => {
    expect(interpretSpread(3)).toBe('mixed');
  });

  it('places both thresholds themselves in the mixed band', () => {
    // The spec's bands are "< 2.0 consistent" and "> 4.0 carried" — both
    // strict, so the boundaries belong to neither.
    expect(interpretSpread(2)).toBe('mixed');
    expect(interpretSpread(4)).toBe('mixed');
  });

  it('has nothing to say about a suppressed spread', () => {
    expect(interpretSpread(null)).toBeNull();
  });
});
