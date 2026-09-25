import { describe, expect, it } from 'vitest';

import { generateCSV, generateSummaryCSV } from '../src/lib/csv-generator';
import { coverageLabel, sumMeasured } from '../src/lib/export-coverage';
import { calculateReportSummary } from '../src/lib/report-summary';
import type { AnalyticsDataRow } from '../src/lib/report-types';

/**
 * KB-111, KB-114, decision #33 (A). A figure a platform does not measure is
 * null in a report row: blank in the CSV, "—" in the PDF, and left out of
 * totals, which say how many videos they cover.
 */
const youtube: AnalyticsDataRow = {
  snapshotDate: '2026-09-24',
  platform: 'youtube',
  contentTitle: 'Volcanoes',
  projectName: 'Science',
  views: 400,
  likes: 20,
  comments: 3,
  shares: 1,
  watchTimeSeconds: 18000,
  subscribersGained: 5,
  revenueCents: 0,
  retentionData: null,
  impressions: 4000,
  ctr: 0.05,
  avgViewDurationSeconds: 45,
};

const tiktok: AnalyticsDataRow = {
  ...youtube,
  platform: 'tiktok',
  contentTitle: 'Volcanoes (short)',
  views: 1000,
  watchTimeSeconds: null,
  subscribersGained: null,
  impressions: 0,
  ctr: 0,
  avgViewDurationSeconds: null,
};

describe('calculateReportSummary', () => {
  it('totals a figure over the videos that measure it, and says how many', () => {
    const summary = calculateReportSummary([youtube, tiktok]);

    expect(summary.totalWatchTimeSeconds).toBe(18000);
    expect(summary.totalSubscribers).toBe(5);
    expect(summary.coverage.watchTime).toEqual({ measured: 1, total: 2 });
    // View-weighted over the YouTube video alone: TikTok's 1,000 views
    // weighted against a 0 would have read 12.9s.
    expect(summary.avgViewDurationSeconds).toBe(45);
    expect(summary.ctr).toBe(0.05);
    expect(summary.totalViews).toBe(1400);
  });

  it('is null, not 0, when no video measures the figure', () => {
    const summary = calculateReportSummary([tiktok]);

    expect(summary.totalWatchTimeSeconds).toBeNull();
    expect(summary.totalSubscribers).toBeNull();
    expect(summary.avgViewDurationSeconds).toBeNull();
    expect(summary.ctr).toBeNull();
  });
});

describe('generateCSV', () => {
  it('leaves a figure the platform does not measure blank, with a header note', () => {
    const [header, , tiktokLine] = generateCSV(
      [youtube, tiktok],
      ['watchTime', 'subscribers', 'avgViewDuration'],
    ).split('\n');

    expect(header).toBe(
      'Date,Platform,Project,Content,' +
        'Watch Time (seconds) (blank = not measured by the platform),' +
        'Subscribers Gained (blank = not measured by the platform),' +
        'Avg View Duration (s) (blank = not measured by the platform)',
    );
    expect(tiktokLine!.endsWith(',,,')).toBe(true);
  });
});

describe('generateSummaryCSV', () => {
  const range = {
    start: new Date('2026-08-26T00:00:00Z'),
    end: new Date('2026-09-24T00:00:00Z'),
  };

  it('labels a partial total with its coverage', () => {
    const csv = generateSummaryCSV(
      [youtube, tiktok],
      ['watchTime', 'subscribers'],
      range,
    );

    expect(csv).toContain('Metric,Total,Formatted,Coverage');
    expect(csv).toContain(
      'Watch Time (seconds),18000,5h 0m,from 1 of 2 videos',
    );
    expect(csv).toContain('Subscribers,5,5,from 1 of 2 videos');
  });

  it('says not measured, not 0, when no video measures it', () => {
    const csv = generateSummaryCSV([tiktok], ['watchTime'], range);

    expect(csv).toContain(
      'Watch Time (seconds),,,not measured by the platform',
    );
  });
});

describe('export-coverage', () => {
  it('sums only measured values', () => {
    expect(sumMeasured([3, null, 4])).toEqual({
      value: 7,
      coverage: { measured: 2, total: 3 },
    });
    expect(sumMeasured([null])).toEqual({
      value: null,
      coverage: { measured: 0, total: 1 },
    });
  });

  it('labels partial coverage only', () => {
    expect(coverageLabel({ measured: 1, total: 2 })).toBe('from 1 of 2 videos');
    expect(coverageLabel({ measured: 2, total: 2 })).toBe('');
  });
});
