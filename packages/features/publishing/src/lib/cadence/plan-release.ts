/**
 * FILM-719, FILM-2209. Where each upload of one episode's release goes on
 * its channels' calendars.
 *
 * - A full video takes its channel's first free full-video slot from
 *   `minDaysBetween` local days after the channel's last full video, and
 *   never before it, so a later batch goes after an earlier one.
 * - Each channel has one Shorts queue, oldest first (owner, 2026-10-18): a
 *   release's Shorts go after every Short already on the channel, in the
 *   order listed, and no earlier than `startAfterHours` after their
 *   episode's long video on that channel (on a channel with none, its
 *   earliest anywhere). Nothing ends an episode's Shorts: they keep posting
 *   after the next long video, never more a day than the channel's slots,
 *   and only on every `everyNDays`th day.
 * - No two posts on a channel hold one time, whatever their type.
 * - Jitter keeps a post on its slot's local day and after the post before
 *   it on the channel.
 * - An upload with no free slot within HORIZON_DAYS is returned unplaced;
 *   the caller refuses the release rather than holding it.
 *
 * Pure: the caller reads the channels' posts and passes `now` and `random`.
 */
import {
  type CadenceContentType,
  type ChannelCadence,
  addDays,
  localDate,
  nextFreeSlot,
  onSlotDay,
  startOfLocalDay,
} from './cadence';

/** A post already on a channel's calendar */
export interface OccupiedPost {
  publishId: string;
  connectionId: string;
  episodeId: string;
  contentType: CadenceContentType;
  status: 'scheduled' | 'queued' | 'publishing' | 'published';
  /** Its slot, else when it goes (or went) out */
  at: Date;
  /** When it goes (or went) out: the slot plus its jitter */
  goesAt: Date;
}

/** When an episode's long videos go (or went) out */
export interface EpisodeAnchor {
  /** Its earliest long video on any channel */
  earliest: Date;
  /** Its earliest long video on each channel that has one */
  byChannel: ReadonlyMap<string, Date>;
}

/** One upload of the release, in the order the owner listed them */
export interface ReleaseItem {
  key: string;
  connectionId: string;
  contentType: CadenceContentType;
}

export interface PlanReleaseInput {
  episodeId: string;
  /** Nothing in the release goes earlier than this */
  notBefore: Date;
  items: readonly ReleaseItem[];
  cadenceOf: (
    connectionId: string,
    contentType: CadenceContentType,
  ) => ChannelCadence;
  /** Every post on the release's channels, by every episode */
  occupied: readonly OccupiedPost[];
  /** Each episode's long videos, this one's included when it has any */
  anchors: ReadonlyMap<string, EpisodeAnchor>;
  now: Date;
  random: () => number;
}

export interface PlacedItem {
  key: string;
  connectionId: string;
  contentType: CadenceContentType;
  slotAt: Date;
  scheduledAt: Date;
  /** A Short that waits for its episode's full video to be live */
  afterEpisodeFull: boolean;
}

/** An upload no slot was found for within HORIZON_DAYS */
export interface UnplacedItem {
  key: string;
  connectionId: string;
  contentType: CadenceContentType;
}

export interface ChannelSummary {
  connectionId: string;
  queueEndsAt: Date | null;
}

/**
 * A channel's Shorts queue after the release. When it keeps running further
 * ahead of the long videos, the episodes have more Shorts than the slots
 * between their long videos.
 */
export interface ShortsQueue {
  connectionId: string;
  /** Shorts on the channel not yet out */
  queued: number;
  lastShortAt: Date | null;
  /** The channel's last long video; on one with none, its Shorts' episodes' */
  longVideosEndAt: Date | null;
  /** Days the last Short goes after that long video, to one decimal */
  daysAhead: number | null;
}

export interface ReleasePlan {
  anchor: Date | null;
  placed: PlacedItem[];
  unplaced: UnplacedItem[];
  channels: ChannelSummary[];
  shortsQueues: ShortsQueue[];
}

/** Nothing is scheduled closer than this to now */
export const MIN_LEAD_MS = 60_000;

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
const MINUTE_MS = 60_000;

const NOT_OUT = new Set(['scheduled', 'queued', 'publishing']);

function later(...dates: Array<Date | null | undefined>) {
  const times = dates.filter((d): d is Date => !!d).map((d) => d.getTime());

  return new Date(Math.max(...times));
}

function latest(dates: readonly Date[]) {
  return dates.length
    ? new Date(Math.max(...dates.map((d) => d.getTime())))
    : null;
}

function earliestOf(dates: readonly Date[]) {
  return dates.length
    ? new Date(Math.min(...dates.map((d) => d.getTime())))
    : null;
}

/**
 * The slot plus up to ± the channel's jitter, kept on the slot's local day,
 * not before `floor`, and at least a minute after `previous`, the post
 * before it on the channel, so jitter never reorders the queue.
 */
function jittered(
  slot: Date,
  cadence: ChannelCadence,
  floor: Date,
  previous: Date | null,
  random: () => number,
) {
  const offset = Math.round((random() * 2 - 1) * cadence.jitterMinutes);

  return later(
    onSlotDay(
      new Date(slot.getTime() + offset * MINUTE_MS),
      slot,
      cadence.timezone,
    ),
    floor,
    previous && new Date(previous.getTime() + MINUTE_MS),
  );
}

export function planRelease(input: PlanReleaseInput): ReleasePlan {
  const { episodeId, items, cadenceOf, now, random, occupied } = input;
  const earliest = new Date(now.getTime() + MIN_LEAD_MS);
  const base = later(earliest, input.notBefore);

  const placed: PlacedItem[] = [];
  const unplaced: UnplacedItem[] = [];

  const postsOn = (connectionId: string, contentType?: CadenceContentType) => [
    ...occupied
      .filter(
        (post) =>
          post.connectionId === connectionId &&
          (!contentType || post.contentType === contentType),
      )
      .map((post) => ({ at: post.at, goesAt: post.goesAt })),
    ...placed
      .filter(
        (item) =>
          item.connectionId === connectionId &&
          (!contentType || item.contentType === contentType),
      )
      .map((item) => ({ at: item.slotAt, goesAt: item.scheduledAt })),
  ];
  const slotsOf = (posts: ReadonlyArray<{ at: Date }>) =>
    posts.map((post) => post.at);
  const lastGoing = (posts: ReadonlyArray<{ goesAt: Date }>) =>
    latest(posts.map((post) => post.goesAt));

  // 1. Full videos: after the channel's last one, on its local-day spacing
  for (const item of items.filter((i) => i.contentType === 'full')) {
    const cadence = cadenceOf(item.connectionId, 'full');
    const fulls = postsOn(item.connectionId, 'full');
    const lastFull = latest(slotsOf(fulls));
    const from = later(
      base,
      lastFull &&
        startOfLocalDay(
          addDays(
            localDate(lastFull, cadence.timezone),
            cadence.minDaysBetween,
          ),
          cadence.timezone,
        ),
      lastFull && new Date(lastFull.getTime() + 1),
    );
    const slot = nextFreeSlot(cadence, from, slotsOf(fulls), {
      blocked: slotsOf(postsOn(item.connectionId)),
    });

    if (!slot) {
      unplaced.push({ ...item });
      continue;
    }

    placed.push({
      key: item.key,
      connectionId: item.connectionId,
      contentType: 'full',
      slotAt: slot,
      scheduledAt: jittered(slot, cadence, earliest, lastGoing(fulls), random),
      afterEpisodeFull: false,
    });
  }

  // 2. The episode's long videos: this release's and any it already has. A
  //    Shorts-only release of an episode with none waits for nothing.
  const existing = input.anchors.get(episodeId);
  const placedFulls = placed.map((item) => item.slotAt);
  const anchor = earliestOf([
    ...placedFulls,
    ...(existing ? [existing.earliest] : []),
  ]);
  const anchorOn = (connectionId: string) =>
    earliestOf(
      placed
        .filter(
          (item) =>
            item.connectionId === connectionId && item.contentType === 'full',
        )
        .map((item) => item.slotAt),
    ) ??
    existing?.byChannel.get(connectionId) ??
    anchor;

  // 3. Shorts: each channel's queue, oldest first
  const shortItems = items.filter((i) => i.contentType === 'short');
  const shortChannels = [...new Set(shortItems.map((i) => i.connectionId))];

  for (const connectionId of shortChannels) {
    const cadence = cadenceOf(connectionId, 'short');
    const own = anchorOn(connectionId);
    const floor = later(
      base,
      own && new Date(own.getTime() + cadence.startAfterHours * HOUR_MS),
    );
    const queuedBefore = latest(slotsOf(postsOn(connectionId, 'short')));
    let origin = queuedBefore
      ? localDate(queuedBefore, cadence.timezone)
      : undefined;

    for (const item of shortItems.filter(
      (i) => i.connectionId === connectionId,
    )) {
      const shorts = postsOn(connectionId, 'short');
      const lastShort = latest(slotsOf(shorts));
      const slot = nextFreeSlot(
        cadence,
        later(floor, lastShort && new Date(lastShort.getTime() + 1)),
        slotsOf(shorts),
        { blocked: slotsOf(postsOn(connectionId)), origin },
      );

      if (!slot) {
        unplaced.push({ ...item });
        continue;
      }

      origin ??= localDate(slot, cadence.timezone);
      placed.push({
        key: item.key,
        connectionId,
        contentType: 'short',
        slotAt: slot,
        scheduledAt: jittered(slot, cadence, floor, lastGoing(shorts), random),
        afterEpisodeFull: own !== null,
      });
    }
  }

  const connectionIds = [...new Set(items.map((i) => i.connectionId))];

  const channels = connectionIds.map((connectionId) => ({
    connectionId,
    queueEndsAt: lastGoing(postsOn(connectionId)),
  }));

  const shortsQueues = connectionIds.map((connectionId): ShortsQueue => {
    const queued = [
      ...occupied.filter(
        (post) =>
          post.connectionId === connectionId &&
          post.contentType === 'short' &&
          NOT_OUT.has(post.status),
      ),
      ...placed.filter(
        (item) =>
          item.connectionId === connectionId && item.contentType === 'short',
      ),
    ];
    const lastShortAt = latest(
      queued.map((post) => ('at' in post ? post.at : post.slotAt)),
    );
    const queuedEpisodes = new Set([
      ...occupied
        .filter(
          (post) =>
            post.connectionId === connectionId && post.contentType === 'short',
        )
        .map((post) => post.episodeId),
      ...(placed.some(
        (item) =>
          item.connectionId === connectionId && item.contentType === 'short',
      )
        ? [episodeId]
        : []),
    ]);
    const longVideosEndAt =
      latest(slotsOf(postsOn(connectionId, 'full'))) ??
      latest(
        [...queuedEpisodes].flatMap((id) => {
          const at =
            id === episodeId ? anchor : input.anchors.get(id)?.earliest;
          return at ? [at] : [];
        }),
      );

    return {
      connectionId,
      queued: queued.length,
      lastShortAt,
      longVideosEndAt,
      daysAhead:
        lastShortAt && longVideosEndAt
          ? Math.max(
              0,
              Math.round(
                ((lastShortAt.getTime() - longVideosEndAt.getTime()) / DAY_MS) *
                  10,
              ) / 10,
            )
          : null,
    };
  });

  return { anchor, placed, unplaced, channels, shortsQueues };
}
