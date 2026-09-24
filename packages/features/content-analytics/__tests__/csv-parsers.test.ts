import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  findCtrOutOfRange,
  parseChannelBasicReport,
  parseReachReport,
  parseTrafficSourceReport,
} from '../src/server/reporting/csv-parsers';

describe('parseChannelBasicReport', () => {
  const csv = [
    'date,channel_id,video_id,live_or_on_demand,subscribed_status,country_code,views,comments,likes,dislikes,shares,watch_time_minutes,average_view_duration_seconds,engaged_views,subscribers_gained,subscribers_lost',
    '20260610,UC123,vidA,ON_DEMAND,SUBSCRIBED,US,100,3,10,1,2,50.5,30.3,80,2,0',
    '20260610,UC123,vidA,ON_DEMAND,UNSUBSCRIBED,US,300,5,20,2,4,120.0,24.0,200,1,1',
    '20260610,UC123,vidA,ON_DEMAND,UNSUBSCRIBED,GB,50,1,5,0,1,10.0,12.0,40,0,0',
    '20260611,UC123,vidA,ON_DEMAND,UNSUBSCRIBED,US,80,2,8,0,1,20.0,15.0,60,1,0',
    '20260610,UC123,vidB,ON_DEMAND,UNSUBSCRIBED,US,10,0,1,0,0,2.0,12.0,5,0,0',
  ].join('\n');

  it('aggregates extra dimensions into per-video per-day rows', () => {
    const rows = parseChannelBasicReport(csv);

    expect(rows).toHaveLength(3);

    const vidADay1 = rows.find(
      (r) => r.youtubeVideoId === 'vidA' && r.date === '2026-06-10',
    )!;

    expect(vidADay1.views).toBe(450);
    expect(vidADay1.likes).toBe(35);
    expect(vidADay1.comments).toBe(9);
    expect(vidADay1.shares).toBe(7);
    expect(vidADay1.engagedViews).toBe(320);
    // (50.5 + 120 + 10) minutes = 10830 seconds
    expect(vidADay1.watchTimeSeconds).toBe(10830);
    // Gross halves are kept separate: the column named "gained" must not
    // silently hold a net figure.
    expect(vidADay1.subscribersGained).toBe(3); // 2+1+0
    expect(vidADay1.subscribersLost).toBe(1); // 0+1+0
    expect(vidADay1.subscribersGained - vidADay1.subscribersLost).toBe(2);
  });

  it('normalizes YYYYMMDD dates', () => {
    const rows = parseChannelBasicReport(csv);
    expect(rows.every((r) => /^\d{4}-\d{2}-\d{2}$/.test(r.date))).toBe(true);
  });

  it('returns empty for a header-only report', () => {
    expect(parseChannelBasicReport('date,channel_id,video_id,views\n')).toEqual(
      [],
    );
  });

  it('returns empty for an empty file', () => {
    expect(parseChannelBasicReport('')).toEqual([]);
  });

  it('tolerates missing optional columns', () => {
    const minimal = [
      'date,channel_id,video_id,views',
      '20260610,UC123,vidA,42',
    ].join('\n');

    const rows = parseChannelBasicReport(minimal);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      youtubeVideoId: 'vidA',
      views: 42,
      likes: 0,
      watchTimeSeconds: 0,
      subscribersGained: 0,
      subscribersLost: 0,
    });
  });
});

describe('parseTrafficSourceReport', () => {
  const csv = [
    'date,channel_id,video_id,live_or_on_demand,subscribed_status,country_code,traffic_source_type,traffic_source_detail,views,watch_time_minutes',
    '20260610,UC123,vidA,ON_DEMAND,SUBSCRIBED,US,3,,50,20.0',
    '20260610,UC123,vidA,ON_DEMAND,UNSUBSCRIBED,US,3,,150,60.0',
    '20260610,UC123,vidA,ON_DEMAND,UNSUBSCRIBED,US,7,,200,90.0',
    '20260610,UC123,vidA,ON_DEMAND,UNSUBSCRIBED,US,99,,10,1.0',
  ].join('\n');

  it('aggregates per source and maps numeric codes to names', () => {
    const rows = parseTrafficSourceReport(csv);

    expect(rows).toHaveLength(3);

    const subscriber = rows.find((r) => r.source === 'SUBSCRIBER')!;
    expect(subscriber.views).toBe(200);
    expect(subscriber.watchTimeMinutes).toBe(80);

    const related = rows.find((r) => r.source === 'RELATED_VIDEO')!;
    expect(related.views).toBe(200);

    // Unknown codes are preserved, never dropped
    expect(rows.find((r) => r.source === 'TS_99')?.views).toBe(10);
  });
});

describe('parseReachReport', () => {
  const csv = [
    'date,channel_id,video_id,video_thumbnail_impressions,video_thumbnail_impressions_ctr',
    '20260610,UC123,vidA,1000,0.05',
    '20260610,UC123,vidA,3000,0.03',
    '20260611,UC123,vidA,500,0.06',
  ].join('\n');

  it('aggregates impressions and view-weights CTR', () => {
    const rows = parseReachReport(csv);

    expect(rows).toHaveLength(2);

    const day1 = rows.find((r) => r.date === '2026-06-10')!;
    expect(day1.impressions).toBe(4000);
    // (0.05*1000 + 0.03*3000) / 4000 = 0.035
    expect(day1.impressionsCtr).toBeCloseTo(0.035, 6);
  });

  it('returns empty when required columns are missing', () => {
    expect(parseReachReport('date,video_id,views\n20260610,vidA,5')).toEqual(
      [],
    );
  });
});

describe('traffic source code lookup', () => {
  it('does not resolve a code up the prototype chain', () => {
    // 'constructor' as a traffic_source_type would otherwise be stored as a
    // function body instead of TS_constructor.
    const csv = [
      'date,video_id,traffic_source_type,views,watch_time_minutes',
      '20260111,abc123,constructor,10,1',
    ].join('\n');

    const rows = parseTrafficSourceReport(csv);

    expect(rows).toHaveLength(1);
    expect(rows[0]!.source).toBe('TS_constructor');
  });
});

/**
 * Fixture files for every report shape the ingest downloads (FILM-1504).
 *
 * Headers are Google's documented column lists for each report type
 * (https://developers.google.com/youtube/reporting/v1/reports/channel_reports,
 * read 2026-09-23). Values are chosen so every expectation below can be
 * computed by hand, and so the three core-metric reports agree with each
 * other the way YouTube's do: views and watch time for a video/day are the
 * same whichever report's dimensions they were split across.
 *
 * Each type is also run header-only — YouTube's "no data that day" — and as
 * an empty file.
 */
const FIXTURES = join(import.meta.dirname, 'fixtures', 'youtube-reporting');

function fixture(name: string): string {
  return readFileSync(join(FIXTURES, `${name}.csv`), 'utf8');
}

function headerOnly(name: string): string {
  return `${fixture(name).split('\n')[0]}\n`;
}

describe('report fixtures', () => {
  describe('channel_basic_a3', () => {
    const rows = parseChannelBasicReport(fixture('channel_basic_a3'));
    const vidA = rows.find((r) => r.youtubeVideoId === 'vidA')!;
    const vidX = rows.find((r) => r.youtubeVideoId === 'vidX')!;

    it('collapses the subscribed/country dimensions to one row per video/day', () => {
      expect(rows).toHaveLength(2);
      expect(rows.every((r) => r.date === '2026-09-10')).toBe(true);
    });

    it('sums counts and converts watch minutes to seconds', () => {
      expect(vidA).toMatchObject({
        views: 150, // 100 + 50
        engagedViews: 135, // 90 + 45
        likes: 15,
        dislikes: 1,
        comments: 3,
        shares: 1,
        watchTimeSeconds: 900, // (10 + 5) min
        subscribersGained: 3,
        subscribersLost: 1,
      });
      expect(vidX).toMatchObject({
        views: 400, // 300 + 100
        engagedViews: 330,
        watchTimeSeconds: 1800, // (20.5 + 9.5) min
        subscribersGained: 3,
        subscribersLost: 1,
      });
    });

    // Report versions before 2025-06-24 have no engaged_views column
    // (docs/platform-capability-reference.md). Absent is "not reported",
    // and a 0 here would be stored as a measurement (KB-50).
    it('reads engaged views as null when the report has no such column', () => {
      const [header, ...body] = fixture('channel_basic_a3').trim().split('\n');
      const drop = header!.split(',').indexOf('engaged_views');
      const without = (line: string) =>
        line
          .split(',')
          .filter((_, i) => i !== drop)
          .join(',');
      const older = parseChannelBasicReport(
        [header!, ...body].map(without).join('\n'),
      );

      expect(older).toHaveLength(2);
      expect(older.every((r) => r.engagedViews === null)).toBe(true);
      expect(older.find((r) => r.youtubeVideoId === 'vidX')!.views).toBe(400);
    });

    it('view-weights the average duration and percentage', () => {
      // (4.1 × 300 + 5.7 × 100) / 400
      expect(vidX.avgViewDurationSeconds).toBeCloseTo(4.5, 9);
      // (30 × 300 + 35 × 100) / 400
      expect(vidX.avgViewPercentage).toBeCloseTo(31.25, 9);
      expect(vidA.avgViewDurationSeconds).toBeCloseTo(6, 9);
    });
  });

  describe('channel_combined_a3', () => {
    const rows = parseChannelBasicReport(fixture('channel_combined_a3'));

    it('collapses playback/traffic/device dimensions to the basic report’s totals', () => {
      const basic = parseChannelBasicReport(fixture('channel_basic_a3'));

      for (const id of ['vidA', 'vidX']) {
        const combined = rows.find((r) => r.youtubeVideoId === id)!;
        const core = basic.find((r) => r.youtubeVideoId === id)!;

        expect(combined.views).toBe(core.views);
        expect(combined.watchTimeSeconds).toBe(core.watchTimeSeconds);
        expect(combined.engagedViews).toBe(core.engagedViews);
      }
    });
  });

  describe('channel_traffic_source_a3', () => {
    const rows = parseTrafficSourceReport(fixture('channel_traffic_source_a3'));
    const by = (id: string, source: string) =>
      rows.find((r) => r.youtubeVideoId === id && r.source === source);

    it('aggregates to one row per video/day/source, with codes named', () => {
      expect(rows).toHaveLength(4);
      expect(by('vidA', 'SUBSCRIBER')).toMatchObject({
        views: 75, // 30 + 45
        watchTimeMinutes: 7.5, // 4 + 3.5
      });
      expect(by('vidA', 'RELATED_VIDEO')).toMatchObject({
        views: 75,
        watchTimeMinutes: 7.5,
      });
      expect(by('vidX', 'YT_SEARCH')).toMatchObject({
        views: 350,
        watchTimeMinutes: 25,
      });
      expect(by('vidX', 'TS_99')).toMatchObject({
        views: 50,
        watchTimeMinutes: 5,
      });
    });

    it('splits the same views the basic report counts, and no others', () => {
      const basic = parseChannelBasicReport(fixture('channel_basic_a3'));

      for (const id of ['vidA', 'vidX']) {
        const split = rows
          .filter((r) => r.youtubeVideoId === id)
          .reduce((sum, r) => sum + r.views, 0);

        expect(split).toBe(basic.find((r) => r.youtubeVideoId === id)!.views);
      }
    });
  });

  describe.each(['channel_reach_basic_a1', 'channel_reach_combined_a1'])(
    '%s',
    (name) => {
      const rows = parseReachReport(fixture(name));
      const vidA = rows.find((r) => r.youtubeVideoId === 'vidA')!;
      const vidX = rows.find((r) => r.youtubeVideoId === 'vidX')!;

      it('sums impressions and impression-weights CTR', () => {
        expect(rows).toHaveLength(2);
        expect(vidA.impressions).toBe(4000);
        // combined: (0.05 × 2000 + 0.03 × 2000) / 4000
        expect(vidA.impressionsCtr).toBeCloseTo(0.04, 9);
        expect(vidX.impressions).toBe(4000);
        // combined: (0.04 × 1000 + 0.06 × 3000) / 4000
        expect(vidX.impressionsCtr).toBeCloseTo(0.055, 9);
      });

      // Neither reach report has an engaged_views column. Reading one
      // anyway yields 0 for every row — a figure YouTube never reported,
      // stored as if it had been.
      it('does not produce an engaged-views figure the report does not carry', () => {
        expect(fixture(name).split('\n')[0]).not.toContain('engaged_views');

        for (const row of rows) {
          expect(row).not.toHaveProperty('engagedViews');
        }
      });
    },
  );

  describe('findCtrOutOfRange', () => {
    it('passes a report whose CTRs are ratios', () => {
      expect(
        findCtrOutOfRange(parseReachReport(fixture('channel_reach_basic_a1'))),
      ).toBeNull();
    });

    it('names the largest CTR when the file is in percent', () => {
      const percent = fixture('channel_reach_basic_a1')
        .replace(',0.04', ',4.0')
        .replace(',0.055', ',5.5');

      expect(findCtrOutOfRange(parseReachReport(percent))).toBeCloseTo(5.5, 9);
    });
  });

  describe.each([
    ['channel_basic_a3', parseChannelBasicReport],
    ['channel_combined_a3', parseChannelBasicReport],
    ['channel_traffic_source_a3', parseTrafficSourceReport],
    ['channel_reach_basic_a1', parseReachReport],
    ['channel_reach_combined_a1', parseReachReport],
  ] as const)('%s with no data', (name, parse) => {
    it('returns no rows for a header-only report', () => {
      expect(parse(headerOnly(name))).toEqual([]);
    });

    it('returns no rows for an empty file', () => {
      expect(parse('')).toEqual([]);
    });
  });
});
