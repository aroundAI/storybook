import { describe, expect, it } from 'vitest';

import { createRng } from '../src/rng';
import {
  ARCHETYPES,
  ROUND_SENTINELS,
  avoidSentinel,
  cumulativeAt,
  curve,
  dailySeries,
  reportedAt,
} from '../src/social/growth';
import { PLATFORMS, drawProfile } from '../src/social/profile';
import { type Metric, SocialState } from '../src/social/state';

/**
 * FILM-1802 criterion 9: cumulative totals never decrease, and daily series
 * sum to totals, at any SANDBOX_SPEED. Checked over many drawn profiles, not
 * one hand-picked object.
 */

const DAY = 86_400_000;
const HOUR = 3_600_000;
const SPEEDS = [1, 60, 1440, 86_400];
const METRICS: Metric[] = [
  'views',
  'likes',
  'comments',
  'shares',
  'saves',
  'follows',
];

describe('the curves', () => {
  it.each(ARCHETYPES)(
    '%s starts at 0, never falls, and never passes 1',
    (archetype) => {
      expect(curve(archetype, 0)).toBe(0);
      expect(curve(archetype, -3)).toBe(0);
      let previous = 0;
      for (let day = 0; day <= 2_000; day += 0.25) {
        const value = curve(archetype, day);
        expect(value).toBeGreaterThanOrEqual(previous);
        expect(value).toBeLessThanOrEqual(1);
        previous = value;
      }
    },
  );

  it('gives the archetypes different shapes', () => {
    const atWeek = ARCHETYPES.map((a) => curve(a, 7));
    expect(new Set(atWeek.map((v) => v.toFixed(3))).size).toBe(
      ARCHETYPES.length,
    );
    // A flop has had nearly all it will get within a week; a slow burn barely started.
    expect(curve('flop', 7)).toBeGreaterThan(0.99);
    expect(curve('slow-burn', 7)).toBeLessThan(0.05);
  });
});

describe.each(SPEEDS)('at SANDBOX_SPEED=%s', (speed) => {
  const published = Date.parse('2026-09-20T13:17:00Z');

  it('no total ever decreases, for 300 drawn profiles', () => {
    for (let seed = 0; seed < 300; seed++) {
      const rng = createRng(seed);
      const platform = rng.pick(PLATFORMS);
      const profile = drawProfile(rng, platform);
      const growth = {
        archetype: profile.archetype,
        lifetime: profile.lifetimeViews,
        publishedMs: published,
      };
      let previous = 0;
      for (
        let t = published - HOUR;
        t <= published + 9 * DAY;
        t += 37 * 60_000
      ) {
        const value = cumulativeAt(growth, t, speed);
        expect(Number.isInteger(value)).toBe(true);
        expect(value).toBeGreaterThanOrEqual(previous);
        previous = value;
      }
    }
  });

  it("every metric's dailies are never negative and sum to its total, with and without a reporting delay", () => {
    for (let seed = 0; seed < 60; seed++) {
      let now = published + 5 * HOUR;
      const social = new SocialState({ seed, speed, now: () => now });
      const platform = PLATFORMS[seed % PLATFORMS.length]!;
      const object = social.createObject(platform, null);

      for (const advance of [0, 3 * HOUR, 26 * HOUR, 4 * DAY]) {
        now = published + 5 * HOUR + advance;
        for (const delay of [0, 60 * HOUR]) {
          for (const metric of METRICS) {
            const rows = social.daily(
              object,
              metric,
              new Date(object.publishedMs - DAY).toISOString().slice(0, 10),
              new Date(now + 2 * DAY).toISOString().slice(0, 10),
              delay,
            );
            for (const row of rows) expect(row.value).toBeGreaterThanOrEqual(0);
            const total = rows.reduce((sum, row) => sum + row.value, 0);
            expect(total).toBe(social.cumulative(object, metric, now, delay));
          }
        }
      }
    }
  });

  it('a day after now holds nothing', () => {
    const now = published + 2 * DAY;
    const social = new SocialState({ seed: 7, speed, now: () => now });
    const object = social.createObject('youtube', null);
    const future = social.daily(object, 'views', '2026-09-25', '2026-09-30');
    expect(future.every((row) => row.value === 0)).toBe(true);
  });
});

describe('time', () => {
  const published = Date.parse('2026-09-20T00:00:00Z');
  const growth = {
    archetype: 'steady' as const,
    lifetime: 48_731,
    publishedMs: published,
  };

  it('SANDBOX_SPEED=0 freezes everything at zero', () => {
    expect(cumulativeAt(growth, published + 30 * DAY, 0)).toBe(0);
    expect(reportedAt(growth, published + 30 * DAY, 0)).toBe(0);
    const rows = dailySeries(
      (t) => cumulativeAt(growth, t, 0),
      '2026-09-19',
      '2026-10-20',
      published + 30 * DAY,
    );
    expect(rows.every((row) => row.value === 0)).toBe(true);
  });

  it('a faster speed means more growth by the same real time', () => {
    const at = published + 2 * HOUR;
    expect(cumulativeAt(growth, at, 86_400)).toBeGreaterThan(
      cumulativeAt(growth, at, 1440),
    );
  });

  it('a vendor delay is simulated time, so it shrinks as speed grows', () => {
    const delay = 60 * HOUR; // simulated
    const at = published + 10 * 60_000; // ten real minutes in
    // At 1440, sixty simulated hours is 2.5 real minutes: already past.
    expect(reportedAt(growth, at, 1440, delay)).toBeGreaterThan(0);
    // At 1, it is sixty real hours: nothing reported yet.
    expect(reportedAt(growth, at, 1, delay)).toBe(0);
  });
});

describe('round sentinels', () => {
  it('a shown figure is never a sentinel, and never decreases', () => {
    let previous = -1;
    for (let v = 0; v <= 10_000_100; v += v < 1_000_100 ? 1 : 97) {
      const shown = avoidSentinel(v);
      expect(ROUND_SENTINELS.has(shown)).toBe(false);
      if (shown < previous)
        throw new Error(`${v} shown as ${shown} after ${previous}`);
      previous = shown;
    }
    for (const sentinel of ROUND_SENTINELS) {
      expect(ROUND_SENTINELS.has(avoidSentinel(sentinel))).toBe(false);
    }
  });
});

describe('dailySeries on its own', () => {
  // SocialState.cumulative caps at what the vendor has processed, so through
  // it the cap below is invisible. A cumulative that keeps growing past now
  // is what shows that dailySeries stops at now by itself.
  it('stops at now: its rows sum to the figure at now, not past it', () => {
    const now = Date.parse('2026-09-10T12:00:00Z');
    const rows = dailySeries(
      (ms) => Math.floor(ms / 1000),
      '2026-09-09',
      '2026-09-12',
      now,
    );

    expect(rows.map((row) => row.date)).toEqual([
      '2026-09-09',
      '2026-09-10',
      '2026-09-11',
      '2026-09-12',
    ]);
    expect(rows.slice(2).map((row) => row.value)).toEqual([0, 0]);
    expect(rows.reduce((sum, row) => sum + row.value, 0)).toBe(
      Math.floor(now / 1000) -
        Math.floor(Date.parse('2026-09-09T00:00:00Z') / 1000),
    );
  });
});
