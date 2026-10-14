/**
 * FILM-719. Where each upload of one episode's release goes on its channels'
 * calendars.
 *
 * - A full video takes its channel's first free full-video slot at least
 *   `minDaysBetween` after the channel's last full video.
 * - Shorts follow their own episode only (owner, 2026-10-15): on a channel,
 *   episode N's Shorts take slots from `startAfterHours` after its full video
 *   until the next episode's full video. One that does not fit is held, not
 *   dropped; and this release's full video holds an earlier episode's Shorts
 *   still scheduled after it, so two episodes' Shorts never share a channel.
 * - `append` re-queues held Shorts after everything already on the channel,
 *   with no window: the owner asked for them.
 *
 * Pure: the caller reads the channels' posts and passes `now` and `random`.
 */
import {
  type CadenceContentType,
  type ChannelCadence,
  nextFreeSlot,
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
}

/** One upload of the release, in the order the owner listed them */
export interface ReleaseItem {
  key: string;
  connectionId: string;
  contentType: CadenceContentType;
}

export interface PlanReleaseInput {
  episodeId: string;
  /** The full video goes no earlier than this */
  notBefore: Date;
  items: readonly ReleaseItem[];
  cadenceOf: (
    connectionId: string,
    contentType: CadenceContentType,
  ) => ChannelCadence;
  /** Every post on the release's channels, by every episode */
  occupied: readonly OccupiedPost[];
  /**
   * When each episode's full video goes (or went) out: its earliest one.
   * Includes this episode's, when it already has one.
   */
  anchors: ReadonlyMap<string, Date>;
  now: Date;
  random: () => number;
  mode?: 'window' | 'append';
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

export type HeldReason = 'next-episode' | 'no-slot';

export interface HeldItem {
  key: string;
  connectionId: string;
  reason: HeldReason;
  /** The next episode's full video the Short would have gone after */
  before: Date | null;
}

export interface BumpedPost {
  publishId: string;
  connectionId: string;
  episodeId: string;
  before: Date;
}

export interface ChannelSummary {
  connectionId: string;
  queueEndsAt: Date | null;
}

export interface ReleasePlan {
  anchor: Date | null;
  placed: PlacedItem[];
  held: HeldItem[];
  bumped: BumpedPost[];
  channels: ChannelSummary[];
}

/** Nothing is scheduled closer than this to now */
export const MIN_LEAD_MS = 60_000;

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
const MINUTE_MS = 60_000;

function later(...dates: Array<Date | null | undefined>) {
  const times = dates.filter((d): d is Date => !!d).map((d) => d.getTime());

  return new Date(Math.max(...times));
}

function jittered(
  slot: Date,
  cadence: ChannelCadence,
  floor: Date,
  random: () => number,
) {
  const offset = Math.round((random() * 2 - 1) * cadence.jitterMinutes);

  return later(new Date(slot.getTime() + offset * MINUTE_MS), floor);
}

export function planRelease(input: PlanReleaseInput): ReleasePlan {
  const { episodeId, items, cadenceOf, now, random } = input;
  const mode = input.mode ?? 'window';
  const earliest = new Date(now.getTime() + MIN_LEAD_MS);

  const placed: PlacedItem[] = [];
  const held: HeldItem[] = [];
  const bumped: BumpedPost[] = [];

  // Posts this plan treats as taken; bumped ones leave it below
  let occupied = [...input.occupied];

  const takenOn = (connectionId: string, contentType: CadenceContentType) => [
    ...occupied
      .filter(
        (post) =>
          post.connectionId === connectionId &&
          post.contentType === contentType,
      )
      .map((post) => post.at),
    ...placed
      .filter(
        (item) =>
          item.connectionId === connectionId &&
          item.contentType === contentType,
      )
      .map((item) => item.slotAt),
  ];

  // 1. Full videos
  for (const item of items.filter((i) => i.contentType === 'full')) {
    const cadence = cadenceOf(item.connectionId, 'full');
    const taken = takenOn(item.connectionId, 'full');
    const lastFull = taken.length
      ? new Date(Math.max(...taken.map((at) => at.getTime())))
      : null;
    const from = later(
      input.notBefore,
      earliest,
      lastFull &&
        new Date(lastFull.getTime() + cadence.minDaysBetween * DAY_MS),
    );
    const slot = nextFreeSlot(cadence, from, taken);

    if (!slot) {
      held.push({
        key: item.key,
        connectionId: item.connectionId,
        reason: 'no-slot',
        before: null,
      });
      continue;
    }

    placed.push({
      key: item.key,
      connectionId: item.connectionId,
      contentType: 'full',
      slotAt: slot,
      scheduledAt: jittered(slot, cadence, earliest, random),
      afterEpisodeFull: false,
    });
  }

  // 2. The episode's anchor: its earliest full video, this release's or one
  //    it already has. A Shorts-only release of an episode with none starts
  //    at `notBefore` and waits for nothing.
  const placedFulls = placed.map((item) => item.slotAt.getTime());
  const existingAnchor = input.anchors.get(episodeId) ?? null;
  const anchorTimes = [
    ...placedFulls,
    ...(existingAnchor ? [existingAnchor.getTime()] : []),
  ];
  const anchor = anchorTimes.length ? new Date(Math.min(...anchorTimes)) : null;
  const afterEpisodeFull = anchor !== null;

  const shortItems = items.filter((i) => i.contentType === 'short');
  const shortChannels = [...new Set(shortItems.map((i) => i.connectionId))];

  // 3. This episode's full video ends earlier episodes' windows: their
  //    Shorts still scheduled at or after it are held
  if (mode === 'window' && anchor) {
    for (const connectionId of shortChannels) {
      for (const post of occupied) {
        if (
          post.connectionId !== connectionId ||
          post.contentType !== 'short' ||
          post.status !== 'scheduled' ||
          post.episodeId === episodeId
        ) {
          continue;
        }

        const theirs = input.anchors.get(post.episodeId);

        if (
          theirs &&
          theirs.getTime() < anchor.getTime() &&
          post.at.getTime() >= anchor.getTime()
        ) {
          bumped.push({
            publishId: post.publishId,
            connectionId,
            episodeId: post.episodeId,
            before: anchor,
          });
        }
      }
    }

    const bumpedIds = new Set(bumped.map((post) => post.publishId));
    occupied = occupied.filter((post) => !bumpedIds.has(post.publishId));
  }

  // 4. Shorts, channel by channel, in the order listed
  for (const connectionId of shortChannels) {
    const cadence = cadenceOf(connectionId, 'short');
    const floor = later(
      earliest,
      input.notBefore,
      anchor && new Date(anchor.getTime() + cadence.startAfterHours * HOUR_MS),
    );

    let windowEnd: Date | null = null;
    let cursor = floor;

    if (mode === 'window') {
      // The next episode's full video after this one's, among the episodes
      // with posts on this channel
      const episodesHere = new Set(
        occupied
          .filter((post) => post.connectionId === connectionId)
          .map((post) => post.episodeId),
      );
      const reference = anchor ?? floor;
      const nextAnchors = [...episodesHere]
        .filter((id) => id !== episodeId)
        .map((id) => input.anchors.get(id))
        .filter((at): at is Date => !!at && at.getTime() > reference.getTime())
        .map((at) => at.getTime());

      windowEnd = nextAnchors.length
        ? new Date(Math.min(...nextAnchors))
        : null;
    } else {
      const shortsHere = takenOn(connectionId, 'short');
      if (shortsHere.length) {
        cursor = later(
          cursor,
          new Date(Math.max(...shortsHere.map((at) => at.getTime())) + 1),
        );
      }
    }

    for (const item of shortItems.filter(
      (i) => i.connectionId === connectionId,
    )) {
      const slot = nextFreeSlot(
        cadence,
        cursor,
        takenOn(connectionId, 'short'),
      );

      if (!slot || (windowEnd && slot.getTime() >= windowEnd.getTime())) {
        held.push({
          key: item.key,
          connectionId,
          reason: slot ? 'next-episode' : 'no-slot',
          before: windowEnd,
        });
        continue;
      }

      placed.push({
        key: item.key,
        connectionId,
        contentType: 'short',
        slotAt: slot,
        scheduledAt: jittered(slot, cadence, floor, random),
        afterEpisodeFull,
      });
      cursor = slot;
    }
  }

  const connectionIds = [...new Set(items.map((i) => i.connectionId))];
  const channels = connectionIds.map((connectionId) => {
    const times = [
      ...occupied
        .filter((post) => post.connectionId === connectionId)
        .map((post) => post.at.getTime()),
      ...placed
        .filter((item) => item.connectionId === connectionId)
        .map((item) => item.scheduledAt.getTime()),
    ];

    return {
      connectionId,
      queueEndsAt: times.length ? new Date(Math.max(...times)) : null,
    };
  });

  return { anchor, placed, held, bumped, channels };
}
