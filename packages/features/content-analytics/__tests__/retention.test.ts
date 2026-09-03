import { describe, expect, it } from 'vitest';

import {
  detectRetentionCliff,
  retentionAtSeconds,
  retentionFull,
} from '../src/lib/retention';

const curve = [
  { elapsedRatio: 0, audienceWatchRatio: 1 },
  { elapsedRatio: 0.1, audienceWatchRatio: 0.9 },
  { elapsedRatio: 0.2, audienceWatchRatio: 0.6 },
  { elapsedRatio: 0.5, audienceWatchRatio: 0.5 },
  { elapsedRatio: 1, audienceWatchRatio: 0.3 },
];

describe('retentionAtSeconds', () => {
  it('interpolates linearly between surrounding points', () => {
    // 6s of a 60s video = ratio 0.1 → exactly the 0.9 sample
    expect(retentionAtSeconds(curve, 6, 60)).toBeCloseTo(0.9, 6);

    // 9s = ratio 0.15, halfway between 0.9 and 0.6
    expect(retentionAtSeconds(curve, 9, 60)).toBeCloseTo(0.75, 6);
  });

  it('returns the first sample at time zero', () => {
    expect(retentionAtSeconds(curve, 0, 60)).toBe(1);
  });

  it('handles a 3-second checkpoint on a short hook', () => {
    // 3s of a 10s video = ratio 0.3, between 0.6 (0.2) and 0.5 (0.5)
    expect(retentionAtSeconds(curve, 3, 10)).toBeCloseTo(0.5667, 3);
  });

  it('returns null when duration is unknown', () => {
    expect(retentionAtSeconds(curve, 3, 0)).toBeNull();
  });

  it('returns null past the end of the video', () => {
    expect(retentionAtSeconds(curve, 61, 60)).toBeNull();
  });

  it('returns null for an empty curve', () => {
    expect(retentionAtSeconds([], 3, 60)).toBeNull();
  });

  it('tolerates unsorted input', () => {
    const shuffled = [...curve].reverse();
    expect(retentionAtSeconds(shuffled, 9, 60)).toBeCloseTo(0.75, 6);
  });
});

describe('retentionFull', () => {
  it('returns the retention at the end of the curve', () => {
    expect(retentionFull(curve)).toBe(0.3);
  });

  it('returns null for an empty curve', () => {
    expect(retentionFull([])).toBeNull();
  });
});

describe('detectRetentionCliff', () => {
  it('finds the sharpest early drop', () => {
    const cliff = detectRetentionCliff(curve, { durationSeconds: 60 });

    // 0.9 → 0.6 between ratios 0.1 and 0.2 is the steepest early drop
    expect(cliff).not.toBeNull();
    expect(cliff!.position).toBeCloseTo(0.1, 6);
    expect(cliff!.drop).toBeCloseTo(0.3, 6);
    expect(cliff!.seconds).toBeCloseTo(6, 6);
  });

  it('ignores gradual decay', () => {
    const smooth = [
      { elapsedRatio: 0, audienceWatchRatio: 1 },
      { elapsedRatio: 0.1, audienceWatchRatio: 0.96 },
      { elapsedRatio: 0.2, audienceWatchRatio: 0.92 },
      { elapsedRatio: 1, audienceWatchRatio: 0.5 },
    ];

    expect(detectRetentionCliff(smooth)).toBeNull();
  });

  it('ignores late drops outside the early window', () => {
    const lateDrop = [
      { elapsedRatio: 0, audienceWatchRatio: 1 },
      { elapsedRatio: 0.2, audienceWatchRatio: 0.95 },
      { elapsedRatio: 0.8, audienceWatchRatio: 0.3 },
    ];

    expect(detectRetentionCliff(lateDrop)).toBeNull();
  });

  it('respects a custom threshold', () => {
    const smooth = [
      { elapsedRatio: 0, audienceWatchRatio: 1 },
      { elapsedRatio: 0.1, audienceWatchRatio: 0.94 },
    ];

    expect(detectRetentionCliff(smooth)).toBeNull();
    expect(detectRetentionCliff(smooth, { minDrop: 0.05 })).not.toBeNull();
  });

  it('returns null for a curve with fewer than two points', () => {
    expect(
      detectRetentionCliff([{ elapsedRatio: 0, audienceWatchRatio: 1 }]),
    ).toBeNull();
  });
});
