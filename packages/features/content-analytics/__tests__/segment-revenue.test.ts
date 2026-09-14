import { describe, expect, it } from 'vitest';

import {
  checkpointWindow,
  createSegmentRevenueFold,
} from '../src/lib/segment-revenue';

/** v1 published 2026-01-01, so its 30-day window is 01-01 … 01-30. */
const membership = () =>
  new Map([
    [
      'v1',
      {
        segments: ['topic:cooking', 'format:tutorial'],
        windowStart: '2026-01-01',
        windowEnd: '2026-01-31',
      },
    ],
    [
      'v2',
      {
        segments: ['topic:cooking'],
        windowStart: '2026-02-01',
        windowEnd: '2026-03-03',
      },
    ],
  ]);

const revenue = (
  publishId: string | null,
  cents: number,
  recordDate = '2026-01-15',
) => ({
  publish_id: publishId,
  record_date: recordDate,
  revenue_cents: cents,
});

describe('checkpointWindow', () => {
  it('opens on the publish day and closes N days later, exclusive', () => {
    expect(checkpointWindow('2026-01-01', 30)).toEqual({
      windowStart: '2026-01-01',
      windowEnd: '2026-01-31',
    });
  });

  it('accepts a ClickHouse datetime, not only a bare date', () => {
    expect(checkpointWindow('2026-01-01 13:45:00', 30).windowStart).toBe(
      '2026-01-01',
    );
  });

  it('parses as UTC so the window does not shift with the host zone', () => {
    // The suite runs on Pacific/Niue in @kit/clickhouse for exactly this
    // class of bug; the same discipline applies here.
    expect(checkpointWindow('2026-03-01', 1)).toEqual({
      windowStart: '2026-03-01',
      windowEnd: '2026-03-02',
    });
  });

  it('crosses a month and a leap day correctly', () => {
    expect(checkpointWindow('2028-02-20', 30).windowEnd).toBe('2028-03-21');
  });
});

describe('createSegmentRevenueFold', () => {
  it('adds a video revenue to every segment it belongs to', () => {
    const fold = createSegmentRevenueFold(membership());

    fold.add(revenue('v1', 1000));

    expect(fold.result().revenueBySegment.get('topic:cooking')).toBe(1000);
    expect(fold.result().revenueBySegment.get('format:tutorial')).toBe(1000);
  });

  it('accumulates across videos and rows', () => {
    const fold = createSegmentRevenueFold(membership());

    fold.add(revenue('v1', 1000));
    fold.add(revenue('v2', 250, '2026-02-10'));
    fold.add(revenue('v2', 250, '2026-02-11'));

    expect(fold.result().revenueBySegment.get('topic:cooking')).toBe(1500);
  });

  it('holds channel-level revenue aside rather than dropping it', () => {
    const fold = createSegmentRevenueFold(membership());

    fold.add(revenue(null, 5000));

    expect(fold.result().channelLevelCents).toBe(5000);
    expect(fold.result().revenueBySegment.size).toBe(0);
  });

  it('counts revenue for an unknown video as unattributed, not nothing', () => {
    // Another project under the same account, or a video excluded as
    // immature. Its views are in no denominator, so its revenue is in no
    // numerator — but it is still money and must still be reported.
    const fold = createSegmentRevenueFold(membership());

    fold.add(revenue('v-unknown', 9999));

    expect(fold.result().revenueBySegment.size).toBe(0);
    expect(fold.result().unattributedCents).toBe(9999);
  });

  it('excludes revenue earned after the video checkpoint window closed', () => {
    // v1's views are its first 30 days. Revenue on day 200 divided by
    // those views is the window mismatch this bounding exists to stop.
    const fold = createSegmentRevenueFold(membership());

    fold.add(revenue('v1', 7777, '2026-07-20'));

    expect(fold.result().revenueBySegment.size).toBe(0);
    expect(fold.result().unattributedCents).toBe(7777);
  });

  it('excludes revenue earned before the video was published', () => {
    const fold = createSegmentRevenueFold(membership());

    fold.add(revenue('v1', 300, '2025-12-25'));

    expect(fold.result().unattributedCents).toBe(300);
  });

  it('treats the window as half-open, matching the < N day convention', () => {
    const fold = createSegmentRevenueFold(membership());

    fold.add(revenue('v1', 10, '2026-01-01')); // first day, in
    fold.add(revenue('v1', 20, '2026-01-30')); // day 29, in
    fold.add(revenue('v1', 40, '2026-01-31')); // day 30, out

    expect(fold.result().revenueBySegment.get('topic:cooking')).toBe(30);
    expect(fold.result().unattributedCents).toBe(40);
  });

  it('accounts for every cent it is given', () => {
    const fold = createSegmentRevenueFold(membership());

    fold.add(revenue('v1', 100)); // attributed
    fold.add(revenue(null, 200)); // channel-level
    fold.add(revenue('v-unknown', 400)); // unattributed
    fold.add(revenue('v1', 800, '2027-01-01')); // out of window

    const { revenueBySegment, channelLevelCents, unattributedCents } =
      fold.result();

    // topic:cooking and format:tutorial each hold the same 100 — one video
    // in two segments, not two videos — so the attributed total is 100.
    expect(revenueBySegment.get('topic:cooking')).toBe(100);
    expect(100 + channelLevelCents + unattributedCents).toBe(1500);
  });

  it('starts empty', () => {
    const fold = createSegmentRevenueFold(new Map());

    expect(fold.result()).toEqual({
      revenueBySegment: new Map(),
      channelLevelCents: 0,
      unattributedCents: 0,
    });
  });
});
