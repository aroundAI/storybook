import { describe, expect, it } from 'vitest';

import {
  describeRounding,
  shortfallOf,
} from '../src/lib/subscriber-disclosure';

describe('subscriber disclosure', () => {
  it('names the largest possible shortfall it is given', () => {
    expect(describeRounding(29_997)).toContain('up to 29,997 higher');
  });

  it('says nothing for an exact figure', () => {
    expect(describeRounding(0)).toBeNull();
  });

  // YouTube rounds down, so a band of `step` values sits at or above the
  // reported figure: the true count is at most step − 1 higher.
  it('turns a rounding step into its shortfall', () => {
    expect(shortfallOf(100)).toBe(99);
    expect(shortfallOf(0)).toBe(0);
    expect(shortfallOf(1)).toBe(0);
  });
});
