import { describe, expect, it } from 'vitest';

import {
  ASSET_DURATION_PLATFORMS,
  normalizeAssetDurationSeconds,
  resolveAssetDuration,
} from '../src/lib/asset-duration';
import { parseDuration, parseIsoDurationSeconds } from '../src/lib/utils';

describe('normalizeAssetDurationSeconds', () => {
  it('keeps a positive number of seconds', () => {
    expect(normalizeAssetDurationSeconds(45)).toBe(45);
  });

  it('rounds to whole seconds, which is what the columns hold', () => {
    expect(normalizeAssetDurationSeconds(44.6)).toBe(45);
  });

  // The defect in one line: `?? 0` made "never measured" a measurement.
  it.each([
    ['zero', 0],
    ['a negative', -3],
    ['a value that rounds to zero', 0.4],
    ['null', null],
    ['undefined', undefined],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['a numeric string', '45'],
  ])('reads %s as no measurement', (_label, value) => {
    expect(normalizeAssetDurationSeconds(value)).toBeNull();
  });
});

describe('resolveAssetDuration', () => {
  it('is known, with its seconds, when there is a measurement', () => {
    expect(resolveAssetDuration(45)).toEqual({ known: true, seconds: 45 });
  });

  it('names the reason when there is none — no number to read by mistake', () => {
    const unknown = resolveAssetDuration(null);

    expect(unknown).toEqual({ known: false, reason: 'duration_unknown' });
    expect(unknown).not.toHaveProperty('seconds');
  });

  it('does not let a zero through as a known duration', () => {
    expect(resolveAssetDuration(0)).toEqual({
      known: false,
      reason: 'duration_unknown',
    });
  });
});

describe('ASSET_DURATION_PLATFORMS', () => {
  it('leaves Instagram out: Meta has no duration field to ask for', () => {
    expect([...ASSET_DURATION_PLATFORMS]).toEqual(['youtube', 'tiktok']);
  });
});

describe('parseIsoDurationSeconds', () => {
  it.each([
    ['PT45S', 45],
    ['PT15M33S', 933],
    ['PT1H2M3S', 3723],
    ['PT2H', 7200],
    // Past 24 hours YouTube switches to a day designator, which the older
    // `PT…`-only pattern read as the time part alone.
    ['P1DT2H', 93_600],
    ['P1D', 86_400],
  ])('reads %s as %i seconds', (iso, seconds) => {
    expect(parseIsoDurationSeconds(iso)).toBe(seconds);
  });

  it.each([
    // What YouTube sends for a live broadcast that has not finished.
    ['a zero-length P0D', 'P0D'],
    ['PT0S', 'PT0S'],
    ['an empty string', ''],
    ['something that is not a duration', 'forty-five seconds'],
    ['a duration with trailing junk', 'PT45Sx'],
  ])('reads %s as unknown, not as zero', (_label, iso) => {
    expect(parseIsoDurationSeconds(iso)).toBeNull();
  });

  it('is the one parser: parseDuration is the same reading with 0 for unknown', () => {
    expect(parseDuration('PT15M33S')).toBe(933);
    expect(parseDuration('P1DT2H')).toBe(93_600);
    expect(parseDuration('nonsense')).toBe(0);
  });
});
