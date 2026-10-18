/**
 * FILM-719, FILM-2209. What the scheduled job does with a post that is due.
 *
 * - A Short that waits for its episode's long video goes once that video is
 *   live (on the Short's own channel when the episode has one there),
 *   waits while it is still on its way, and fails when it will never go
 *   out: no Short promotes a video nobody can watch.
 * - A post that holds a cadence slot goes while its channel has posted
 *   fewer of its type than its slots that local day. Otherwise it and the
 *   posts queued after it on the channel move on a slot each, under the
 *   channel's rules (local days, the cap, every Nth day, the spacing of
 *   long videos), so the queue keeps its order. A post scheduled by hand is
 *   the owner's explicit choice and goes.
 *
 * Environment-free: the scheduled Lambda imports it.
 */
import {
  type CadenceContentType,
  type ChannelCadence,
  type ChannelCadenceRow,
  addDays,
  localDate,
  nextFreeSlot,
  onSlotDay,
  resolveCadence,
  startOfLocalDay,
} from './cadence';

export type EpisodeFullState = 'live' | 'waiting' | 'gone';

const LIVE = new Set(['published', 'unlisted']);
const ON_ITS_WAY = new Set(['scheduled', 'queued', 'publishing']);

/** The state of an episode's long video, from its publishes' statuses */
export function episodeFullState(
  statuses: readonly string[],
): EpisodeFullState {
  if (statuses.some((status) => LIVE.has(status))) return 'live';
  if (statuses.some((status) => ON_ITS_WAY.has(status))) return 'waiting';

  return 'gone';
}

/**
 * The long videos a Short on `connectionId` waits for: the episode's on
 * that channel when it has any there, else all of them
 */
export function longVideosFor<
  T extends { platform_connection_id: string | null },
>(rows: readonly T[], connectionId: string | null) {
  const own = rows.filter(
    (row) => connectionId && row.platform_connection_id === connectionId,
  );

  return own.length ? own : rows;
}

export const LONG_VIDEO_NEVER_WENT_OUT =
  "This Short waits for its episode's long video, which did not go out. Publish the long video, then schedule the Short again.";

/**
 * The cadence a due post is held to: its channel's own, else one a day at
 * the post's own time of day, which is how the release placed it
 */
export function gateCadence(
  row: ChannelCadenceRow | null | undefined,
  contentType: CadenceContentType,
  slotAt: Date,
): ChannelCadence {
  if (row?.enabled) return resolveCadence(row, contentType, 'UTC');

  return {
    ...resolveCadence(undefined, contentType, 'UTC'),
    slotTimes: [slotAt.toISOString().slice(11, 16)],
  };
}

/** Posts of a type a channel made, or is making, on `now`'s local day */
export function postsToday(
  rows: ReadonlyArray<{ status: string; published_at: string | null }>,
  now: Date,
  timezone: string,
) {
  const since = startOfLocalDay(localDate(now, timezone), timezone).getTime();

  return rows.filter(
    (row) =>
      row.status === 'queued' ||
      row.status === 'publishing' ||
      (LIVE.has(row.status) &&
        !!row.published_at &&
        new Date(row.published_at).getTime() >= since),
  ).length;
}

export interface QueuedPost {
  id: string;
  slotAt: Date;
  scheduledAt: Date;
}

export interface MovedPost extends QueuedPost {
  from: Date;
}

/**
 * Where a due post and the posts queued after it go when its channel has
 * had its day: each to the first free slot after the one before it, from
 * the next local day, so no day passes the cap and nothing jumps the
 * queue. Each keeps its jitter. `others` are the channel's other posts of
 * this type, `blocked` the times its posts of the other type hold. Null
 * when a post finds no slot.
 *
 * FILM-2210: with `from`, the queue is laid from that time instead, and no
 * post goes earlier than the slot it held: a breaking release's Shorts
 * push the queue back, never forward.
 */
export function shiftQueue(
  cadence: ChannelCadence,
  input: {
    contentType: CadenceContentType;
    now: Date;
    queue: readonly QueuedPost[];
    others: readonly Date[];
    blocked: readonly Date[];
    from?: Date;
  },
): MovedPost[] | null {
  const { timezone } = cadence;
  const [first] = input.queue;
  if (!first) return [];

  const origin = localDate(first.slotAt, timezone);
  const taken = [...input.others];
  const moved: MovedPost[] = [];
  let from =
    input.from ??
    startOfLocalDay(addDays(localDate(input.now, timezone), 1), timezone);

  for (const post of input.queue) {
    if (input.from && post.slotAt > from) from = post.slotAt;

    const slot = nextFreeSlot(cadence, from, taken, {
      blocked: input.blocked,
      origin,
    });
    if (!slot) return null;

    const jitter = post.scheduledAt.getTime() - post.slotAt.getTime();
    moved.push({
      id: post.id,
      from: post.slotAt,
      slotAt: slot,
      scheduledAt: onSlotDay(new Date(slot.getTime() + jitter), slot, timezone),
    });
    taken.push(slot);

    // Every post goes after the last; long videos keep their days apart
    from = new Date(slot.getTime() + 1);
    if (input.contentType === 'full') {
      const spaced = startOfLocalDay(
        addDays(localDate(slot, timezone), cadence.minDaysBetween),
        timezone,
      );
      if (spaced > from) from = spaced;
    }
  }

  return moved;
}
