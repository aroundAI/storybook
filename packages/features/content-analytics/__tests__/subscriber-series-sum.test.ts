import { describe, expect, it } from 'vitest';

import type { SubscriberSource } from '@kit/clickhouse';

import { sumSubscriberSeries } from '../src/lib/subscriber-series-sum';

function series(
  connectionId: string,
  points: Array<[string, number, SubscriberSource?]>,
) {
  return {
    connectionId,
    roundingStep: 0,
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

  it('is empty for no channels', () => {
    expect(sumSubscriberSeries([])).toEqual({
      points: [],
      startsOn: null,
      excluded: [],
    });
  });
});
