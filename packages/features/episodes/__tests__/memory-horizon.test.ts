import { describe, expect, it } from 'vitest';

import {
  effectiveMemoryHorizon,
  resolveMemoryHorizon,
  savedMemoryHorizonOverride,
} from '../src/lib/canon/memory-horizon';

describe('resolveMemoryHorizon (FILM-1110)', () => {
  it('prefers an explicit argument', () => {
    expect(
      resolveMemoryHorizon({ argument: 7, canonOverride: 3, contentType: 50 }),
    ).toEqual({ memoryHorizon: 7, source: 'argument' });
  });

  it('prefers the user override to the content type', () => {
    expect(
      resolveMemoryHorizon({ canonOverride: 15, contentType: 50 }),
    ).toEqual({ memoryHorizon: 15, source: 'canon-settings' });
  });

  it('uses the content type when nothing else is given', () => {
    expect(resolveMemoryHorizon({ contentType: 50 })).toEqual({
      memoryHorizon: 50,
      source: 'content-type',
    });
  });

  it('falls back to 10 when there is no content type horizon', () => {
    expect(resolveMemoryHorizon({})).toEqual({
      memoryHorizon: 10,
      source: 'default',
    });
  });

  it('clamps to 1-100 and ignores non-finite values', () => {
    expect(resolveMemoryHorizon({ argument: 0 }).memoryHorizon).toBe(1);
    expect(resolveMemoryHorizon({ argument: 10_000 }).memoryHorizon).toBe(100);
    expect(
      resolveMemoryHorizon({ argument: Number.NaN, contentType: 5 }),
    ).toEqual({ memoryHorizon: 5, source: 'content-type' });
  });
});

describe('savedMemoryHorizonOverride (FILM-1110)', () => {
  it.each([
    ['no canon settings', undefined, undefined],
    [
      'automatic',
      { memoryHorizon: null, memoryHorizonMode: 'automatic' },
      undefined,
    ],
    [
      'a stale number under automatic',
      { memoryHorizon: 30, memoryHorizonMode: 'automatic' },
      undefined,
    ],
    ['a chosen 15', { memoryHorizon: 15, memoryHorizonMode: 'custom' }, 15],
    ['a chosen 10', { memoryHorizon: 10, memoryHorizonMode: 'custom' }, 10],
    ['a legacy untouched 10', { memoryHorizon: 10 }, undefined],
    ['a legacy 15', { memoryHorizon: 15 }, 15],
    [
      'a value past the range',
      { memoryHorizon: 500, memoryHorizonMode: 'custom' },
      100,
    ],
  ])('%s', (_label, canon, expected) => {
    expect(savedMemoryHorizonOverride(canon)).toBe(expected);
  });
});

describe('effectiveMemoryHorizon (FILM-1110)', () => {
  it('is the content type horizon unless the user chose one', () => {
    expect(effectiveMemoryHorizon({ projectType: 'ad' })).toEqual({
      memoryHorizon: 1,
      source: 'content-type',
    });
    expect(
      effectiveMemoryHorizon({
        projectType: 'ad',
        canon: { memoryHorizon: 15, memoryHorizonMode: 'custom' },
      }),
    ).toEqual({ memoryHorizon: 15, source: 'canon-settings' });
    expect(effectiveMemoryHorizon(null)).toEqual({
      memoryHorizon: 50,
      source: 'content-type',
    });
  });
});
