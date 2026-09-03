import { describe, expect, it } from 'vitest';

import { formatCohort } from '../src/lib/cohort-label';

/**
 * These run in whatever zone the suite is given. The point is that the
 * answer must not depend on it: cohort keys are UTC dates, and reading them
 * through local-time getters slid every label a quarter west of UTC —
 * '2026-01-01' rendered as "Q4 2025". That ran in the browser, so it
 * reached users rather than only a developer's machine.
 *
 * Run under `TZ=America/Los_Angeles` to exercise the case that was broken.
 */
describe('formatCohort', () => {
  it('labels the first quarter of a year as Q1, not the previous Q4', () => {
    expect(formatCohort('2026-01-01')).toBe('Q1 2026');
  });

  it('keeps every quarter boundary on the right side of the year', () => {
    expect(formatCohort('2026-04-01')).toBe('Q2 2026');
    expect(formatCohort('2026-07-01')).toBe('Q3 2026');
    expect(formatCohort('2026-10-01')).toBe('Q4 2026');
    expect(formatCohort('2027-01-01')).toBe('Q1 2027');
  });

  it('labels month buckets by month', () => {
    // The action accepts bucket: 'month'; formatting those as quarters
    // renders Jan/Feb/Mar as three identical "Q1 2026" rows.
    expect(formatCohort('2026-01-01', 'month')).toBe('Jan 2026');
    expect(formatCohort('2026-02-01', 'month')).toBe('Feb 2026');
    expect(formatCohort('2026-12-01', 'month')).toBe('Dec 2026');
  });

  it('accepts a full timestamp, not just a bare date', () => {
    expect(formatCohort('2026-01-01 00:00:00')).toBe('Q1 2026');
  });

  it('returns an unrecognised value unchanged rather than rendering nonsense', () => {
    expect(formatCohort('not-a-date')).toBe('not-a-date');
    expect(formatCohort('2026-13-01')).toBe('2026-13-01');
  });
});
