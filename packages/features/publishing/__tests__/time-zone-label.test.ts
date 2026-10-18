import { describe, expect, it } from 'vitest';

import { timeZoneLabel } from '../src/lib/time-zone-label';

describe('timeZoneLabel', () => {
  const january = new Date('2026-01-15T12:00:00Z');
  const july = new Date('2026-07-15T12:00:00Z');

  it('names a zone by its offset or abbreviation, as the release panel does', () => {
    expect(timeZoneLabel('Asia/Kolkata', january)).toBe('GMT+5:30');
    expect(timeZoneLabel('Asia/Calcutta', january)).toBe('GMT+5:30');
    expect(timeZoneLabel('UTC', january)).toBe('UTC');
  });

  it('follows daylight saving on the day it is asked about', () => {
    expect(timeZoneLabel('America/New_York', january)).toBe('EST');
    expect(timeZoneLabel('America/New_York', july)).toBe('EDT');
  });

  it('falls back to the zone’s name when it cannot be formatted', () => {
    expect(timeZoneLabel('Not/AZone', january)).toBe('Not/AZone');
  });
});
