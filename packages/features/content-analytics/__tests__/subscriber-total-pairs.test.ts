import { describe, expect, it } from 'vitest';

import {
  type SubscriberPoint,
  type SubscriberSource,
  buildSubscriberSeries,
} from '@kit/clickhouse';
import {
  SCENARIO_TODAY,
  SCENARIO_WINDOW_FROM,
  SUBSCRIBER_SCENARIOS,
  type SubscriberScenario,
} from '@kit/clickhouse/testing';

import { measuredKey, toChartData } from '../src/lib/subscriber-chart-data';
import { roundingErrorOf } from '../src/lib/subscriber-disclosure';
import { sumByPlatform } from '../src/lib/subscriber-series-sum';

/**
 * Every pair of channel states, summed (FILM-1617).
 *
 * The Total merges channels, so its bugs live in combinations: round eight
 * found a capture gap summed with a rounded channel drawn as measured — a
 * pair no hand-picked row had tried. This runs all 78 pairs, each state
 * with itself included, against rules stated here independently of the
 * code under test.
 */

// The spec's rule (§3.1), stated independently of the implementation: only
// a day with no snapshot is reconstructed.
const isMeasured = (source: SubscriberSource) => source !== 'interpolated';

const window = { from: SCENARIO_WINDOW_FROM, to: SCENARIO_TODAY };

/** Both channels active on one platform, so both take part in its total. */
function asActiveYouTube(s: SubscriberScenario, suffix: string) {
  const connectionId = `${s.connectionId}-${suffix}`;

  return {
    series: buildSubscriberSeries(
      { connectionId, anchors: s.anchors, deltas: s.deltas },
      window,
    ),
    channel: {
      connectionId,
      platform: 'youtube',
      name: `${s.name} ${suffix}`,
      isActive: true,
    },
  };
}

function byDate(points: SubscriberPoint[]) {
  return new Map(points.map((p) => [p.date, p]));
}

const PAIRS = SUBSCRIBER_SCENARIOS.flatMap((a, i) =>
  SUBSCRIBER_SCENARIOS.slice(i).map((b) => [a, b] as const),
);

describe('every pair of states, summed', () => {
  it('covers all 78 pairs', () => {
    expect(PAIRS).toHaveLength(78);
  });

  it.each(PAIRS.map(([a, b]) => [`${a.id} + ${b.id}`, a, b] as const))(
    '%s',
    (_name, a, b) => {
      const left = asActiveYouTube(a, 'a');
      const right = asActiveYouTube(b, 'b');

      const [total] = sumByPlatform(
        [left.series, right.series],
        [left.channel, right.channel],
      );

      const leftDays = byDate(left.series.points);
      const rightDays = byDate(right.series.points);
      const totalDays = byDate(total?.points ?? []);

      const { rows } = toChartData([
        { key: 't', name: 'Total', points: total?.points ?? [] },
      ]);
      const rowByDate = new Map(rows.map((r) => [r.date, r]));

      const dates = new Set([...leftDays.keys(), ...rightDays.keys()]);

      for (const date of dates) {
        const l = leftDays.get(date);
        const r = rightDays.get(date);
        const t = totalDays.get(date);

        // A day is summed iff both channels have a level on it.
        expect(Boolean(t), `${date} present`).toBe(Boolean(l && r));

        if (!t || !l || !r) continue;

        expect(t.level, `${date} level`).toBe(l.level + r.level);

        // Measured only if both parts were: one reconstructed channel makes
        // the day reconstructed.
        const measured = isMeasured(l.source) && isMeasured(r.source);

        expect(isMeasured(t.source), `${date} measured`).toBe(measured);
        expect(
          rowByDate.get(date)?.[measuredKey('t')] != null,
          `${date} drawn solid`,
        ).toBe(measured);

        // A clamped square only on a measured day with a clamped part.
        if (t.source === 'clamped') {
          expect(measured, `${date} clamped is measured`).toBe(true);
          expect(
            l.source === 'clamped' || r.source === 'clamped',
            `${date} clamped has a clamped part`,
          ).toBe(true);
        }
      }

      if (total && total.points.length > 0) {
        expect(total.roundingError).toBe(
          roundingErrorOf(left.series.roundingStep) +
            roundingErrorOf(right.series.roundingStep),
        );
      }
    },
  );
});
