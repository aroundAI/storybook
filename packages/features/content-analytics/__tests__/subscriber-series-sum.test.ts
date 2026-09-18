import { describe, expect, it } from 'vitest';

import type { SubscriberSource } from '@kit/clickhouse';

import {
  sumByPlatform,
  sumSubscriberSeries,
} from '../src/lib/subscriber-series-sum';

function series(
  connectionId: string,
  points: Array<[string, number, SubscriberSource?]>,
  roundingStep = 0,
) {
  return {
    connectionId,
    roundingStep,
    points: points.map(([date, level, source = 'interpolated']) => ({
      date,
      level,
      source,
    })),
  };
}

describe('sumSubscriberSeries', () => {
  // The rule the spec exists for: a naive sum steps up by B's whole level the
  // day B's first snapshot lands, which reads as growth.
  it('starts on the first day every channel has a level', () => {
    const result = sumSubscriberSeries([
      series('a', [
        ['2026-09-01', 100],
        ['2026-09-02', 110],
        ['2026-09-03', 120],
      ]),
      series('b', [
        ['2026-09-02', 5000],
        ['2026-09-03', 5010],
      ]),
    ]);

    expect(result.startsOn).toBe('2026-09-02');
    expect(result.points.map((p) => [p.date, p.level])).toEqual([
      ['2026-09-02', 5110],
      ['2026-09-03', 5130],
    ]);
  });

  it('skips a day on which any channel has no level', () => {
    const result = sumSubscriberSeries([
      series('a', [
        ['2026-09-01', 100],
        ['2026-09-02', 110],
        ['2026-09-03', 120],
      ]),
      series('b', [
        ['2026-09-01', 5000],
        ['2026-09-03', 5010],
      ]),
    ]);

    expect(result.points.map((p) => p.date)).toEqual([
      '2026-09-01',
      '2026-09-03',
    ]);
  });

  it('gives a single channel back unchanged', () => {
    const only = series('a', [
      ['2026-09-01', 100, 'snapshot'],
      ['2026-09-02', 110],
    ]);

    const result = sumSubscriberSeries([only]);

    expect(result.points).toEqual(only.points);
    expect(result.startsOn).toBe('2026-09-01');
    expect(result.excluded).toEqual([]);
  });

  // A total is only as measured as its least-measured part.
  it('takes the weakest source of the day', () => {
    const result = sumSubscriberSeries([
      series('a', [['2026-09-01', 100, 'snapshot']]),
      series('b', [['2026-09-01', 200, 'clamped']]),
      series('c', [['2026-09-01', 300, 'constrained']]),
    ]);

    expect(result.points).toEqual([
      { date: '2026-09-01', level: 600, source: 'clamped' },
    ]);
  });

  it('names the channels that leave the total empty', () => {
    const result = sumSubscriberSeries([
      series('a', [['2026-09-01', 100]]),
      series('b', []),
    ]);

    expect(result.points).toEqual([]);
    expect(result.startsOn).toBeNull();
    expect(result.excluded).toEqual(['b']);
  });

  // Each channel's level can be off by up to step − 1, and a sum adds those
  // bounds: three channels rounded to 10,000 can be off by 29,997.
  it('adds up the rounding error of every channel in the total', () => {
    const day: Array<[string, number]> = [['2026-09-01', 1_000_000]];

    expect(
      sumSubscriberSeries([
        series('a', day, 10_000),
        series('b', day, 10_000),
        series('c', day, 10_000),
      ]).roundingError,
    ).toBe(29_997);

    expect(
      sumSubscriberSeries([series('a', day), series('b', day)]).roundingError,
    ).toBe(0);
  });

  it('is empty for no channels', () => {
    expect(sumSubscriberSeries([])).toEqual({
      points: [],
      startsOn: null,
      excluded: [],
      roundingError: 0,
    });
  });
});

describe('sumByPlatform', () => {
  const day: Array<[string, number]> = [['2026-09-01', 100]];

  function channel(connectionId: string, platform: string, isActive = true) {
    return { connectionId, platform, name: `${connectionId} name`, isActive };
  }

  // YouTube subscribers and TikTok followers are different things, and one
  // person on both would be counted twice in a cross-platform sum.
  it('keeps one total per platform', () => {
    const totals = sumByPlatform(
      [series('yt-en', day), series('yt-hi', day), series('tt', day)],
      [
        channel('yt-en', 'youtube'),
        channel('yt-hi', 'youtube'),
        channel('tt', 'tiktok'),
      ],
    );

    expect(
      totals.map((t) => [t.platform, t.points.map((p) => p.level)]),
    ).toEqual([
      ['tiktok', [100]],
      ['youtube', [200]],
    ]);
  });

  // A disconnected channel is never snapshotted again, so with no level it
  // would block its platform's total for good.
  it('leaves out a disconnected channel, and names it', () => {
    const [youtube] = sumByPlatform(
      [series('yt-en', day), series('yt-old', [])],
      [channel('yt-en', 'youtube'), channel('yt-old', 'youtube', false)],
    );

    expect(youtube?.points.map((p) => p.level)).toEqual([100]);
    expect(youtube?.disconnected).toEqual(['yt-old name']);
    expect(youtube?.excluded).toEqual([]);
  });

  // An active channel with no level will get one at the next capture, so it
  // blocks the total and is named as the reason.
  it('still has no total while an active channel has no level', () => {
    const [youtube] = sumByPlatform(
      [series('yt-en', day), series('yt-new', [])],
      [channel('yt-en', 'youtube'), channel('yt-new', 'youtube')],
    );

    expect(youtube?.points).toEqual([]);
    expect(youtube?.excluded).toEqual(['yt-new']);
  });

  it('adds up rounding error within a platform only', () => {
    const totals = sumByPlatform(
      [series('yt-en', day, 100), series('yt-hi', day, 10), series('tt', day)],
      [
        channel('yt-en', 'youtube'),
        channel('yt-hi', 'youtube'),
        channel('tt', 'tiktok'),
      ],
    );

    expect(totals.map((t) => [t.platform, t.roundingError])).toEqual([
      ['tiktok', 0],
      ['youtube', 108],
    ]);
  });
});
