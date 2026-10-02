import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { calculateDateRange } from '../src/lib/report-date-range';
import { calculateReportSummary } from '../src/lib/report-summary';
import type { AnalyticsDataRow } from '../src/lib/report-types';

/**
 * FILM-809. An export covers a range the creator picks as a preset, and
 * prints a summary of the rows in it. These pin the two pure parts: which
 * days each preset means, and how the summary adds the rows up.
 * report-exports-not-measured.test.ts owns the other half of the summary:
 * a figure some rows do not measure.
 */

describe('calculateDateRange', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-15T10:30:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const days = (range: { start: Date; end: Date }) =>
    Math.round((range.end.getTime() - range.start.getTime()) / 86_400_000);

  it('counts the last 7 and 30 days back from now', () => {
    const week = calculateDateRange('last7days');
    const month = calculateDateRange('last30days');

    expect(week.end.toISOString()).toBe('2026-09-15T10:30:00.000Z');
    expect(days(week)).toBe(7);
    expect(month.end.toISOString()).toBe('2026-09-15T10:30:00.000Z');
    expect(days(month)).toBe(30);
  });

  it('takes last month whole: its first day to its last', () => {
    const range = calculateDateRange('lastMonth');

    expect(range.start.getMonth()).toBe(7);
    expect(range.start.getDate()).toBe(1);
    expect(range.end.getMonth()).toBe(7);
    expect(range.end.getDate()).toBe(31);
  });

  it('takes last month whole across a year boundary', () => {
    vi.setSystemTime(new Date('2027-01-10T12:00:00.000Z'));

    const range = calculateDateRange('lastMonth');

    expect([range.start.getFullYear(), range.start.getMonth()]).toEqual([
      2026, 11,
    ]);
    expect([
      range.end.getFullYear(),
      range.end.getMonth(),
      range.end.getDate(),
    ]).toEqual([2026, 11, 31]);
  });

  it('counts the last quarter as three months back from now', () => {
    const range = calculateDateRange('lastQuarter');

    expect(range.end.toISOString()).toBe('2026-09-15T10:30:00.000Z');
    expect(range.start.toISOString()).toBe('2026-06-15T10:30:00.000Z');
  });

  it('falls back to the last 30 days for a custom range that has none of its own', () => {
    const custom = calculateDateRange('custom');
    const month = calculateDateRange('last30days');

    expect(custom).toEqual(month);
  });
});

function row(over: Partial<AnalyticsDataRow> = {}): AnalyticsDataRow {
  return {
    snapshotDate: '2026-09-01',
    platform: 'youtube',
    contentTitle: 'Harbour',
    projectName: 'Coast',
    views: 0,
    likes: 0,
    comments: 0,
    shares: 0,
    watchTimeSeconds: 0,
    subscribersGained: 0,
    revenueCents: 0,
    retentionData: null,
    impressions: 0,
    ctr: 0,
    avgViewDurationSeconds: 0,
    ...over,
  };
}

describe('calculateReportSummary totals', () => {
  it('adds views, likes, comments, shares and revenue over every row', () => {
    const summary = calculateReportSummary([
      row({ views: 100, likes: 10, comments: 2, shares: 1, revenueCents: 250 }),
      row({ views: 300, likes: 30, comments: 6, shares: 3, revenueCents: 750 }),
    ]);

    expect(summary).toMatchObject({
      totalViews: 400,
      totalLikes: 40,
      totalComments: 8,
      totalShares: 4,
      totalRevenueCents: 1000,
    });
  });

  it('splits views by platform', () => {
    const summary = calculateReportSummary([
      row({ platform: 'youtube', views: 100 }),
      row({ platform: 'tiktok', views: 40 }),
      row({ platform: 'youtube', views: 60 }),
    ]);

    expect(summary.platformBreakdown).toEqual({ youtube: 160, tiktok: 40 });
  });

  it('counts a title once however many days it appears on', () => {
    const summary = calculateReportSummary([
      row({ contentTitle: 'Harbour', snapshotDate: '2026-09-01' }),
      row({ contentTitle: 'Harbour', snapshotDate: '2026-09-02' }),
      row({ contentTitle: 'Pier', snapshotDate: '2026-09-01' }),
    ]);

    expect(summary.contentCount).toBe(2);
  });

  it('weights click-through by impressions, not by the number of rows', () => {
    const summary = calculateReportSummary([
      row({ impressions: 1000, ctr: 0.1 }),
      row({ impressions: 3000, ctr: 0.05 }),
    ]);

    expect(summary.ctr).toBeCloseTo((100 + 150) / 4000, 10);
  });

  it('has no click-through when there were no impressions, not a 0', () => {
    expect(calculateReportSummary([row({ views: 5 })]).ctr).toBeNull();
  });

  it('totals earnings over the rows that measured them, and says how many', () => {
    // A connection without the monetary scope measured nothing (FILM-1726):
    // its row adds nothing, and is counted as unmeasured, never as $0.
    const summary = calculateReportSummary([
      row({ revenueCents: 500 }),
      row({ revenueCents: null }),
    ]);

    expect(summary.totalRevenueCents).toBe(500);
    expect(summary.coverage.revenue).toEqual({ measured: 1, total: 2 });
    expect(
      calculateReportSummary([row({ revenueCents: null })]).totalRevenueCents,
    ).toBeNull();
  });

  it('totals nothing for no rows', () => {
    expect(calculateReportSummary([])).toMatchObject({
      totalViews: 0,
      // No row measured earnings: not measured, never $0 (FILM-1726).
      totalRevenueCents: null,
      contentCount: 0,
      platformBreakdown: {},
      ctr: null,
    });
  });
});
