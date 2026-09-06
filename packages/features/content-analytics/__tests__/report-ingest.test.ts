import { describe, expect, it } from 'vitest';

import type { ChannelDaily } from '@kit/clickhouse/server';

import { accumulateChannelDaily } from '../src/server/reporting/report-ingest';

const CONNECTION = '11111111-1111-1111-1111-111111111111';

function collect(map: Map<string, ChannelDaily>) {
  return Array.from(map.values());
}

describe('accumulateChannelDaily', () => {
  it('seeds a date with every field zeroed, including subscribers', () => {
    const map = new Map<string, ChannelDaily>();

    accumulateChannelDaily(map, CONNECTION, '2026-03-01', { views: 10 });

    expect(collect(map)).toEqual([
      {
        connection_id: CONNECTION,
        metric_date: '2026-03-01',
        views: 10,
        watch_time_seconds: 0,
        impressions: 0,
        engaged_views: 0,
        subscribers_gained: 0,
        subscribers_lost: 0,
      },
    ]);
  });

  // FILM-1618: the regression this file exists for. Migration 006 added
  // both columns so subscriber movement on videos that never matched a
  // publish would stop being discarded; the accumulator could not carry
  // them, so it was discarded anyway — silently, because the fields are
  // optional on the row type and the columns are DEFAULT 0.
  it('sums subscriber movement across rows on the same date', () => {
    const map = new Map<string, ChannelDaily>();

    accumulateChannelDaily(map, CONNECTION, '2026-03-01', {
      views: 100,
      watch_time_seconds: 600,
      engaged_views: 40,
      subscribers_gained: 7,
      subscribers_lost: 2,
    });

    accumulateChannelDaily(map, CONNECTION, '2026-03-01', {
      views: 50,
      watch_time_seconds: 300,
      engaged_views: 20,
      subscribers_gained: 3,
      subscribers_lost: 5,
    });

    expect(collect(map)).toEqual([
      {
        connection_id: CONNECTION,
        metric_date: '2026-03-01',
        views: 150,
        watch_time_seconds: 900,
        impressions: 0,
        engaged_views: 60,
        subscribers_gained: 10,
        subscribers_lost: 7,
      },
    ]);
  });

  it('keeps dates separate', () => {
    const map = new Map<string, ChannelDaily>();

    accumulateChannelDaily(map, CONNECTION, '2026-03-01', {
      subscribers_gained: 4,
    });
    accumulateChannelDaily(map, CONNECTION, '2026-03-02', {
      subscribers_gained: 6,
    });

    expect(
      collect(map).map((r) => [r.metric_date, r.subscribers_gained]),
    ).toEqual([
      ['2026-03-01', 4],
      ['2026-03-02', 6],
    ]);
  });

  // The reach branch calls the same accumulator and its reports carry no
  // subscriber columns. Passing nothing must leave both at zero rather
  // than producing undefined or NaN, or the channel_daily leg of
  // querySubscriberDeltas would sum garbage instead of nothing.
  it('contributes zero subscribers when a reach-shaped row omits them', () => {
    const map = new Map<string, ChannelDaily>();

    accumulateChannelDaily(map, CONNECTION, '2026-03-01', {
      impressions: 900,
      engaged_views: 30,
    });

    const [row] = collect(map);

    expect(row?.subscribers_gained).toBe(0);
    expect(row?.subscribers_lost).toBe(0);
  });

  it('does not lose gross detail to a net figure', () => {
    const map = new Map<string, ChannelDaily>();

    accumulateChannelDaily(map, CONNECTION, '2026-03-01', {
      subscribers_gained: 5,
      subscribers_lost: 5,
    });

    const [row] = collect(map);

    // A net-only accumulator would store 0 here and lose the fact that ten
    // subscribers moved. FILM-1601 split gross precisely to keep this.
    expect(row?.subscribers_gained).toBe(5);
    expect(row?.subscribers_lost).toBe(5);
  });
});
