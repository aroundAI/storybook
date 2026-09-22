import { describe, expect, it } from 'vitest';

import { resolveAssetDuration } from '../src/lib/asset-duration';
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

const known = (seconds: number) => ({ known: true as const, seconds });

describe('retentionAtSeconds', () => {
  it('interpolates linearly between surrounding points', () => {
    // 6s of a 60s video = ratio 0.1 → exactly the 0.9 sample
    expect(retentionAtSeconds(curve, 6, known(60))).toEqual({
      ok: true,
      retention: expect.closeTo(0.9, 6),
    });

    // 9s = ratio 0.15, halfway between 0.9 and 0.6
    expect(retentionAtSeconds(curve, 9, known(60))).toEqual({
      ok: true,
      retention: expect.closeTo(0.75, 6),
    });
  });

  it('returns the first sample at time zero', () => {
    expect(retentionAtSeconds(curve, 0, known(60))).toEqual({
      ok: true,
      retention: 1,
    });
  });

  it('handles a 3-second checkpoint on a short hook', () => {
    // 3s of a 10s video = ratio 0.3, between 0.6 (0.2) and 0.5 (0.5)
    expect(retentionAtSeconds(curve, 3, known(10))).toEqual({
      ok: true,
      retention: expect.closeTo(0.5667, 3),
    });
  });

  // FILM-1710 §7, the decisive pair. One curve, one checkpoint, two
  // durations: the clip's own 45 seconds, and the 22-minute episode it was
  // cut from — which is what `video_dim.duration_seconds` used to hold.
  describe('the same curve against the clip and against its episode', () => {
    it('reads well below 1.0 at 3s of a 45-second Short', () => {
      // 3 / 45 = 0.0667 through: between (0, 1.0) and (0.1, 0.9)
      //   1.0 − (0.0667 / 0.1) × 0.1 = 0.9333
      const result = retentionAtSeconds(curve, 3, known(45));

      expect(result).toEqual({
        ok: true,
        retention: expect.closeTo(0.9333, 4),
      });
    });

    it('reads ≈ 1.0 when the episode duration stands in for the clip', () => {
      // 3 / 1320 = 0.0023 through: the viewer has barely started, so every
      // Short "holds" its whole audience. 1.0 − 0.0227 × 0.1 = 0.9977.
      const result = retentionAtSeconds(curve, 3, known(1320));

      expect(result).toEqual({
        ok: true,
        retention: expect.closeTo(0.9977, 4),
      });
    });
  });

  it('names the reason when the duration is unknown, rather than a number', () => {
    expect(
      retentionAtSeconds(curve, 3, {
        known: false,
        reason: 'duration_unknown',
      }),
    ).toEqual({ ok: false, reason: 'duration_unknown' });
  });

  it('treats a zero duration as unknown, not as a video of no length', () => {
    expect(retentionAtSeconds(curve, 3, resolveAssetDuration(0))).toEqual({
      ok: false,
      reason: 'duration_unknown',
    });
  });

  it('refuses a checkpoint past the end of the video', () => {
    expect(retentionAtSeconds(curve, 61, known(60))).toEqual({
      ok: false,
      reason: 'past_end_of_video',
    });
  });

  it('refuses an empty curve', () => {
    expect(retentionAtSeconds([], 3, known(60))).toEqual({
      ok: false,
      reason: 'no_curve',
    });
  });

  it('tolerates unsorted input', () => {
    const shuffled = [...curve].reverse();
    expect(retentionAtSeconds(shuffled, 9, known(60))).toEqual({
      ok: true,
      retention: expect.closeTo(0.75, 6),
    });
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
    const cliff = detectRetentionCliff(curve, { duration: known(60) });

    // 0.9 → 0.6 between ratios 0.1 and 0.2 is the steepest early drop
    expect(cliff).not.toBeNull();
    expect(cliff!.position).toBeCloseTo(0.1, 6);
    expect(cliff!.drop).toBeCloseTo(0.3, 6);
    expect(cliff!.seconds).toBeCloseTo(6, 6);
  });

  it('keeps the position and drops the timestamp when the duration is unknown', () => {
    const cliff = detectRetentionCliff(curve, {
      duration: { known: false, reason: 'duration_unknown' },
    });

    expect(cliff).not.toBeNull();
    expect(cliff!.position).toBeCloseTo(0.1, 6);
    expect(cliff).not.toHaveProperty('seconds');
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
