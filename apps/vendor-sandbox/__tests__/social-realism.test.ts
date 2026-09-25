import { describe, expect, it } from 'vitest';

import { findPlaceholders } from '../src/corpus/placeholder';
import { createRng } from '../src/rng';
import * as names from '../src/social/names';
import { social } from '../src/social/names';
import { CENTRES, PLATFORMS, drawProfile } from '../src/social/profile';
import { SocialState } from '../src/social/state';

/**
 * FILM-1802 criteria 12 and 13: "Looks real, is fictional" (phase 18 README).
 * No generated name matches a placeholder pattern; no figure is a round
 * sentinel; each object's figures agree with each other. Over a large
 * sample of runs, not one draw.
 */

const RUNS = 400;
const DAY = 86_400_000;

describe('names', () => {
  it('no word in the social corpus is a placeholder', () => {
    const findings = Object.entries(social).flatMap(([pool, words]) =>
      // Every pool here is names or titles, so a trailing counter counts.
      findPlaceholders(
        Object.fromEntries(words.map((w, i) => [`${pool}${i}Name`, w])),
      ),
    );
    expect(findings).toEqual([]);
  });

  it(`no generated account or object reads like a fixture, over ${RUNS} runs`, () => {
    const found: string[] = [];

    for (let seed = 0; seed < RUNS; seed++) {
      const state = new SocialState({
        seed,
        now: () => Date.parse('2026-09-25T00:00:00Z'),
      });
      for (const platform of PLATFORMS) {
        const account = state.createAccount(platform);
        const object = state.createObject(platform, account.id);
        const adopted = state.object(platform, `${seed}${platform.length}7310`);
        const shown = {
          accountName: account.name,
          handleName: account.handle,
          bio: account.bio,
          title: object.title,
          caption: object.caption,
          adoptedTitle: adopted.title,
          adoptedCaption: adopted.caption,
          commentText: names.comment(state.rngFor(`comment:${seed}`)),
          organizationName: names.organizationName(state.rngFor(`org:${seed}`)),
        };
        for (const f of findPlaceholders(shown))
          found.push(
            `seed ${seed} ${platform}: ${f.path} = ${JSON.stringify(f.value)} (${f.rule})`,
          );
      }
    }

    expect(found.slice(0, 20)).toEqual([]);
  });

  it('handles look like handles: lowercase, no spaces, no trailing number', () => {
    const rng = createRng(3);
    for (let i = 0; i < 2_000; i++) {
      expect(names.handle(rng)).toMatch(/^[a-z]+(?:[._][a-z]+)?$/);
    }
  });
});

describe('figures', () => {
  const now = Date.parse('2026-09-25T12:00:00Z');

  /** Totals across many objects at several ages, the way a dashboard sees them. */
  function totals() {
    const values: number[] = [];
    for (let seed = 0; seed < RUNS; seed++) {
      let t = now;
      const state = new SocialState({ seed, now: () => t });
      for (const platform of PLATFORMS) {
        const object = state.createObject(platform, null);
        for (const age of [0.1, 1, 7, 30]) {
          t = now + (age * DAY) / state.speed; // `age` simulated days
          values.push(
            state.cumulative(object, 'views'),
            state.cumulative(object, 'likes'),
            state.cumulative(object, 'comments'),
          );
        }
        t = now;
      }
    }
    return values;
  }

  it('no figure is a round sentinel', () => {
    const values = totals().filter((v) => v >= 1_000);
    const sentinels = new Set([
      1_000, 10_000, 100_000, 1_000_000, 9_999, 99_999, 12_345, 123_456,
    ]);
    expect(values.filter((v) => sentinels.has(v))).toEqual([]);

    // Multiples of 1,000 at about the rate chance gives (1 in 1,000), not as a habit.
    const round = values.filter((v) => v % 1_000 === 0).length;
    expect(round / values.length).toBeLessThan(0.005);
  });

  it('the scale is long-tailed: most objects small, a few large', () => {
    for (const platform of PLATFORMS) {
      const lifetimes = Array.from(
        { length: 2_000 },
        (_, seed) =>
          drawProfile(createRng(seed * 7 + 1), platform).lifetimeViews,
      ).sort((a, b) => a - b);
      const median = lifetimes[1_000]!;
      const top = lifetimes[1_980]!; // 99th percentile
      expect(top / median).toBeGreaterThan(20);
      // And the median sits near the platform's stated centre (within 5x either way).
      expect(median).toBeGreaterThan(CENTRES[platform].medianViews / 5);
      expect(median).toBeLessThan(CENTRES[platform].medianViews * 5);
    }
  });

  it("each object's figures agree with each other", () => {
    for (let seed = 0; seed < RUNS; seed++) {
      let t = now;
      const state = new SocialState({ seed, now: () => t });
      for (const platform of PLATFORMS) {
        const object = state.createObject(platform, null);
        t = now + 3 * DAY;
        const views = state.cumulative(object, 'views');
        for (const metric of [
          'likes',
          'comments',
          'shares',
          'saves',
          'follows',
        ] as const) {
          expect(state.cumulative(object, metric)).toBeLessThanOrEqual(views);
        }
        expect(state.cumulative(object, 'comments')).toBeLessThanOrEqual(
          state.cumulative(object, 'likes') + 1 + views * 0.05,
        );
        // Watch time never exceeds everyone watching the whole thing.
        expect(state.watchSeconds(object)).toBeLessThanOrEqual(
          views * object.durationSeconds,
        );
        // Platforms without saves report none.
        if (CENTRES[platform].ratios.saves === 0) {
          expect(state.cumulative(object, 'saves')).toBe(0);
        }
        t = now;
      }
    }
  });
});
