import { describe, expect, it } from 'vitest';

import {
  genomeViewsDenominator,
  recordCohortViewsDenominator,
} from '../src/lib/genome-measures';
import { denominatorSentence } from '../src/lib/measures';

/**
 * FILM-1732, closing FILM-1722: the genome's stage rates (#548) carry the
 * record of what they divided by, built from the series
 * `genomeViewsDenominator` chose over the cohort's own days.
 */
const base = {
  platform: 'youtube' as const,
  formatFamily: 'long_horizontal' as const,
  measure: 'share_rate' as const,
  checkpointDays: 30,
  asOf: '2026-10-02 00:00:00',
};

function recordFor(
  publishedAt: string[],
  overrides: Partial<typeof base> = {},
) {
  const input = { ...base, ...overrides, publishedAt };
  const chosen = genomeViewsDenominator(input);

  if (!chosen.ok) throw new Error('refused');

  return recordCohortViewsDenominator({ ...input, denominator: chosen });
}

describe('recordCohortViewsDenominator', () => {
  it('records views over the cohort’s days on one definition', () => {
    const record = recordFor(['2026-01-01 00:00:00', '2026-03-01 00:00:00']);

    expect(record).toMatchObject({
      column: 'views',
      // The last video's 30 days end on 30 Mar.
      window: { from: '2026-01-01', to: '2026-03-30' },
      crosses: [],
    });
    expect(record!.platforms).toHaveLength(1);
    expect(record!.platforms[0]).toMatchObject({
      platform: 'youtube',
      inDenominator: true,
    });
  });

  it('records engaged views, and the change they bridge, across 2026-08-27', () => {
    const record = recordFor(['2026-06-01 00:00:00', '2026-09-01 00:00:00']);

    expect(record).toMatchObject({
      column: 'engaged_views',
      bridged: { changedOn: '2026-08-27' },
      window: { from: '2026-06-01', to: '2026-09-30' },
      crosses: [],
    });
    expect(denominatorSentence(record!)).toMatch(
      /^Divided by engaged views, counted from 1 Jun 2026 to 30 Sep 2026\./,
    );
  });

  it('starts the record where the cohort was narrowed', () => {
    const record = recordFor(['2025-01-10 00:00:00', '2026-09-01 00:00:00']);

    expect(record).toMatchObject({
      column: 'engaged_views',
      // From where engaged views begin, the date the cohort starts at.
      window: { from: '2025-04-24', to: '2026-09-30' },
    });
  });

  it('names the crossing when a views cohort counts both sides', () => {
    // Engaged views are YouTube's alone: a TikTok cohort has no change, so
    // force a views read across YouTube's to see the crossing recorded.
    const record = recordCohortViewsDenominator({
      ...base,
      publishedAt: ['2026-08-20 00:00:00'],
      denominator: { column: 'views', publishedFrom: null },
    });

    expect(record!.crosses.map((change) => change.date)).toEqual([
      '2026-08-27',
    ]);
  });

  it('records nothing for a measure that does not divide by views', () => {
    expect(
      recordFor(['2026-06-01 00:00:00'], {
        measure: 'impressions_ctr' as never,
      }),
    ).toBeNull();
  });

  it('records nothing for an empty cohort', () => {
    expect(recordFor([])).toBeNull();
  });
});
