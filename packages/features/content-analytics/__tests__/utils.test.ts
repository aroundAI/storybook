import { describe, expect, it } from 'vitest';

import { formatDate, parseDuration } from '../src/lib/utils';

describe('formatDate', () => {
  it('should format Date to YYYY-MM-DD', () => {
    const date = new Date('2025-03-15T10:30:00Z');
    expect(formatDate(date)).toBe('2025-03-15');
  });

  it('should handle midnight dates', () => {
    const date = new Date('2025-01-01T00:00:00Z');
    expect(formatDate(date)).toBe('2025-01-01');
  });

  it('should handle end of day dates', () => {
    const date = new Date('2025-12-31T23:59:59Z');
    expect(formatDate(date)).toBe('2025-12-31');
  });

  it('should handle leap year dates', () => {
    const date = new Date('2024-02-29T12:00:00Z');
    expect(formatDate(date)).toBe('2024-02-29');
  });
});

describe('parseDuration', () => {
  it('should parse hours, minutes, and seconds', () => {
    expect(parseDuration('PT1H2M3S')).toBe(3723);
  });

  it('should parse hours only', () => {
    expect(parseDuration('PT2H')).toBe(7200);
  });

  it('should parse minutes only', () => {
    expect(parseDuration('PT30M')).toBe(1800);
  });

  it('should parse seconds only', () => {
    expect(parseDuration('PT45S')).toBe(45);
  });

  it('should parse hours and minutes', () => {
    expect(parseDuration('PT1H30M')).toBe(5400);
  });

  it('should parse minutes and seconds', () => {
    expect(parseDuration('PT5M30S')).toBe(330);
  });

  it('should return 0 for invalid format', () => {
    expect(parseDuration('invalid')).toBe(0);
    expect(parseDuration('')).toBe(0);
    expect(parseDuration('1H2M3S')).toBe(0); // Missing PT prefix
  });

  // FILM-1710: this used to be pinned at 0 ("Days not supported"). YouTube
  // reports a video longer than 24 hours with a day designator, so the old
  // reading silently dropped the days.
  it('should read the day designator', () => {
    expect(parseDuration('P1D')).toBe(86400);
    expect(parseDuration('P1DT2H')).toBe(93600);
  });

  it('should handle edge case with zero values', () => {
    expect(parseDuration('PT0H0M0S')).toBe(0);
    expect(parseDuration('PT0S')).toBe(0);
  });

  it('should handle double-digit values', () => {
    expect(parseDuration('PT10H59M59S')).toBe(39599);
  });

  it('should handle large values', () => {
    expect(parseDuration('PT24H')).toBe(86400); // 24 hours
    expect(parseDuration('PT100H')).toBe(360000);
  });
});
