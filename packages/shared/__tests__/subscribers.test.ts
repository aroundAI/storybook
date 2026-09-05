import { describe, expect, it } from 'vitest';

import { youtubeRoundingStep } from '../src/subscribers';

describe('youtubeRoundingStep', () => {
  it('is exact below 1,000', () => {
    expect(youtubeRoundingStep(0)).toBe(0);
    expect(youtubeRoundingStep(847)).toBe(0);
    expect(youtubeRoundingStep(999)).toBe(0);
  });

  it('steps by decade above it, at three significant figures', () => {
    // The 1,000-99,999 range is the most common channel size and the one an
    // earlier draft of the spec left to the reader to rederive.
    expect(youtubeRoundingStep(1_000)).toBe(10);
    expect(youtubeRoundingStep(9_999)).toBe(10);
    expect(youtubeRoundingStep(10_000)).toBe(100);
    expect(youtubeRoundingStep(99_999)).toBe(100);
    expect(youtubeRoundingStep(100_000)).toBe(1_000);
    expect(youtubeRoundingStep(1_230_000)).toBe(10_000);
    expect(youtubeRoundingStep(12_300_000)).toBe(100_000);
  });
});
