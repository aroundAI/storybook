import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  queryLatestSubscriberLevels,
  querySubscriberSeries,
} from '../src/subscriber-levels';

const mocks = vi.hoisted(() => ({
  querySubscriberAnchors: vi.fn(),
  querySubscriberDeltas: vi.fn(),
}));

vi.mock('../src/queries-advanced', () => ({
  querySubscriberAnchors: mocks.querySubscriberAnchors,
  querySubscriberDeltas: mocks.querySubscriberDeltas,
}));

const A = 'conn-a';
const B = 'conn-b';

function anchor(
  connectionId: string,
  snapshotDate: string,
  subscriberCount: number,
  roundingStep = 0,
) {
  return { connectionId, snapshotDate, subscriberCount, roundingStep };
}

function delta(connectionId: string, metricDate: string, net: number) {
  return { connectionId, metricDate, net };
}

describe('subscriber levels', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.querySubscriberAnchors.mockResolvedValue([]);
    mocks.querySubscriberDeltas.mockResolvedValue([]);
  });

  describe('querySubscriberSeries', () => {
    it('reads nothing for no connections', async () => {
      await expect(
        querySubscriberSeries({
          connectionIds: [],
          from: '2026-09-01',
          to: '2026-09-03',
        }),
      ).resolves.toEqual([]);

      expect(mocks.querySubscriberAnchors).not.toHaveBeenCalled();
    });

    // One seed for every reader: all anchors ever, and deltas from the
    // earliest of them — or from `from`, if that is earlier, for the walk
    // back before a channel's first snapshot.
    it('reads every anchor, and deltas from the earliest one', async () => {
      mocks.querySubscriberAnchors.mockResolvedValue([
        anchor(A, '2024-03-01', 100),
      ]);

      await querySubscriberSeries({
        connectionIds: [A],
        from: '2026-09-01',
        to: '2026-09-03',
      });

      expect(mocks.querySubscriberAnchors).toHaveBeenCalledWith({
        connectionIds: [A],
        from: '1970-01-01',
        to: '2026-09-03',
      });
      expect(mocks.querySubscriberDeltas).toHaveBeenCalledWith({
        connectionIds: [A],
        from: '2024-03-01',
        to: '2026-09-03',
      });
    });

    it('reads deltas from `from` when it precedes every anchor', async () => {
      mocks.querySubscriberAnchors.mockResolvedValue([
        anchor(A, '2026-09-02', 100),
      ]);

      await querySubscriberSeries({
        connectionIds: [A],
        from: '2026-09-01',
        to: '2026-09-03',
      });

      expect(mocks.querySubscriberDeltas).toHaveBeenCalledWith(
        expect.objectContaining({ from: '2026-09-01' }),
      );
    });

    it('keeps each connection to its own anchors and deltas', async () => {
      mocks.querySubscriberAnchors.mockResolvedValue([
        anchor(A, '2026-09-01', 100),
        anchor(B, '2026-09-01', 5000),
      ]);
      mocks.querySubscriberDeltas.mockResolvedValue([
        delta(A, '2026-09-02', 10),
        delta(B, '2026-09-02', -50),
      ]);

      const series = await querySubscriberSeries({
        connectionIds: [A, B],
        from: '2026-09-01',
        to: '2026-09-02',
      });

      expect(series.map((s) => s.points.map((p) => p.level))).toEqual([
        [100, 110],
        [5000, 4950],
      ]);
    });

    // The disclosure must cover the coarsest anchor, not the latest one.
    it('reports the widest rounding step behind each series', async () => {
      mocks.querySubscriberAnchors.mockResolvedValue([
        anchor(A, '2026-09-01', 40_000, 100),
        anchor(A, '2026-09-02', 41_000, 1000),
        anchor(B, '2026-09-01', 900),
      ]);

      const series = await querySubscriberSeries({
        connectionIds: [A, B],
        from: '2026-09-01',
        to: '2026-09-02',
      });

      expect(series.map((s) => s.roundingStep)).toEqual([1000, 0]);
    });

    // A hidden count writes no snapshot, so it is an empty series, never 0.
    it('returns an empty series for a connection with no anchor', async () => {
      mocks.querySubscriberDeltas.mockResolvedValue([
        delta(A, '2026-09-02', 10),
      ]);

      const [series] = await querySubscriberSeries({
        connectionIds: [A],
        from: '2026-09-01',
        to: '2026-09-02',
      });

      expect(series).toMatchObject({
        connectionId: A,
        points: [],
        roundingStep: 0,
      });
    });
  });

  // `reconstructSeries` carries a level forward over days with no delta, so
  // a line read to today ran flat past its data — for a disconnected channel,
  // flat for months, labelled as reconstructed from movement nobody measured.
  describe('series end at their newest data', () => {
    it('stops a line on its newest delta, not on the window end', async () => {
      mocks.querySubscriberAnchors.mockResolvedValue([
        anchor(A, '2026-09-10', 1000),
      ]);
      mocks.querySubscriberDeltas.mockResolvedValue([
        delta(A, '2026-09-11', 5),
        delta(A, '2026-09-12', 3),
      ]);

      const [series] = await querySubscriberSeries({
        connectionIds: [A],
        from: '2026-09-10',
        to: '2026-09-18',
      });

      expect(series?.points.at(-1)?.date).toBe('2026-09-12');
    });

    // Data that ended before the window leaves no points in it — but the
    // channel had a history, and a surface must not call it "no count yet".
    it('reports when a series with no points in the window last had data', async () => {
      mocks.querySubscriberAnchors.mockResolvedValue([
        anchor(A, '2025-01-01', 2300),
      ]);

      const [series] = await querySubscriberSeries({
        connectionIds: [A],
        from: '2025-09-18',
        to: '2026-09-18',
      });

      expect(series?.points).toEqual([]);
      expect(series?.lastDataDate).toBe('2025-01-01');
    });

    it('has no last data date for a channel never measured', async () => {
      const [series] = await querySubscriberSeries({
        connectionIds: [A],
        from: '2025-09-18',
        to: '2026-09-18',
      });

      expect(series?.lastDataDate).toBeNull();
    });

    it('ends a channel with no data after its last anchor on that anchor', async () => {
      mocks.querySubscriberAnchors.mockResolvedValue([
        anchor(A, '2026-06-01', 2300),
      ]);

      const [series] = await querySubscriberSeries({
        connectionIds: [A],
        from: '2026-05-01',
        to: '2026-09-18',
      });

      expect(series?.points.map((p) => p.date)).toEqual(['2026-06-01']);
    });
  });

  // Every reader seeds `reconstructSeries` from the earliest anchor it is
  // given. If readers fetch different windows, a rounded channel's seed sits
  // at a different point in its band for each, and the curve, the YPP count
  // and the follower chip disagree by up to step − 1.
  describe('one seed for every reader', () => {
    const anchors = [
      anchor(A, '2025-01-01', 100_000, 1000),
      anchor(A, '2025-09-01', 100_000, 1000),
    ];
    const deltas = [delta(A, '2025-03-01', 600), delta(A, '2026-09-10', 5)];

    // As the real queries do: only rows inside the requested range come back.
    function withRange<T>(rows: T[], dateOf: (row: T) => string) {
      return async (input: { from: string; to: string }) =>
        rows.filter((r) => dateOf(r) >= input.from && dateOf(r) <= input.to);
    }

    beforeEach(() => {
      mocks.querySubscriberAnchors.mockImplementation(
        withRange(anchors, (a) => a.snapshotDate),
      );
      mocks.querySubscriberDeltas.mockImplementation(
        withRange(deltas, (d) => d.metricDate),
      );
    });

    it('gives the curve and the latest level the same figure', async () => {
      const [series] = await querySubscriberSeries({
        connectionIds: [A],
        from: '2025-09-18',
        to: '2026-09-18',
      });
      const latest = (await queryLatestSubscriberLevels([A], '2026-09-18')).get(
        A,
      );

      expect(series?.points.at(-1)).toMatchObject({
        date: '2026-09-10',
        level: 100_605,
      });
      expect(latest).toMatchObject({ date: '2026-09-10', level: 100_605 });
    });

    it('does not move when an old snapshot ages out', async () => {
      const before = (await queryLatestSubscriberLevels([A], '2026-02-01')).get(
        A,
      );
      const after = (await queryLatestSubscriberLevels([A], '2026-02-10')).get(
        A,
      );

      expect(after?.level).toBe(before?.level);
    });
  });

  describe('queryLatestSubscriberLevels', () => {
    it('dates the level by its newest evidence, not by today', async () => {
      mocks.querySubscriberAnchors.mockResolvedValue([
        anchor(A, '2026-09-10', 1000),
      ]);
      mocks.querySubscriberDeltas.mockResolvedValue([
        delta(A, '2026-09-11', 5),
        delta(A, '2026-09-12', 3),
      ]);

      const levels = await queryLatestSubscriberLevels([A], '2026-09-18');

      expect(levels.get(A)).toEqual({
        date: '2026-09-12',
        level: 1008,
        source: 'interpolated',
        roundingStep: 0,
      });
    });

    it('reports a measured level as a snapshot', async () => {
      mocks.querySubscriberAnchors.mockResolvedValue([
        anchor(A, '2026-09-10', 1000),
        anchor(A, '2026-09-17', 1020),
      ]);
      mocks.querySubscriberDeltas.mockResolvedValue([
        delta(A, '2026-09-12', 3),
      ]);

      const levels = await queryLatestSubscriberLevels([A], '2026-09-18');

      expect(levels.get(A)).toMatchObject({
        date: '2026-09-17',
        level: 1020,
        source: 'snapshot',
      });
    });

    it('carries the rounding step with the level', async () => {
      mocks.querySubscriberAnchors.mockResolvedValue([
        anchor(A, '2026-09-10', 41_000, 100),
      ]);

      const levels = await queryLatestSubscriberLevels([A], '2026-09-18');

      expect(levels.get(A)).toMatchObject({ level: 41_000, roundingStep: 100 });
    });

    it('leaves out a connection with deltas but no anchor', async () => {
      mocks.querySubscriberDeltas.mockResolvedValue([
        delta(A, '2026-09-12', 3),
      ]);

      const levels = await queryLatestSubscriberLevels([A], '2026-09-18');

      expect(levels.has(A)).toBe(false);
    });

    it('reads nothing for no connections', async () => {
      const levels = await queryLatestSubscriberLevels([], '2026-09-18');

      expect(levels.size).toBe(0);
      expect(mocks.querySubscriberAnchors).not.toHaveBeenCalled();
    });
  });
});
