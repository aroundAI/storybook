import { describe, expect, it } from 'vitest';

import {
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
    'date,channel_id,video_id,video_thumbnail_impressions,video_thumbnail_impressions_ctr,engaged_views',
    '20260610,UC123,vidA,1000,0.05,40',
    '20260610,UC123,vidA,3000,0.03,90',
    '20260611,UC123,vidA,500,0.06,20',
  ].join('\n');

  it('aggregates impressions and view-weights CTR', () => {
    const rows = parseReachReport(csv);

    expect(rows).toHaveLength(2);

    const day1 = rows.find((r) => r.date === '2026-06-10')!;
    expect(day1.impressions).toBe(4000);
    // (0.05*1000 + 0.03*3000) / 4000 = 0.035
    expect(day1.impressionsCtr).toBeCloseTo(0.035, 6);
    expect(day1.engagedViews).toBe(130);
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
