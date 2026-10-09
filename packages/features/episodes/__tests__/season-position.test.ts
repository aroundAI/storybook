import { describe, expect, it } from 'vitest';

import { episodeLabel, seasonPositions } from '../src/lib/season-position';

describe('seasonPositions', () => {
  it('counts within each season by episode number, Unsorted as its own group', () => {
    const positions = seasonPositions([
      { id: 'b2', seasonId: 'B', number: 9 },
      { id: 'a1', seasonId: 'A', number: 1 },
      { id: 'u1', seasonId: null, number: 4 },
      { id: 'b1', seasonId: 'B', number: 3 },
      { id: 'a2', seasonId: 'A', number: 2 },
      { id: 'u2', seasonId: null, number: 8 },
    ]);

    expect(Object.fromEntries(positions)).toEqual({
      a1: 1,
      a2: 2,
      b1: 1,
      b2: 2,
      u1: 1,
      u2: 2,
    });
  });

  it('gives a moved episode its new place without renumbering anything', () => {
    const before = [
      { id: 'x', seasonId: 'A', number: 5 },
      { id: 'y', seasonId: 'B', number: 2 },
    ];
    const after = [{ ...before[0]!, seasonId: 'B' }, before[1]!];

    expect(seasonPositions(after).get('x')).toBe(2);
    expect(after.map((e) => e.number)).toEqual([5, 2]);
  });
});

describe('episodeLabel', () => {
  it('reads S·E in a season and the production number in Unsorted', () => {
    expect(episodeLabel({ seasonNumber: 2, position: 3, number: 11 })).toBe(
      'S2 · E3',
    );
    expect(episodeLabel({ seasonNumber: null, position: 1, number: 11 })).toBe(
      '#11',
    );
  });
});
