import { describe, expect, it } from 'vitest';

import {
  type SubscriberAnchor,
  type SubscriberDelta,
  reconstructSeries,
} from '../src/lib/subscriber-series';

const exact = (date: string, count: number): SubscriberAnchor => ({
  snapshotDate: date,
  subscriberCount: count,
  roundingStep: 0,
});

const rounded = (
  date: string,
  count: number,
  step: number,
): SubscriberAnchor => ({
  snapshotDate: date,
  subscriberCount: count,
  roundingStep: step,
});

const net = (date: string, value: number): SubscriberDelta => ({
  metricDate: date,
  net: value,
});

describe('reconstructSeries', () => {
  it('returns nothing when there is no anchor', () => {
    // Deltas alone give an offset, never a level.
    const series = reconstructSeries(
      [],
      [net('2026-03-02', 10), net('2026-03-03', 10)],
      { from: '2026-03-01', to: '2026-03-03' },
    );

    expect(series).toEqual([]);
  });

  it('walks forward from an exact anchor, applying net(D) to day D', () => {
    const series = reconstructSeries(
      [exact('2026-03-01', 1000)],
      [net('2026-03-02', 25), net('2026-03-03', -5)],
      { from: '2026-03-01', to: '2026-03-03' },
    );

    expect(series.map((p) => [p.date, p.level, p.source])).toEqual([
      ['2026-03-01', 1000, 'snapshot'],
      ['2026-03-02', 1025, 'interpolated'],
      ['2026-03-03', 1020, 'interpolated'],
    ]);
  });

  it('lets an exact anchor override a drifted walk outright', () => {
    const series = reconstructSeries(
      [exact('2026-03-01', 1000), exact('2026-03-03', 5000)],
      [net('2026-03-02', 10), net('2026-03-03', 10)],
      { from: '2026-03-01', to: '2026-03-03' },
    );

    expect(series[2]).toEqual({
      date: '2026-03-03',
      level: 5000,
      source: 'snapshot',
    });
  });

  describe('rounded anchors', () => {
    it('leaves the delta-derived level alone while it sits inside the band', () => {
      // The whole point of anchor-plus-delta: YouTube reports 1230000 every
      // day for weeks, and re-levelling to it daily would render a staircase.
      const series = reconstructSeries(
        [rounded('2026-03-01', 1230000, 10000)],
        [
          net('2026-03-02', 400),
          net('2026-03-03', 400),
          net('2026-03-04', 400),
        ],
        { from: '2026-03-01', to: '2026-03-04' },
      );

      expect(series.map((p) => p.level)).toEqual([
        1230000, 1230400, 1230800, 1231200,
      ]);
    });

    it('reports a band-satisfied day as constrained, not snapshot or interpolated', () => {
      const series = reconstructSeries(
        [rounded('2026-03-01', 1230000, 10000), rounded('2026-03-02', 1230000, 10000)],
        [net('2026-03-02', 400)],
        { from: '2026-03-01', to: '2026-03-02' },
      );

      expect(series[1]!.source).toBe('constrained');
      expect(series[1]!.level).toBe(1230400);
    });

    it('clamps to one below the exclusive upper bound, never to the bound', () => {
      // 1240000 is the first level this anchor rules out — the platform would
      // have reported it as the next step up.
      const series = reconstructSeries(
        [rounded('2026-03-01', 1230000, 10000), rounded('2026-03-02', 1230000, 10000)],
        [net('2026-03-02', 50000)],
        { from: '2026-03-01', to: '2026-03-02' },
      );

      expect(series[1]!.level).toBe(1239999);
      expect(series[1]!.source).toBe('clamped');
    });

    it('holds at the band edge while the anchor keeps contradicting the walk', () => {
      const series = reconstructSeries(
        [
          rounded('2026-03-01', 1230000, 10000),
          rounded('2026-03-02', 1230000, 10000),
          rounded('2026-03-03', 1230000, 10000),
        ],
        [net('2026-03-02', 50000), net('2026-03-03', 100)],
        { from: '2026-03-01', to: '2026-03-03' },
      );

      // The platform still says 1.23M, so the true level cannot exceed
      // 1239999 — a plateau, which is correct, not a sawtooth.
      expect(series.map((p) => p.level)).toEqual([1230000, 1239999, 1239999]);
      expect(series.map((p) => p.source)).toEqual([
        'clamped',
        'clamped',
        'clamped',
      ]);
    });

    it('re-bases after a clamp, so a later anchor resolves cleanly', () => {
      // This is what re-basing buys. Day 2 clamps; day 3's anchor has moved up
      // a step. Continuing from the clamped 1239999 lands inside the new band.
      // Continuing from the unclamped 1280000 would clamp again at 1249999 —
      // wrong, and wrong for every day after it.
      const series = reconstructSeries(
        [
          rounded('2026-03-01', 1230000, 10000),
          rounded('2026-03-02', 1230000, 10000),
          rounded('2026-03-03', 1240000, 10000),
        ],
        [net('2026-03-02', 50000), net('2026-03-03', 100)],
        { from: '2026-03-01', to: '2026-03-03' },
      );

      expect(series[1]!.level).toBe(1239999);
      expect(series[2]!).toEqual({
        date: '2026-03-03',
        level: 1240099,
        source: 'constrained',
      });
    });

    it('seeds a rounded first anchor at the band floor and marks it clamped', () => {
      const series = reconstructSeries(
        [rounded('2026-03-01', 1230000, 10000)],
        [],
        { from: '2026-03-01', to: '2026-03-01' },
      );

      expect(series[0]).toEqual({
        date: '2026-03-01',
        level: 1230000,
        source: 'clamped',
      });
    });
  });

  describe('days before the first anchor', () => {
    it('reconstructs them backwards where deltas exist', () => {
      const series = reconstructSeries(
        [exact('2026-03-03', 1000)],
        [net('2026-03-02', 30), net('2026-03-03', 20)],
        { from: '2026-03-01', to: '2026-03-03' },
      );

      expect(series.map((p) => [p.date, p.level])).toEqual([
        ['2026-03-01', 950],
        ['2026-03-02', 980],
        ['2026-03-03', 1000],
      ]);
    });

    it('omits days the deltas do not reach, rather than inventing a level', () => {
      const series = reconstructSeries(
        [exact('2026-03-03', 1000)],
        [net('2026-03-03', 20)],
        { from: '2026-03-01', to: '2026-03-03' },
      );

      expect(series.map((p) => p.date)).toEqual(['2026-03-02', '2026-03-03']);
    });
  });

  it('renders a window that opens inside a capture gap', () => {
    // The anchor predates `from`; its level still determines the window.
    const series = reconstructSeries(
      [exact('2026-02-28', 1000)],
      [net('2026-03-01', 10), net('2026-03-02', 10)],
      { from: '2026-03-01', to: '2026-03-02' },
    );

    expect(series.map((p) => [p.date, p.level])).toEqual([
      ['2026-03-01', 1010],
      ['2026-03-02', 1020],
    ]);
  });
});
