import { describe, expect, it } from 'vitest';

import {
  MEASURE_INPUT_SUPPORT,
  PREFERRED_DENOMINATOR,
  attentionEfficiency,
  computeMeasure,
  displayedEngagementRatePercent,
  engagementRatio,
} from '../src/lib/measures';
import type { MeasureCounts } from '../src/lib/measures';

// FILM-1713. Every rate has one definition, returns a value stamped with the
// denominator and view definitions that produced it, or a named reason it
// cannot be computed. Never Infinity, NaN, or a zero standing in for "not
// reported".

const COUNTS: MeasureCounts = {
  views: 1000,
  engaged_views: 800,
  likes: 50,
  comments: 20,
  shares: 30,
  saves: 40,
  subscribers_gained: 5,
};

const AFTER = { from: '2026-08-28', to: '2026-09-20' } as const;
const ACROSS = { from: '2026-08-01', to: '2026-09-20' } as const;

describe('engagementRatio: the one definition (FILM-1713)', () => {
  it('is (likes + comments + shares) / views', () => {
    expect(engagementRatio(COUNTS, 1000)).toBe(0.1);
  });

  it('has no value over a zero denominator', () => {
    expect(engagementRatio(COUNTS, 0)).toBeNull();
  });

  it("keeps today's displayed percentage, 0 included, until FILM-1719", () => {
    expect(displayedEngagementRatePercent(COUNTS)).toBe(10);
    expect(displayedEngagementRatePercent({ ...COUNTS, views: 0 })).toBe(0);
  });
});

describe('computeMeasure: denominators (FILM-1713)', () => {
  it('stamps the views column and its definition after the YouTube change', () => {
    const m = computeMeasure('engagement_rate', {
      platform: 'youtube',
      ...AFTER,
      counts: COUNTS,
    });

    expect(m).toMatchObject({
      kind: 'value',
      value: 0.1,
      denominator: { column: 'views', role: 'preferred' },
    });
    expect(
      m.kind === 'value' &&
        m.denominator.definitions.map((d) => [d.id, d.effectiveFrom]),
    ).toEqual([['youtube.views.2026-08-27', '2026-08-27']]);
  });

  it('reads engaged_views across 2026-08-27, and says it bridged the change', () => {
    const m = computeMeasure('engagement_rate', {
      platform: 'youtube',
      ...ACROSS,
      counts: COUNTS,
    });

    expect(m).toMatchObject({
      kind: 'value',
      value: 100 / 800,
      denominator: {
        column: 'engaged_views',
        bridged: {
          reason: 'view_definition_changed',
          changedOn: '2026-08-27',
        },
      },
    });
  });

  it('refuses a range engaged views does not cover', () => {
    const m = computeMeasure('engagement_rate', {
      platform: 'youtube',
      from: '2025-01-01',
      to: '2025-12-01',
      counts: COUNTS,
    });

    expect(m).toMatchObject({
      kind: 'absent',
      reason: {
        reason: 'view_definition_changed',
        changedOn: '2025-03-31',
        continuousAlternative: { coversRange: false },
      },
    });
  });

  it('refuses when the chosen column was not reported', () => {
    expect(
      computeMeasure('engagement_rate', {
        platform: 'youtube',
        ...ACROSS,
        counts: { ...COUNTS, engaged_views: null },
      }),
    ).toMatchObject({
      kind: 'absent',
      reason: { reason: 'denominator_not_reported', column: 'engaged_views' },
    });
  });

  it('names a zero denominator, never Infinity or 0', () => {
    const m = computeMeasure('share_rate', {
      platform: 'tiktok',
      ...AFTER,
      counts: { ...COUNTS, views: 0 },
    });

    expect(m).toEqual({
      kind: 'absent',
      measure: 'share_rate',
      reason: { reason: 'zero_denominator' },
    });
  });

  it("uses views for Instagram, marked as the fallback for reach we don't store", () => {
    expect(PREFERRED_DENOMINATOR.instagram).toBe('reach');

    const m = computeMeasure('save_rate', {
      platform: 'instagram',
      ...AFTER,
      mediaSurface: 'REELS',
      counts: COUNTS,
    });

    expect(m).toMatchObject({
      kind: 'value',
      value: 0.04,
      denominator: {
        column: 'views',
        role: 'fallback',
        fallbackFor: { preferred: 'reach', because: 'not_ingested' },
      },
    });
  });
});

describe('computeMeasure: inputs a platform does not report (FILM-1713)', () => {
  it.each(['youtube', 'tiktok'] as const)(
    'save rate on %s is not reported, not 0%%',
    (platform) => {
      expect(
        computeMeasure('save_rate', { platform, ...AFTER, counts: COUNTS }),
      ).toEqual({
        kind: 'absent',
        measure: 'save_rate',
        reason: { reason: 'input_not_reported', input: 'saves', platform },
      });
    },
  );

  it('subscriber conversion on TikTok is not reported', () => {
    expect(
      computeMeasure('subscriber_conversion', {
        platform: 'tiktok',
        ...AFTER,
        counts: COUNTS,
      }),
    ).toMatchObject({
      kind: 'absent',
      reason: { reason: 'input_not_reported', input: 'subscribers_gained' },
    });
  });

  it('subscriber conversion on an Instagram Reel is not reported; on a feed post it is', () => {
    const reel = computeMeasure('subscriber_conversion', {
      platform: 'instagram',
      ...AFTER,
      mediaSurface: 'REELS',
      counts: COUNTS,
    });
    const feed = computeMeasure('subscriber_conversion', {
      platform: 'instagram',
      ...AFTER,
      mediaSurface: 'FEED',
      counts: COUNTS,
    });

    expect(reel).toMatchObject({
      kind: 'absent',
      reason: { reason: 'input_not_reported', input: 'subscribers_gained' },
    });
    expect(feed).toMatchObject({ kind: 'value', value: 0.005 });
  });

  it('an Instagram input whose surface is not known is not assumed reported', () => {
    expect(
      computeMeasure('subscriber_conversion', {
        platform: 'instagram',
        ...AFTER,
        counts: COUNTS,
      }),
    ).toMatchObject({
      kind: 'absent',
      reason: { reason: 'media_surface_unknown' },
    });
  });

  it('subscriber conversion on YouTube is a value', () => {
    expect(
      computeMeasure('subscriber_conversion', {
        platform: 'youtube',
        ...AFTER,
        counts: COUNTS,
      }),
    ).toMatchObject({ kind: 'value', value: 0.005 });
  });

  it('every platform has a support cell for every input a measure needs', () => {
    for (const platform of ['youtube', 'tiktok', 'instagram'] as const) {
      expect(MEASURE_INPUT_SUPPORT[platform].saves).toBeDefined();
      expect(MEASURE_INPUT_SUPPORT[platform].subscribers_gained).toBeDefined();
    }
  });
});

describe('attentionEfficiency (FILM-1713)', () => {
  it('is average view duration over asset duration', () => {
    expect(
      attentionEfficiency({
        avgViewDurationSeconds: 30,
        assetDurationSeconds: 60,
      }),
    ).toEqual({ kind: 'value', measure: 'attention_efficiency', value: 0.5 });
  });

  it.each([null, 0])('is duration_unknown when the duration is %s', (d) => {
    expect(
      attentionEfficiency({
        avgViewDurationSeconds: 30,
        assetDurationSeconds: d,
      }),
    ).toEqual({
      kind: 'absent',
      measure: 'attention_efficiency',
      reason: { reason: 'duration_unknown' },
    });
  });
});
