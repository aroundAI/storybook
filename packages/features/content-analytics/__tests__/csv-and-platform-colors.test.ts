import { describe, expect, it } from 'vitest';

import { generateCSV } from '../src/lib/csv-generator';
import { NOT_MEASURED_CSV_NOTE } from '../src/lib/export-coverage';
import { PLATFORM_COLORS } from '../src/lib/platform-colors';
import type { AnalyticsDataRow } from '../src/lib/report-types';

/**
 * FILM-809 (CSV format) and FILM-807 (platform colours). The CSV is what a
 * sponsor opens in a spreadsheet, so the header, the escaping and the blank
 * cell for a figure a platform never measured are pinned here.
 */

function row(over: Partial<AnalyticsDataRow> = {}): AnalyticsDataRow {
  return {
    snapshotDate: '2026-09-01',
    platform: 'youtube',
    contentTitle: 'Harbour at dusk',
    projectName: 'Harbour',
    views: 1200,
    likes: 48,
    comments: 5,
    shares: 3,
    watchTimeSeconds: 3600,
    subscribersGained: 7,
    revenueCents: 12345,
    retentionData: null,
    impressions: 5000,
    ctr: 0.0512,
    avgViewDurationSeconds: 42.34,
    ...over,
  };
}

describe('generateCSV', () => {
  it('writes the four base columns, then one column per chosen metric in order', () => {
    const [header, line] = generateCSV(
      [row()],
      ['views', 'likes', 'revenue'],
    ).split('\n');

    expect(header).toBe(
      'Date,Platform,Project,Content,Views (blank = not measured by the platform),Likes,Revenue (USD) (blank = not measured by the platform)',
    );
    expect(line).toBe(
      '2026-09-01,youtube,Harbour,Harbour at dusk,1200,48,123.45',
    );
  });

  it('leaves unmeasured earnings blank, never $0.00 (FILM-1726)', () => {
    const [, line] = generateCSV(
      [row({ revenueCents: null })],
      ['revenue'],
    ).split('\n');

    expect(line).toBe('2026-09-01,youtube,Harbour,Harbour at dusk,');
  });

  it('leaves a Facebook row’s views blank, never 0 (KB-153)', () => {
    const [, line] = generateCSV(
      [row({ platform: 'facebook', views: null })],
      ['views', 'likes'],
    ).split('\n');

    expect(line).toBe('2026-09-01,facebook,Harbour,Harbour at dusk,,48');
  });

  it('writes one line per row and no trailing newline', () => {
    const csv = generateCSV([row(), row({ platform: 'tiktok' })], ['views']);

    expect(csv.split('\n')).toHaveLength(3);
    expect(csv.endsWith('\n')).toBe(false);
  });

  it('is just the header when there is no data', () => {
    expect(generateCSV([], ['views'])).toBe(
      'Date,Platform,Project,Content,Views (blank = not measured by the platform)',
    );
  });

  it('quotes a value with a comma, doubles a quote, and quotes a newline', () => {
    const csv = generateCSV(
      [row({ contentTitle: 'Dusk, "slowly"\nagain' })],
      ['views'],
    );

    expect(csv).toContain('"Dusk, ""slowly""\nagain"');
  });

  it('quotes a value whose only special character is a quote', () => {
    const csv = generateCSV([row({ contentTitle: 'The "gate"' })], ['views']);

    expect(csv).toContain('"The ""gate"""');
  });

  it('formats revenue in dollars, CTR as a percentage and duration to one decimal', () => {
    const line = generateCSV(
      [row()],
      ['revenue', 'ctr', 'avgViewDuration'],
    ).split('\n')[1]!;

    expect(line.endsWith(',123.45,5.12%,42.3')).toBe(true);
  });

  it('leaves a figure the platform never measured blank, not 0', () => {
    const csv = generateCSV(
      [
        row({
          platform: 'tiktok',
          watchTimeSeconds: null,
          subscribersGained: null,
          avgViewDurationSeconds: null,
          ctr: 0,
        }),
      ],
      ['watchTime', 'subscribers', 'avgViewDuration', 'ctr'],
    );
    const [header, line] = csv.split('\n');

    expect(line!.endsWith(',,,,')).toBe(true);
    expect(header).toContain(NOT_MEASURED_CSV_NOTE);
  });

  it('keeps a measured zero as 0', () => {
    const line = generateCSV(
      [row({ watchTimeSeconds: 0 })],
      ['watchTime'],
    ).split('\n')[1]!;

    expect(line.endsWith(',0')).toBe(true);
  });

  it('writes retention data as JSON, escaped as one cell', () => {
    const line = generateCSV(
      [row({ retentionData: { '0': 1, '50': 0.4 } })],
      ['retention'],
    ).split('\n')[1]!;

    expect(line).toContain('"{""0"":1,""50"":0.4}"');
  });
});

describe('PLATFORM_COLORS', () => {
  it('gives each platform its own brand colour', () => {
    expect(PLATFORM_COLORS).toMatchObject({
      youtube: '#FF0000',
      tiktok: '#000000',
      instagram: '#E4405F',
      facebook: '#1877F2',
    });
  });

  it('has an aggregate colour distinct from every platform', () => {
    const { aggregate, ...platforms } = PLATFORM_COLORS;

    expect(aggregate).toMatch(/^#[0-9A-F]{6}$/i);
    expect(Object.values(platforms)).not.toContain(aggregate);
  });

  it('uses a distinct colour per platform, so two series never blend', () => {
    const colours = Object.values(PLATFORM_COLORS);

    expect(new Set(colours).size).toBe(colours.length);
  });
});
