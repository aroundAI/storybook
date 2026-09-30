import { describe, expect, it } from 'vitest';

import {
  dailyReachLookup,
  generateRawExportCSV,
  videoAgeInDays,
} from '../src/lib/raw-export-generator';
import type { RawExportRow } from '../src/lib/raw-export-generator';

const row: RawExportRow = {
  date: '2026-06-14',
  videoId: 'publish-1',
  title: 'How volcanoes form',
  platform: 'youtube',
  contentType: 'full',
  language: 'en',
  publishedAt: '2026-05-01',
  videoAgeDays: 44,
  views: 1200,
  likes: 80,
  comments: 12,
  shares: 5,
  saves: 0,
  watchTimeSeconds: 36000,
  subscribersGained: 7,
  revenueCents: 1234,
  impressions: 40000,
  ctr: 0.0325,
  avgViewDurationSeconds: 185.4,
  topTrafficSource: 'RELATED_VIDEO',
  tags: 'topic:volcanoes|format:explainer',
  channelName: 'StoryBook',
  viewsAt30: 900,
  // 44 days old: @90d and beyond have not elapsed yet.
  viewsAt90: null,
  viewsAt180: null,
  viewsAt365: null,
};

describe('generateRawExportCSV', () => {
  it('emits a header plus one line per row', () => {
    const csv = generateRawExportCSV([row, { ...row, date: '2026-06-15' }]);
    const lines = csv.split('\n');

    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain('Date,Video ID,Title');
    expect(lines[1]).toContain('2026-06-14');
    expect(lines[2]).toContain('2026-06-15');
  });

  it('formats revenue as dollars and CTR at four decimals', () => {
    const csv = generateRawExportCSV([row]);

    expect(csv).toContain('12.34');
    expect(csv).toContain('0.0325');
  });

  it('quotes values containing commas', () => {
    const csv = generateRawExportCSV([
      { ...row, title: 'Volcanoes, explained' },
    ]);

    expect(csv).toContain('"Volcanoes, explained"');
  });

  it('leaves reach columns blank when there are no impressions', () => {
    const csv = generateRawExportCSV([{ ...row, impressions: 0, ctr: 0 }]);
    const cells = csv.split('\n')[1]!.split(',');

    // Impressions and CTR columns are empty rather than misleading zeros
    expect(cells).toContain('');
  });

  it('emits only a header for no rows', () => {
    expect(generateRawExportCSV([]).split('\n')).toHaveLength(1);
  });
});

describe('videoAgeInDays', () => {
  it('counts whole days between publish and metric date', () => {
    expect(videoAgeInDays('2026-05-01', '2026-06-14')).toBe(44);
  });

  it('floors at zero for metric dates before publication', () => {
    expect(videoAgeInDays('2026-06-14', '2026-05-01')).toBe(0);
  });

  it('returns zero for unparseable dates', () => {
    expect(videoAgeInDays('not-a-date', '2026-06-14')).toBe(0);
  });

  it('carries the channel and views-at-age columns', () => {
    const csv = generateRawExportCSV([row]);
    const [header, line] = csv.split('\n');

    expect(header).toContain('Channel');
    expect(header).toContain('Views @30d');
    expect(line).toContain('StoryBook');
    expect(line).toContain('900');
  });

  it('leaves an unreached checkpoint blank rather than zero', () => {
    // A 44-day-old video has no @90d figure. Zero would be read as a
    // measurement — "this video earned nothing" — rather than as "not yet".
    const headers = generateRawExportCSV([row]).split('\n')[0]!.split(',');
    const cells = generateRawExportCSV([row]).split('\n')[1]!.split(',');

    expect(cells[headers.indexOf('Views @90d')]).toBe('');
    expect(cells[headers.indexOf('Views @30d')]).toBe('900');
  });

  it('emits zero for a reached checkpoint that genuinely earned nothing', () => {
    const flopped = { ...row, viewsAt30: 0 };
    const headers = generateRawExportCSV([flopped]).split('\n')[0]!.split(',');
    const cells = generateRawExportCSV([flopped]).split('\n')[1]!.split(',');

    expect(cells[headers.indexOf('Views @30d')]).toBe('0');
  });
});

// KB-111, KB-114. A figure the platform does not measure is blank, never 0,
// and the header says what a blank means — always, so monthly files keep
// the same header and still concatenate.
describe('generateRawExportCSV — not measured', () => {
  const tiktok: RawExportRow = {
    ...row,
    platform: 'tiktok',
    saves: null,
    watchTimeSeconds: null,
    subscribersGained: null,
    avgViewDurationSeconds: null,
  };

  const cellOf = (rows: RawExportRow[], column: string) => {
    const [header, line] = generateRawExportCSV(rows).split('\n');
    const index = header!.split(',').findIndex((h) => h.startsWith(column));
    return line!.split(',')[index];
  };

  it('leaves a figure the platform does not measure blank, not 0', () => {
    expect(cellOf([tiktok], 'Saves')).toBe('');
    expect(cellOf([tiktok], 'Watch Time (s)')).toBe('');
    expect(cellOf([tiktok], 'Subscribers Gained')).toBe('');
    expect(cellOf([tiktok], 'Avg View Duration (s)')).toBe('');
  });

  it('keeps a measured zero as 0', () => {
    const measuredZero = { ...row, saves: 0, subscribersGained: 0 };

    expect(cellOf([measuredZero], 'Saves')).toBe('0');
    expect(cellOf([measuredZero], 'Subscribers Gained')).toBe('0');
  });

  it('says what a blank means in the header, in every file alike', () => {
    const withBlank = generateRawExportCSV([tiktok]).split('\n')[0];
    const without = generateRawExportCSV([row]).split('\n')[0];

    expect(withBlank).toBe(without);
    expect(withBlank).toContain(
      'Watch Time (s) (blank = not measured by the platform)',
    );
  });
});

describe('dailyReachLookup', () => {
  const reachFor = dailyReachLookup([
    {
      videoId: 'v1',
      date: '2026-06-14',
      impressions: 1000,
      impressionsCtr: 0.5,
    },
    {
      videoId: 'v1',
      date: '2026-06-15',
      impressions: 400,
      impressionsCtr: 0.25,
    },
  ]);

  it("gives each daily row that day's impressions and CTR, not the period total", () => {
    const csv = generateRawExportCSV(
      ['2026-06-14', '2026-06-15'].map((date) => ({
        ...row,
        videoId: 'v1',
        date,
        ...reachFor('v1', date),
      })),
    );
    const [header, first, second] = csv.split('\n');
    const columns = header!.split(',');
    const cell = (line: string | undefined, name: string) =>
      line!.split(',')[columns.indexOf(name)];

    expect(cell(first, 'Impressions')).toBe('1000');
    expect(cell(first, 'CTR')).toBe('0.5000');
    expect(cell(second, 'Impressions')).toBe('400');
    expect(cell(second, 'CTR')).toBe('0.2500');
  });

  it('leaves a day the platform reported no reach for blank rather than repeating another day', () => {
    const csv = generateRawExportCSV([
      {
        ...row,
        videoId: 'v1',
        date: '2026-06-16',
        ...reachFor('v1', '2026-06-16'),
      },
    ]);
    const [header, line] = csv.split('\n');
    const columns = header!.split(',');

    expect(line!.split(',')[columns.indexOf('Impressions')]).toBe('');
    expect(line!.split(',')[columns.indexOf('CTR')]).toBe('');
  });
});
