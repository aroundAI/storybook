import { describe, expect, it } from 'vitest';

import {
  describeRounding,
  roundingErrorOf,
} from '../src/lib/subscriber-disclosure';

describe('subscriber disclosure', () => {
  it('names the largest possible error it is given', () => {
    expect(describeRounding(29_997)).toContain('off by up to 29,997');
  });

  // The seed sits at the band floor, but a later anchor can clamp a level to
  // the band's top or leave it anywhere inside: the error runs both ways.
  it('says the error can go either way, not only up', () => {
    const text = describeRounding(99);

    expect(text).toContain('either way');
    expect(text).not.toContain('higher');
  });

  it('says nothing for an exact figure', () => {
    expect(describeRounding(0)).toBeNull();
  });

  it('turns a rounding step into its error bound', () => {
    expect(roundingErrorOf(100)).toBe(99);
    expect(roundingErrorOf(0)).toBe(0);
    expect(roundingErrorOf(1)).toBe(0);
  });
});
