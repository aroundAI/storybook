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

    // An anchor before the window still levels it, so both reads reach back.
    it('reaches back 400 days for anchors and deltas alike', async () => {
      await querySubscriberSeries({
        connectionIds: [A],
        from: '2026-09-01',
        to: '2026-09-03',
      });

      const expected = {
        connectionIds: [A],
        from: '2025-07-28',
        to: '2026-09-03',
      };
      expect(mocks.querySubscriberAnchors).toHaveBeenCalledWith(expected);
      expect(mocks.querySubscriberDeltas).toHaveBeenCalledWith(expected);
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

      expect(series).toEqual({ connectionId: A, points: [], roundingStep: 0 });
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
