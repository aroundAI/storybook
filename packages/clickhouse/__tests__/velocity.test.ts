import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  ACCELERATING_AT,
  AGE_BUCKETS,
  DECELERATING_AT,
  STALLED_SHARE_OF_PEAK,
  VELOCITY_GRAIN,
  ageBucket,
  compareVelocity,
  dailyVelocities,
  growthState,
} from '../src/lib/velocity';

// FILM-1713: velocity at the grain the data has (daily), compared only
// within an age bucket; acceleration as a named state, with too few points
// its own state rather than "stable".

describe('grain and buckets', () => {
  it('states the grain: daily, because video_snapshots keeps one row a day', () => {
    expect(VELOCITY_GRAIN).toBe('day');
  });

  it.each([
    [0, 'day_0'],
    [1, 'day_1'],
    [2, 'days_2_3'],
    [3, 'days_2_3'],
    [4, 'days_4_7'],
    [7, 'days_4_7'],
    [8, 'days_8_14'],
    [14, 'days_8_14'],
    [15, 'days_15_30'],
    [30, 'days_15_30'],
    [31, 'days_31_plus'],
    [400, 'days_31_plus'],
  ] as const)('age %i days is %s', (age, bucket) => {
    expect(ageBucket(age)).toBe(bucket);
  });

  it('refuses a fractional or negative age: nothing finer than a day', () => {
    expect(() => ageBucket(1.5)).toThrow(RangeError);
    expect(() => ageBucket(-1)).toThrow(RangeError);
  });

  it('covers every age with its buckets, in order', () => {
    expect(AGE_BUCKETS.map((b) => b.id)).toEqual([
      'day_0',
      'day_1',
      'days_2_3',
      'days_4_7',
      'days_8_14',
      'days_15_30',
      'days_31_plus',
    ]);
  });
});

describe('dailyVelocities', () => {
  it('is the day-over-day change of a cumulative count, by day of age', () => {
    expect(
      dailyVelocities([
        { ageDays: 0, cumulative: 100 },
        { ageDays: 1, cumulative: 300 },
        { ageDays: 2, cumulative: 450 },
      ]),
    ).toEqual([
      { kind: 'value', ageDays: 1, bucket: 'day_1', perDay: 200 },
      { kind: 'value', ageDays: 2, bucket: 'days_2_3', perDay: 150 },
    ]);
  });

  it('names a missing day instead of spreading the change across it', () => {
    expect(
      dailyVelocities([
        { ageDays: 0, cumulative: 100 },
        { ageDays: 2, cumulative: 300 },
      ]),
    ).toEqual([{ kind: 'absent', ageDays: 2, reason: 'missing_day' }]);
  });

  it('names a cumulative count that went down (a platform recount)', () => {
    expect(
      dailyVelocities([
        { ageDays: 3, cumulative: 500 },
        { ageDays: 4, cumulative: 480 },
      ]),
    ).toEqual([{ kind: 'absent', ageDays: 4, reason: 'cumulative_decreased' }]);
  });
});

describe('compareVelocity', () => {
  it('compares two readings in the same age bucket', () => {
    expect(
      compareVelocity(
        { kind: 'value', ageDays: 2, bucket: 'days_2_3', perDay: 300 },
        { kind: 'value', ageDays: 3, bucket: 'days_2_3', perDay: 150 },
      ),
    ).toEqual({ kind: 'compared', ratio: 2 });
  });

  it('refuses readings from different age buckets', () => {
    expect(
      compareVelocity(
        { kind: 'value', ageDays: 1, bucket: 'day_1', perDay: 300 },
        { kind: 'value', ageDays: 10, bucket: 'days_8_14', perDay: 150 },
      ),
    ).toEqual({ kind: 'not_comparable', reason: 'different_age_buckets' });
  });

  it('refuses a zero baseline rather than returning Infinity', () => {
    expect(
      compareVelocity(
        { kind: 'value', ageDays: 2, bucket: 'days_2_3', perDay: 300 },
        { kind: 'value', ageDays: 2, bucket: 'days_2_3', perDay: 0 },
      ),
    ).toEqual({ kind: 'not_comparable', reason: 'zero_baseline' });
  });
});

describe('growthState', () => {
  it('reads the spec examples as specified', () => {
    expect(growthState([100, 120, 110])).toBe('decelerating');
    expect(growthState([100, 150, 240])).toBe('accelerating');
  });

  it('is not_enough_points with fewer than two velocities, never stable', () => {
    expect(growthState([])).toBe('not_enough_points');
    expect(growthState([100])).toBe('not_enough_points');
  });

  it('holds its boundaries', () => {
    expect(growthState([100, 100 * ACCELERATING_AT])).toBe('accelerating');
    expect(growthState([100, 100 * ACCELERATING_AT - 0.01])).toBe('stable');
    expect(growthState([100, 100 * DECELERATING_AT])).toBe('decelerating');
    expect(growthState([100, 100 * DECELERATING_AT + 0.01])).toBe('stable');
  });

  it('tells stalled from decelerating', () => {
    expect(growthState([1000, 800, 1000 * STALLED_SHARE_OF_PEAK])).toBe(
      'stalled',
    );
    expect(growthState([1000, 800, 1000 * STALLED_SHARE_OF_PEAK + 1])).toBe(
      'decelerating',
    );
    expect(growthState([0, 0])).toBe('stalled');
  });

  it('reads growth from nothing as accelerating', () => {
    expect(growthState([0, 50])).toBe('accelerating');
  });
});

describe('every threshold is a named, argued constant', () => {
  const source = readFileSync(
    path.resolve(__dirname, '../src/lib/velocity.ts'),
    'utf8',
  );

  it.each([
    'VELOCITY_GRAIN',
    'AGE_BUCKETS',
    'ACCELERATING_AT',
    'DECELERATING_AT',
    'STALLED_SHARE_OF_PEAK',
  ])('%s has a doc-comment', (name) => {
    expect(source).toMatch(new RegExp(`\\*/\\s*export const ${name}\\b`));
  });
});
