import { describe, expect, it } from 'vitest';

import type { TrafficSourceRow } from '../src/lib/traffic-groups';
import {
  TRAFFIC_SOURCE_GROUPS,
  groupForSource,
  groupTrafficRows,
  sourcesInGroup,
} from '../src/lib/traffic-groups';

function row(
  bucket: string,
  source: string,
  views: number,
  watchTimeMinutes = 0,
): TrafficSourceRow {
  return { bucket, source, views, watchTimeMinutes };
}

describe('groupForSource', () => {
  it('maps the browse+suggested set exactly as the shipped trend does', () => {
    // The shipped Browse+Suggested set. If this changes, the trend the tab
    // derives moves a number that is already on screen and the 60%
    // milestone shifts with it.
    expect(sourcesInGroup('browse_suggested').sort()).toEqual([
      'NOTIFICATION',
      'RELATED_VIDEO',
      'SUBSCRIBER',
    ]);
  });

  it('keeps CHANNEL_PAGE out of browse+suggested', () => {
    // Locked decision: folding it in would silently move the 60% milestone.
    expect(groupForSource('CHANNEL_PAGE')).toBe('channel_page');
  });

  it('puts own-video surfaces in other, not browse+suggested', () => {
    expect(groupForSource('END_SCREEN')).toBe('other');
    expect(groupForSource('ANNOTATION')).toBe('other');
  });

  it('does not treat a hashtag page as search', () => {
    expect(groupForSource('HASHTAG_PAGE')).toBe('other');
    expect(groupForSource('YT_SEARCH')).toBe('search');
  });

  it('counts advertising rather than excluding it', () => {
    expect(groupForSource('ADVERTISING')).toBe('other');
  });

  it('groups every Shorts-only surface into the Shorts feed', () => {
    expect(groupForSource('SHORTS')).toBe('shorts_feed');
    expect(groupForSource('SOUND_PAGE')).toBe('shorts_feed');
    expect(groupForSource('VIDEO_REMIXES')).toBe('shorts_feed');
  });

  it('does not resolve a source up the prototype chain', () => {
    // A bare index returns Object.prototype.constructor here — truthy, so
    // `??` never fires and the row lands under a key outside
    // TRAFFIC_SOURCE_GROUPS, removing its views from every group and from
    // the bucket total at once.
    for (const source of [
      'constructor',
      'toString',
      'valueOf',
      'hasOwnProperty',
      '__proto__',
    ]) {
      expect(groupForSource(source)).toBe('other');
      expect(TRAFFIC_SOURCE_GROUPS).toContain(groupForSource(source));
    }
  });

  it('keeps a prototype-named source inside the bucket total', () => {
    const result = groupTrafficRows([
      row('2026-01-05', 'YT_SEARCH', 90),
      row('2026-01-05', 'constructor', 10),
    ]);

    expect(result[0]!.totalViews).toBe(100);
    expect(result[0]!.groups.find((g) => g.group === 'other')!.views).toBe(10);
    expect(result[0]!.groups.reduce((sum, g) => sum + g.share, 0)).toBeCloseTo(
      1,
      10,
    );
  });

  it('falls back to other for a code the parser did not recognise', () => {
    // csv-parsers stores TS_<code> for unknown codes, so these are real.
    expect(groupForSource('TS_99')).toBe('other');
    expect(groupForSource('')).toBe('other');
  });
});

describe('groupTrafficRows', () => {
  it('returns every group in every bucket, zero where absent', () => {
    const result = groupTrafficRows([row('2026-01-05', 'YT_SEARCH', 10)]);

    expect(result).toHaveLength(1);
    expect(result[0]!.groups.map((g) => g.group)).toEqual([
      ...TRAFFIC_SOURCE_GROUPS,
    ]);

    const browse = result[0]!.groups.find(
      (g) => g.group === 'browse_suggested',
    );
    expect(browse).toEqual({
      group: 'browse_suggested',
      views: 0,
      watchTimeMinutes: 0,
      share: 0,
    });
  });

  it('sums several sources into one group', () => {
    const result = groupTrafficRows([
      row('2026-01-05', 'RELATED_VIDEO', 60, 6),
      row('2026-01-05', 'SUBSCRIBER', 30, 3),
      row('2026-01-05', 'NOTIFICATION', 10, 1),
    ]);

    const browse = result[0]!.groups.find(
      (g) => g.group === 'browse_suggested',
    )!;

    expect(browse.views).toBe(100);
    expect(browse.watchTimeMinutes).toBe(10);
    expect(browse.share).toBe(1);
  });

  it('has group shares summing to 1 whenever the bucket has views', () => {
    const result = groupTrafficRows([
      row('2026-01-05', 'RELATED_VIDEO', 55),
      row('2026-01-05', 'YT_SEARCH', 20),
      row('2026-01-05', 'CHANNEL_PAGE', 15),
      row('2026-01-05', 'TS_77', 10),
    ]);

    const total = result[0]!.groups.reduce((sum, g) => sum + g.share, 0);

    expect(total).toBeCloseTo(1, 10);
    expect(result[0]!.totalViews).toBe(100);
  });

  it('counts an unknown source in the total rather than dropping it', () => {
    const result = groupTrafficRows([
      row('2026-01-05', 'YT_SEARCH', 90),
      row('2026-01-05', 'TS_123', 10),
    ]);

    expect(result[0]!.totalViews).toBe(100);
    expect(result[0]!.groups.find((g) => g.group === 'other')!.views).toBe(10);
  });

  it('gives every group a zero share in a bucket with no views', () => {
    const result = groupTrafficRows([row('2026-01-05', 'YT_SEARCH', 0)]);

    expect(result[0]!.totalViews).toBe(0);
    expect(result[0]!.groups.every((g) => g.share === 0)).toBe(true);
  });

  it('keeps buckets separate and ordered', () => {
    const result = groupTrafficRows([
      row('2026-02-02', 'YT_SEARCH', 5),
      row('2026-01-05', 'YT_SEARCH', 10),
    ]);

    expect(result.map((b) => b.bucket)).toEqual(['2026-01-05', '2026-02-02']);
    expect(result.map((b) => b.totalViews)).toEqual([10, 5]);
  });

  it('renders group order deterministically across calls', () => {
    const a = groupTrafficRows([row('2026-01-05', 'YT_SEARCH', 1)]);
    const b = groupTrafficRows([
      row('2026-01-05', 'CHANNEL_PAGE', 1),
      row('2026-01-05', 'YT_SEARCH', 1),
    ]);

    expect(a[0]!.groups.map((g) => g.group)).toEqual(
      b[0]!.groups.map((g) => g.group),
    );
  });

  it('returns nothing for no rows', () => {
    expect(groupTrafficRows([])).toEqual([]);
  });

  // The Deep Dive tab derives the Browse+Suggested trend from a breakdown
  // response rather than issuing a second, byte-identical query. That fold
  // must reproduce the shipped Browse+Suggested figures, or the trend card
  // and the stacked card disagree.
  it('carries enough to reproduce the browse+suggested trend', () => {
    const rows = [
      row('2026-01-05', 'RELATED_VIDEO', 400),
      row('2026-01-05', 'SUBSCRIBER', 150),
      row('2026-01-05', 'NOTIFICATION', 100),
      row('2026-01-05', 'YT_SEARCH', 250),
      row('2026-01-05', 'CHANNEL_PAGE', 100),
    ];

    const [bucket] = groupTrafficRows(rows);
    const browse =
      bucket!.groups.find((g) => g.group === 'browse_suggested')?.views ?? 0;

    expect(bucket!.totalViews).toBe(1000);
    expect(browse).toBe(650);
    expect(browse / bucket!.totalViews).toBeCloseTo(0.65, 10);
  });
});
