import type { SubscriberPoint, SubscriberSource } from '@kit/clickhouse';

import { shortfallOf } from './subscriber-disclosure';

/**
 * Summing per-channel subscriber series (FILM-1617 §2).
 *
 * Emits a day only where every channel has a level. Channels are connected at
 * different times, so a naive sum steps up by a whole channel's level on the
 * day its first snapshot lands — indistinguishable from real growth — and
 * reads as a crash on every day before it.
 */

export interface SubscriberSeriesSum {
  points: SubscriberPoint[];
  /** The first summed day, or null when there is none. */
  startsOn: string | null;
  /** Channels with no level at all, which leave nothing to sum. */
  excluded: string[];
  /**
   * How far below the truth the total can sit: every channel's rounded seed
   * can be low by its own shortfall, and a sum adds them.
   */
  roundingShortfall: number;
}

// Least to most measured. A total inherits the weakest of its parts.
const SOURCE_RANK: Record<SubscriberSource, number> = {
  clamped: 0,
  constrained: 1,
  interpolated: 2,
  snapshot: 3,
};

function weaker(a: SubscriberSource, b: SubscriberSource): SubscriberSource {
  return SOURCE_RANK[a] <= SOURCE_RANK[b] ? a : b;
}

export function sumSubscriberSeries(
  series: Array<{
    connectionId: string;
    points: SubscriberPoint[];
    roundingStep: number;
  }>,
): SubscriberSeriesSum {
  const excluded = series
    .filter((s) => s.points.length === 0)
    .map((s) => s.connectionId);

  if (series.length === 0 || excluded.length > 0) {
    return { points: [], startsOn: null, excluded, roundingShortfall: 0 };
  }

  // Checked per day, not from one start date: a series can have gaps.
  const byDate = new Map<string, { point: SubscriberPoint; count: number }>();

  for (const { points } of series) {
    for (const point of points) {
      const day = byDate.get(point.date);

      byDate.set(
        point.date,
        day
          ? {
              point: {
                date: point.date,
                level: day.point.level + point.level,
                source: weaker(day.point.source, point.source),
              },
              count: day.count + 1,
            }
          : { point, count: 1 },
      );
    }
  }

  const points = [...byDate.values()]
    .filter((day) => day.count === series.length)
    .map((day) => day.point)
    .sort((a, b) => (a.date < b.date ? -1 : 1));

  const roundingShortfall = series.reduce(
    (total, s) => total + shortfallOf(s.roundingStep),
    0,
  );

  return {
    points,
    startsOn: points[0]?.date ?? null,
    excluded,
    roundingShortfall,
  };
}
