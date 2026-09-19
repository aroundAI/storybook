import { describe, expect, it } from 'vitest';

import { assertCallerToday } from '../src/lib/caller-date';

/**
 * FILM-1610 review 4, G6: the dates an experiment is started and ended on
 * come from the caller's device, so the server checks they could be today
 * somewhere.
 */
const NOW = new Date('2026-09-19T12:00:00Z');

describe('assertCallerToday', () => {
  it('accepts the UTC date and the day either side of it', () => {
    for (const date of ['2026-09-18', '2026-09-19', '2026-09-20']) {
      expect(() => assertCallerToday(date, NOW)).not.toThrow();
    }
  });

  it('accepts UTC+14 just before UTC midnight, which is already the next day', () => {
    expect(() =>
      assertCallerToday('2026-09-20', new Date('2026-09-19T23:59:00Z')),
    ).not.toThrow();
  });

  it('refuses two days either side', () => {
    expect(() => assertCallerToday('2026-09-17', NOW)).toThrow(
      "not today's date in any time zone",
    );
    expect(() => assertCallerToday('2026-09-21', NOW)).toThrow(
      "not today's date in any time zone",
    );
  });

  it('refuses a date years away', () => {
    expect(() => assertCallerToday('1999-01-01', NOW)).toThrow();
    expect(() => assertCallerToday('2099-01-01', NOW)).toThrow();
  });

  it('refuses a date that does not exist, which the pattern alone allows', () => {
    expect(() => assertCallerToday('2026-02-31', NOW)).toThrow(
      'not a calendar date',
    );
    expect(() => assertCallerToday('2026-13-01', NOW)).toThrow(
      'not a calendar date',
    );
  });
});
