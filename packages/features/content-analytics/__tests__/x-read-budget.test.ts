import { describe, expect, it } from 'vitest';

import {
  X_LAST_READ_AGE_DAYS,
  X_MAX_POST_READS_PER_UTC_DAY,
  X_MAX_USD_PER_POST,
  X_MAX_USD_PER_UTC_DAY,
  X_NON_PUBLIC_WINDOW_DAYS,
  X_POST_READ_USD,
  decideXRead,
  planXReads,
  xAnalyticsEnabled,
} from '../src/lib/x-read-budget';

/**
 * FILM-1727: an X read costs money, so the rules that bound it are tested as
 * the spend ceiling they are, not as scheduling.
 */

const DAY = 86_400_000;
const NOW = new Date('2026-10-01T15:00:00Z');
const ago = (days: number, hours = 0) =>
  new Date(NOW.getTime() - days * DAY - hours * 3_600_000);

const base = {
  enabled: true,
  now: NOW,
  publishedAt: ago(2),
  lastReadAt: null,
  readsToday: 0,
};

describe('the cost is stated, and capped', () => {
  it('records the per-read price and the documented wall', () => {
    expect(X_POST_READ_USD).toBe(0.005);
    expect(X_NON_PUBLIC_WINDOW_DAYS).toBe(30);
  });

  it('caps a day at $0.50 and a post at $0.145 over its whole life', () => {
    expect(X_MAX_USD_PER_UTC_DAY).toBeCloseTo(0.5, 10);
    expect(X_MAX_USD_PER_POST).toBeCloseTo(0.145, 10);
  });
});

describe('X is dark until switched on', () => {
  it('reads nothing while X_ANALYTICS_ENABLED is anything but "true"', () => {
    for (const value of [undefined, '', 'false', '1', 'TRUE', 'yes']) {
      expect(xAnalyticsEnabled({ X_ANALYTICS_ENABLED: value })).toBe(false);
    }
    expect(xAnalyticsEnabled({ X_ANALYTICS_ENABLED: 'true' })).toBe(true);
    expect(decideXRead({ ...base, enabled: false })).toEqual({
      read: false,
      reason: 'disabled',
    });
  });
});

describe('never past the 30-day wall', () => {
  it('reads a post up to the end of day 28', () => {
    expect(
      decideXRead({ ...base, publishedAt: ago(X_LAST_READ_AGE_DAYS, 23) }),
    ).toEqual({ read: true });
  });

  it('refuses from day 29, a full day inside the wall', () => {
    for (const days of [29, 30, 31, 400]) {
      expect(decideXRead({ ...base, publishedAt: ago(days) })).toEqual({
        read: false,
        reason: 'outside_window',
      });
    }
  });

  it('refuses a publish dated in the future rather than trusting it', () => {
    expect(decideXRead({ ...base, publishedAt: ago(-2) })).toEqual({
      read: false,
      reason: 'outside_window',
    });
  });
});

describe('once per post per UTC day', () => {
  it('refuses a second read the same UTC day', () => {
    expect(
      decideXRead({ ...base, lastReadAt: new Date('2026-10-01T00:00:00Z') }),
    ).toEqual({ read: false, reason: 'read_today' });
  });

  it('reads again once the UTC day has turned', () => {
    expect(
      decideXRead({ ...base, lastReadAt: new Date('2026-09-30T23:59:59Z') }),
    ).toEqual({ read: true });
  });
});

describe('the daily ceiling holds across every account', () => {
  it('refuses once the day has spent its reads', () => {
    expect(
      decideXRead({ ...base, readsToday: X_MAX_POST_READS_PER_UTC_DAY }),
    ).toEqual({ read: false, reason: 'daily_budget_spent' });
    expect(
      decideXRead({ ...base, readsToday: X_MAX_POST_READS_PER_UTC_DAY - 1 }),
    ).toEqual({ read: true });
  });

  it('counts the reads granted earlier in the same run', () => {
    const candidates = Array.from({ length: 10 }, (_, i) => ({ id: i }));
    const plan = planXReads(candidates, {
      enabled: true,
      now: NOW,
      readsToday: X_MAX_POST_READS_PER_UTC_DAY - 3,
      publishedAt: () => ago(1),
      lastReadAt: () => null,
    });

    expect(plan.read.map((c) => c.id)).toEqual([0, 1, 2]);
    expect(plan.refused).toHaveLength(7);
    expect(new Set(plan.refused.map((r) => r.reason))).toEqual(
      new Set(['daily_budget_spent']),
    );
  });

  it('does not spend the ceiling on posts it refuses for another reason', () => {
    const plan = planXReads([{ days: 40 }, { days: 1 }], {
      enabled: true,
      now: NOW,
      readsToday: X_MAX_POST_READS_PER_UTC_DAY - 1,
      publishedAt: (c) => ago(c.days),
      lastReadAt: () => null,
    });

    expect(plan.read).toEqual([{ days: 1 }]);
    expect(plan.refused).toEqual([
      { candidate: { days: 40 }, reason: 'outside_window' },
    ]);
  });
});
