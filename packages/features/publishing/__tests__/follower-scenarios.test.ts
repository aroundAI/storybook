import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SUBSCRIBER_SOURCE_LABEL, buildLatestLevel } from '@kit/clickhouse';
import {
  SCENARIO_TODAY,
  SUBSCRIBER_SCENARIOS,
  type ScenarioId,
} from '@kit/clickhouse/testing';

import {
  FOLLOWER_SOURCE_LABEL,
  describeFollowerCount,
} from '../src/lib/follower-count';
import { resolveFollowerCounts } from '../src/server/follower-counts';

/**
 * Every channel state through the publish screen's follower count
 * (FILM-1617), from the same fixtures and builders as the Deep Dive — so the
 * chip and the YPP card cannot drift apart on any state.
 */

const clickhouse = vi.hoisted(() => ({
  queryLatestSubscriberLevels: vi.fn(),
}));

vi.mock('@kit/clickhouse/server', () => clickhouse);

vi.mock('@kit/shared/logger', () => ({
  getLogger: async () => ({ warn: vi.fn(), info: vi.fn(), error: vi.fn() }),
}));

interface Expected {
  /** The chip's text, or null when no count is shown at all. */
  short: string | null;
  stale?: boolean;
  detail?: string[];
  notDetail?: string[];
}

const EXPECTED: Record<ScenarioId, Expected> = {
  'never-measured': { short: null },
  'hidden-count': { short: null },
  'untracked-platform': { short: null },
  'disconnected-never-measured': { short: null },
  'new-one-snapshot': {
    short: '480',
    stale: false,
    detail: ['480 followers — Measured, as of Sep 17, 2026'],
    notDetail: ['either way'],
  },
  'healthy-rounded': {
    short: '42.5K',
    stale: false,
    detail: ['Measured', 'as of Sep 17, 2026', 'either way'],
  },
  'healthy-exact': {
    short: '924',
    stale: false,
    detail: ['Measured', 'as of Sep 17, 2026'],
    notDetail: ['either way'],
  },
  'capture-gap': {
    short: '916',
    stale: false,
    detail: ['Measured', 'as of Sep 17, 2026'],
  },
  'active-stopped-in-window': {
    short: '949 · Jun 30, 2026',
    stale: true,
    detail: ['no newer data since Jun 30, 2026'],
  },
  'active-stopped-before-window': {
    short: '1.1K · Jun 30, 2025',
    stale: true,
    detail: ['no newer data since Jun 30, 2025'],
  },
  'disconnected-in-window': {
    short: '2.4K · Jun 30, 2026',
    stale: true,
    detail: ['no newer data since Jun 30, 2026', 'either way'],
  },
  'disconnected-before-window': {
    short: '1.1K · Jun 30, 2025',
    stale: true,
    detail: ['no newer data since Jun 30, 2025'],
  },
};

describe('follower count scenarios', () => {
  beforeEach(() => {
    clickhouse.queryLatestSubscriberLevels.mockResolvedValue(
      new Map(
        SUBSCRIBER_SCENARIOS.flatMap((s) => {
          const level = buildLatestLevel({
            connectionId: s.connectionId,
            anchors: s.anchors,
            deltas: s.deltas,
          });

          return level ? [[s.connectionId, level] as const] : [];
        }),
      ),
    );
  });

  it.each(SUBSCRIBER_SCENARIOS.map((s) => [s.id, s] as const))(
    '%s',
    async (_id, scenario) => {
      const expected = EXPECTED[scenario.id];

      const resolved = (
        await resolveFollowerCounts([
          { id: scenario.connectionId, created_at: null, metadata: null },
        ])
      ).get(scenario.connectionId);

      if (expected.short === null) {
        // No count is never shown as 0.
        expect(resolved?.followerCount).toBeNull();
        return;
      }

      const display = describeFollowerCount({
        count: resolved!.followerCount!,
        source: resolved!.followerCountSource,
        asOf: resolved!.followerCountAsOf,
        roundingStep: resolved!.followerCountRoundingStep,
        today: SCENARIO_TODAY,
      });

      expect(display.short).toBe(expected.short);
      expect(display.stale).toBe(expected.stale);

      for (const text of expected.detail ?? []) {
        expect(display.detail).toContain(text);
      }
      for (const text of expected.notDetail ?? []) {
        expect(display.detail).not.toContain(text);
      }
    },
  );
});

// The chip and the Deep Dive read one label table: a change there reaches
// both, and neither can be edited to disagree with the other.
describe('follower labels come from the shared table', () => {
  it('measured', () => {
    expect(FOLLOWER_SOURCE_LABEL.snapshot.toLowerCase()).toBe(
      SUBSCRIBER_SOURCE_LABEL.snapshot,
    );
  });

  it('reconstructed', () => {
    expect(FOLLOWER_SOURCE_LABEL.reconstructed.toLowerCase()).toBe(
      SUBSCRIBER_SOURCE_LABEL.interpolated,
    );
  });
});
