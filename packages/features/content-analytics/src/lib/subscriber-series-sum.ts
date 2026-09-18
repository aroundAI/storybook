import {
  type SubscriberPoint,
  type SubscriberSource,
  isSubscriberTracked,
} from '@kit/clickhouse';

import { roundingErrorOf } from './subscriber-disclosure';

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
  /** The last summed day, or null when there is none. */
  endsOn: string | null;
  /** Channels with no level at all, which leave nothing to sum. */
  excluded: string[];
  /**
   * How far the total can sit from the truth, either way: every channel's
   * level can be off by its own rounding error, and a sum adds them.
   */
  roundingError: number;
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
    return {
      points: [],
      startsOn: null,
      endsOn: null,
      excluded,
      roundingError: 0,
    };
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

  const roundingError = series.reduce(
    (total, s) => total + roundingErrorOf(s.roundingStep),
    0,
  );

  return {
    points,
    startsOn: points[0]?.date ?? null,
    endsOn: points.at(-1)?.date ?? null,
    excluded,
    roundingError,
  };
}

export interface PlatformSubscriberSum extends SubscriberSeriesSum {
  platform: string;
  /** Names of the platform's disconnected channels, left out of the total. */
  disconnected: string[];
  /** Channels summed, so a surface can say when two may double-count. */
  channelCount: number;
  /** The active channels' ids, so a surface can name them. */
  included: string[];
  /**
   * The channels whose data ends on `endsOn`, when another channel's runs
   * later — the reason the total stops early. Empty when it does not.
   */
  limitedBy: string[];
}

/**
 * One total per platform, over its active channels (FILM-1617 §2).
 *
 * Per platform because a YouTube subscriber and a TikTok follower are not the
 * same thing, and one person on both would be counted twice. Active only
 * because a disconnected channel is never snapshotted again: with no level it
 * would block the total for good, and with an old one it would add a figure
 * nothing is measuring any more.
 */
export function sumByPlatform(
  series: Array<{
    connectionId: string;
    points: SubscriberPoint[];
    roundingStep: number;
  }>,
  channels: Array<{
    connectionId: string;
    platform: string;
    name: string;
    isActive: boolean;
  }>,
): PlatformSubscriberSum[] {
  const channelById = new Map(channels.map((c) => [c.connectionId, c]));
  const byPlatform = new Map<
    string,
    { active: typeof series; disconnected: string[] }
  >();

  for (const s of series) {
    const channel = channelById.get(s.connectionId);

    // No snapshot is ever taken for these: no total to offer, and the card
    // explains them on their own.
    if (!channel || !isSubscriberTracked(channel.platform)) continue;

    const group = byPlatform.get(channel.platform) ?? {
      active: [],
      disconnected: [],
    };

    if (channel.isActive) {
      group.active.push(s);
    } else {
      group.disconnected.push(channel.name);
    }

    byPlatform.set(channel.platform, group);
  }

  return [...byPlatform.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([platform, group]) => {
      const sum = sumSubscriberSeries(group.active);
      const lastDayOf = (s: { points: SubscriberPoint[] }) =>
        s.points.at(-1)?.date ?? '';
      const latestEnd = group.active.reduce(
        (latest, s) => (lastDayOf(s) > latest ? lastDayOf(s) : latest),
        '',
      );

      return {
        platform,
        ...sum,
        disconnected: group.disconnected,
        channelCount: group.active.length,
        included: group.active.map((s) => s.connectionId),
        limitedBy:
          sum.endsOn && sum.endsOn < latestEnd
            ? group.active
                .filter((s) => lastDayOf(s) === sum.endsOn)
                .map((s) => s.connectionId)
            : [],
      };
    });
}
