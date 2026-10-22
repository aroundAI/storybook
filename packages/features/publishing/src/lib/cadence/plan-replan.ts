/**
 * FILM-2213. Posts already scheduled, laid again on their channels' current
 * posting rules (owner, 2026-10-22: "I am going to change everything that's
 * scheduled from now on").
 *
 * - With `moveLongs`, each channel's movable long videos keep their order
 *   (the order they were scheduled in, as planRelease appends them) and
 *   take the channel's next allowed long-video slots: its weekdays and
 *   times, `minDaysBetween` local days from the one before and from every
 *   long video that stays.
 * - Then each channel's movable Shorts are laid again through its one
 *   Shorts queue, oldest first, as planRelease lays a release's (FILM-2209):
 *   never more a day than the channel's Short times, on every
 *   `everyNDays`th day, and no earlier than `startAfterHours` after their
 *   episode's long video at its new time.
 * - Posts that do not move (published, claimed, breaking, a time chosen
 *   past the rules, or `pinned` by this request) keep their times, and
 *   still count toward their day and hold their minute.
 * - Each post keeps its jitter, within the channel's current jitter.
 *
 * Pure: the caller reads the channels and decides which posts may move.
 */
import {
  type CadenceContentType,
  type ChannelCadence,
  HORIZON_DAYS,
  addDays,
  daysBetween,
  localDate,
  nextFreeSlot,
  onSlotDay,
  startOfLocalDay,
} from './cadence';
import {
  MIN_LEAD_MS,
  type OccupiedPost,
  earliestOf,
  later,
  latest,
} from './plan-release';

/** One long video of an episode with posts on the plan's channels */
export interface LongVideoTime {
  publishId: string;
  episodeId: string;
  connectionId: string | null;
  at: Date;
}

export interface PlanReplanInput {
  /** Every post on the channels, by every episode */
  posts: readonly OccupiedPost[];
  /** The posts the plan may move */
  movable: ReadonlySet<string>;
  /** Posts this request moves by hand: they hold these times */
  pinned?: ReadonlyMap<string, { slotAt: Date | null; scheduledAt: Date }>;
  /** Long videos move too; without it, only Shorts do */
  moveLongs: boolean;
  /** Every long video of the episodes on the channels, on any channel */
  longVideos: readonly LongVideoTime[];
  cadenceOf: (
    connectionId: string,
    contentType: CadenceContentType,
  ) => ChannelCadence;
  /** Nothing is laid earlier than this */
  from: Date;
  now: Date;
}

export interface ReplanMove {
  publishId: string;
  connectionId: string;
  episodeId: string;
  contentType: CadenceContentType;
  fromSlotAt: Date;
  fromScheduledAt: Date;
  slotAt: Date;
  scheduledAt: Date;
}

export interface ReplanPlan {
  moves: ReplanMove[];
  /** Posts no slot was found for within HORIZON_DAYS: they stay */
  unplaced: string[];
}

const HOUR_MS = 3_600_000;
const MINUTE_MS = 60_000;

const byTime = (a: OccupiedPost, b: OccupiedPost) =>
  a.at.getTime() - b.at.getTime() || a.publishId.localeCompare(b.publishId);

export function planReplan(input: PlanReplanInput): ReplanPlan {
  const { cadenceOf } = input;
  const base = later(new Date(input.now.getTime() + MIN_LEAD_MS), input.from);
  const pinned = input.pinned ?? new Map();

  const posts = input.posts.map((post) => {
    const pin = pinned.get(post.publishId);

    return pin
      ? { ...post, at: pin.slotAt ?? pin.scheduledAt, goesAt: pin.scheduledAt }
      : post;
  });
  const isMovable = (post: OccupiedPost) =>
    input.movable.has(post.publishId) &&
    !pinned.has(post.publishId) &&
    (input.moveLongs || post.contentType === 'short');

  const placed = new Map<string, { slotAt: Date; scheduledAt: Date }>();
  const unplaced: string[] = [];
  const channels = [...new Set(posts.map((post) => post.connectionId))];

  /** The slot plus the post's own jitter, kept within the channel's */
  const goesAt = (
    post: OccupiedPost,
    slot: Date,
    cadence: ChannelCadence,
    previous: Date | null,
  ) => {
    const limit = cadence.jitterMinutes * MINUTE_MS;
    const offset = Math.max(
      -limit,
      Math.min(limit, post.goesAt.getTime() - post.at.getTime()),
    );

    return later(
      onSlotDay(new Date(slot.getTime() + offset), slot, cadence.timezone),
      base,
      previous && new Date(previous.getTime() + MINUTE_MS),
    );
  };

  // 1. Long videos, in their order, on the next allowed slots
  if (input.moveLongs) {
    for (const connectionId of channels) {
      const cadence = cadenceOf(connectionId, 'full');
      const { timezone } = cadence;
      const onChannel = posts.filter((p) => p.connectionId === connectionId);
      const queue = onChannel
        .filter((p) => p.contentType === 'full' && isMovable(p))
        .sort(byTime);
      if (queue.length === 0) continue;

      const staying = onChannel.filter(
        (p) => p.contentType === 'full' && !isMovable(p),
      );
      const blocked = onChannel.filter((p) => !isMovable(p)).map((p) => p.at);
      const ours: Date[] = [];
      let previous: Date | null = null;

      for (const post of queue) {
        const last = latest(ours);
        let from = later(
          base,
          last &&
            startOfLocalDay(
              addDays(localDate(last, timezone), cadence.minDaysBetween),
              timezone,
            ),
          last && new Date(last.getTime() + 1),
        );
        let slot: Date | null = null;

        for (let tries = 0; tries < HORIZON_DAYS; tries++) {
          const candidate = nextFreeSlot(
            cadence,
            from,
            [...staying.map((p) => p.at), ...ours],
            { blocked: [...blocked, ...ours] },
          );
          if (!candidate) break;

          const day = localDate(candidate, timezone);
          const tooClose = staying.some(
            (p) =>
              Math.abs(daysBetween(localDate(p.at, timezone), day)) <
              cadence.minDaysBetween,
          );
          if (!tooClose) {
            slot = candidate;
            break;
          }

          from = startOfLocalDay(addDays(day, 1), timezone);
        }

        if (!slot) {
          unplaced.push(post.publishId);
          continue;
        }

        ours.push(slot);
        previous = goesAt(post, slot, cadence, previous);
        placed.set(post.publishId, { slotAt: slot, scheduledAt: previous });
      }
    }
  }

  // 2. Each episode's long videos at their new times
  const longs = input.longVideos.map((long) => {
    const moved = placed.get(long.publishId);
    const pin = pinned.get(long.publishId);

    return {
      ...long,
      at: moved?.slotAt ?? (pin ? (pin.slotAt ?? pin.scheduledAt) : long.at),
    };
  });
  const anchorOn = (episodeId: string, connectionId: string) => {
    const mine = longs.filter((long) => long.episodeId === episodeId);

    return (
      earliestOf(
        mine
          .filter((long) => long.connectionId === connectionId)
          .map((long) => long.at),
      ) ?? earliestOf(mine.map((long) => long.at))
    );
  };
  const timeOf = (post: OccupiedPost) =>
    placed.get(post.publishId)?.slotAt ?? post.at;

  // 3. Each channel's Shorts queue, oldest first, behind the new times
  for (const connectionId of channels) {
    const cadence = cadenceOf(connectionId, 'short');
    const { timezone } = cadence;
    const onChannel = posts.filter((p) => p.connectionId === connectionId);
    const queue = onChannel
      .filter((p) => p.contentType === 'short' && isMovable(p))
      .sort(byTime);
    if (queue.length === 0) continue;

    const staying = onChannel.filter(
      (p) => p.contentType === 'short' && !isMovable(p),
    );
    const blocked = onChannel
      .filter((p) => p.contentType === 'full' || !isMovable(p))
      .map(timeOf);
    // Breaking Shorts hold their minute but not the day's normal limit
    const counted = staying.filter((p) => !p.breaking).map((p) => p.at);
    const before = latest(staying.filter((p) => p.at < base).map((p) => p.at));
    let origin = before ? localDate(before, timezone) : undefined;
    const ours: Date[] = [];
    let previous: Date | null = null;

    for (const post of queue) {
      const own = anchorOn(post.episodeId, connectionId);
      const floor = later(
        base,
        own && new Date(own.getTime() + cadence.startAfterHours * HOUR_MS),
      );
      const last = latest(ours);
      const slot = nextFreeSlot(
        cadence,
        later(floor, last && new Date(last.getTime() + 1)),
        [...counted, ...ours],
        { blocked: [...blocked, ...ours], origin },
      );

      if (!slot) {
        unplaced.push(post.publishId);
        continue;
      }

      origin ??= localDate(slot, timezone);
      ours.push(slot);
      previous = goesAt(post, slot, cadence, previous);
      placed.set(post.publishId, { slotAt: slot, scheduledAt: previous });
    }
  }

  const moves = posts.flatMap((post): ReplanMove[] => {
    const to = placed.get(post.publishId);

    if (
      !to ||
      (to.slotAt.getTime() === post.at.getTime() &&
        to.scheduledAt.getTime() === post.goesAt.getTime())
    ) {
      return [];
    }

    return [
      {
        publishId: post.publishId,
        connectionId: post.connectionId,
        episodeId: post.episodeId,
        contentType: post.contentType,
        fromSlotAt: post.at,
        fromScheduledAt: post.goesAt,
        slotAt: to.slotAt,
        scheduledAt: to.scheduledAt,
      },
    ];
  });

  return {
    moves: moves.sort(
      (a, b) =>
        a.scheduledAt.getTime() - b.scheduledAt.getTime() ||
        a.publishId.localeCompare(b.publishId),
    ),
    unplaced,
  };
}
