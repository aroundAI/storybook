import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  buildLatestLevel,
  buildSubscriberSeries,
} from '../src/lib/subscriber-levels-core';
import {
  queryLatestSubscriberLevels,
  querySubscriberSeries,
} from '../src/subscriber-levels';
import {
  SCENARIO_TODAY,
  SCENARIO_WINDOW_FROM,
  SNAPSHOTS_ONLY_COUNTS,
  SUBSCRIBER_SCENARIOS,
  type ScenarioId,
  type SubscriberScenario,
  scenarioById,
} from '../src/testing/subscriber-scenarios';

/**
 * Every channel state through both readers (FILM-1617). The expectations are
 * the contract the surfaces build on: if a row changes, a surface's wording
 * or drawing changes with it, and that must be a decision, not a side effect.
 */

const mocks = vi.hoisted(() => ({
  querySubscriberAnchors: vi.fn(),
  querySubscriberDeltas: vi.fn(),
}));

vi.mock('../src/queries-advanced', () => ({
  querySubscriberAnchors: mocks.querySubscriberAnchors,
  querySubscriberDeltas: mocks.querySubscriberDeltas,
}));

const window = { from: SCENARIO_WINDOW_FROM, to: SCENARIO_TODAY };

function inputsOf(s: SubscriberScenario) {
  return { connectionId: s.connectionId, anchors: s.anchors, deltas: s.deltas };
}

/** As the real queries do: rows for the requested ids and dates only. */
function serveScenarios() {
  mocks.querySubscriberAnchors.mockImplementation(
    async (q: { connectionIds: string[]; from: string; to: string }) =>
      SUBSCRIBER_SCENARIOS.filter((s) =>
        q.connectionIds.includes(s.connectionId),
      ).flatMap((s) =>
        s.anchors
          .filter((a) => a.snapshotDate >= q.from && a.snapshotDate <= q.to)
          .map((a) => ({ ...a, connectionId: s.connectionId })),
      ),
  );
  mocks.querySubscriberDeltas.mockImplementation(
    async (q: { connectionIds: string[]; from: string; to: string }) =>
      SUBSCRIBER_SCENARIOS.filter((s) =>
        q.connectionIds.includes(s.connectionId),
      ).flatMap((s) =>
        s.deltas
          .filter((d) => d.metricDate >= q.from && d.metricDate <= q.to)
          .map((d) => ({ ...d, connectionId: s.connectionId })),
      ),
  );
}

interface Expected {
  /** Last point in the window, or null for no points. */
  lastPoint: string | null;
  lastDataDate: string | null;
  /** Date of the latest level, or null when there is none. */
  latest: string | null;
}

const EXPECTED: Record<ScenarioId, Expected> = {
  'never-measured': { lastPoint: null, lastDataDate: null, latest: null },
  // Movement alone is an offset, never a count: not "data that ended".
  'hidden-count': { lastPoint: null, lastDataDate: null, latest: null },
  'untracked-platform': { lastPoint: null, lastDataDate: null, latest: null },
  'new-one-snapshot': {
    lastPoint: '2026-09-17',
    lastDataDate: '2026-09-17',
    latest: '2026-09-17',
  },
  'healthy-rounded': {
    lastPoint: '2026-09-17',
    lastDataDate: '2026-09-17',
    latest: '2026-09-17',
  },
  'healthy-exact': {
    lastPoint: '2026-09-17',
    lastDataDate: '2026-09-17',
    latest: '2026-09-17',
  },
  'capture-gap': {
    lastPoint: '2026-09-17',
    lastDataDate: '2026-09-17',
    latest: '2026-09-17',
  },
  'active-stopped-in-window': {
    lastPoint: '2026-06-30',
    lastDataDate: '2026-06-30',
    latest: '2026-06-30',
  },
  'active-stopped-before-window': {
    lastPoint: null,
    lastDataDate: '2025-06-30',
    latest: '2025-06-30',
  },
  'disconnected-in-window': {
    lastPoint: '2026-06-30',
    lastDataDate: '2026-06-30',
    latest: '2026-06-30',
  },
  'disconnected-before-window': {
    lastPoint: null,
    lastDataDate: '2025-06-30',
    latest: '2025-06-30',
  },
  'disconnected-never-measured': {
    lastPoint: null,
    lastDataDate: null,
    latest: null,
  },
  // Its daily rows run to yesterday but carry no measured movement: they are
  // not evidence, so the curve and the latest level end at the last recorded
  // count, Sep 14 (KB-114).
  'snapshots-only': {
    lastPoint: '2026-09-14',
    lastDataDate: '2026-09-14',
    latest: '2026-09-14',
  },
};

describe('subscriber scenarios', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    serveScenarios();
  });

  describe.each(SUBSCRIBER_SCENARIOS)('$id', (scenario) => {
    const expected = EXPECTED[scenario.id];
    const series = buildSubscriberSeries(inputsOf(scenario), window);
    const latest = buildLatestLevel(inputsOf(scenario));

    it('ends its curve where expected', () => {
      expect(series.points.at(-1)?.date ?? null).toBe(expected.lastPoint);
    });

    it('reports its last data date', () => {
      expect(series.lastDataDate).toBe(expected.lastDataDate);
    });

    it('has a latest level only when measured', () => {
      expect(latest?.date ?? null).toBe(expected.latest);
    });

    // Invariants — true of every scenario, including ones added later.

    it('never draws a point after its newest measurement', () => {
      for (const point of series.points) {
        expect(point.date <= (series.lastDataDate ?? '')).toBe(true);
      }
    });

    it('never has a last data date without a snapshot', () => {
      if (scenario.anchors.length === 0) {
        expect(series.lastDataDate).toBeNull();
      }
    });

    it('agrees with the latest level on the curve’s last point', () => {
      const last = series.points.at(-1);

      if (last && latest && last.date === latest.date) {
        expect(last.level).toBe(latest.level);
      }
    });

    it('has no point in a day the window excludes', () => {
      for (const point of series.points) {
        expect(point.date >= window.from && point.date <= window.to).toBe(true);
      }
    });
  });

  // KB-114, option a (decided 2026-09-25). A channel with no measured daily
  // movement: every recorded count exactly, straight lines between them,
  // nothing before the first or after the last, never a measured movement.
  describe('snapshots-only, figure by figure', () => {
    const scenario = scenarioById('snapshots-only');
    const { points } = buildSubscriberSeries(inputsOf(scenario), window);
    const byDate = new Map(points.map((p) => [p.date, p]));

    it('shows every recorded count exactly, as measured', () => {
      for (const [date, count] of SNAPSHOTS_ONLY_COUNTS) {
        expect(byDate.get(date)).toEqual({
          date,
          level: count,
          source: 'snapshot',
        });
      }
    });

    it('draws a straight line between two counts, labelled as such', () => {
      // 1,000 on Aug 20 → 1,070 on Aug 27: 10 a day.
      expect(byDate.get('2026-08-23')).toEqual({
        date: '2026-08-23',
        level: 1_030,
        source: 'between_snapshots',
      });
      // 1,070 on Aug 27 → 1,105 on Sep 3: 5 a day.
      expect(byDate.get('2026-08-30')?.level).toBe(1_085);
      // 1,105 on Sep 3 → 1,210 on Sep 10: 15 a day.
      expect(byDate.get('2026-09-06')?.level).toBe(1_150);
    });

    it('never presents a day between counts as measured', () => {
      const recorded = new Set(SNAPSHOTS_ONLY_COUNTS.map(([date]) => date));

      for (const point of points) {
        expect(point.source).toBe(
          recorded.has(point.date) ? 'snapshot' : 'between_snapshots',
        );
      }
    });

    it('draws nothing before the first count or after the last', () => {
      expect(points[0]?.date).toBe('2026-08-20');
      expect(points.at(-1)?.date).toBe('2026-09-14');
      expect(points).toHaveLength(26);
    });
  });

  // The same rows through the real readers, with their date-range reads, so
  // a change to what they fetch cannot slip past the builders' contract.
  it('gives the same answers through the query functions', async () => {
    const ids = SUBSCRIBER_SCENARIOS.map((s) => s.connectionId);

    const [series, latest] = await Promise.all([
      querySubscriberSeries({ connectionIds: ids, ...window }),
      queryLatestSubscriberLevels(ids, SCENARIO_TODAY),
    ]);

    for (const scenario of SUBSCRIBER_SCENARIOS) {
      const expected = EXPECTED[scenario.id];
      const own = series.find((s) => s.connectionId === scenario.connectionId);

      expect(own?.points.at(-1)?.date ?? null, scenario.id).toBe(
        expected.lastPoint,
      );
      expect(own?.lastDataDate ?? null, scenario.id).toBe(
        expected.lastDataDate,
      );
      expect(latest.get(scenario.connectionId)?.date ?? null, scenario.id).toBe(
        expected.latest,
      );
    }
  });
});
