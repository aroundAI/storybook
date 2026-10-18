/**
 * FILM-2210. A breaking-news release: an episode that goes out ahead of
 * what is already scheduled (owner, 2026-10-18).
 *
 * - Its long video goes at `at` (default: the next scheduler run) on each
 *   of its channels, whatever the long-video spacing and daily limit say.
 *   No scheduled long video moves.
 * - Its Shorts go to the front of each channel's Shorts queue, from
 *   `startAfterHours` after their long video. For `boost.days` days the
 *   channel gets `boost.extraPerDay` extra Short times a day, spread into
 *   the widest gaps of its day; only breaking Shorts use them. Breaking
 *   Shorts left over after the boost take normal times.
 * - The channel's scheduled normal Shorts from the first breaking Short on
 *   are laid again in their order on the normal times the breaking Shorts
 *   left (shiftQueue), never earlier than they were. Breaking Shorts on a
 *   boost day do not count toward its normal limit; after the boost the
 *   normal limit holds for every day.
 * - Posts already queued, publishing or published, and posts scheduled by
 *   hand, stay where they are.
 *
 * Pure: the caller reads the channels' posts and passes `now` and `random`.
 */
import { formatInTimeZone, fromZonedTime } from 'date-fns-tz';

import {
  type CadenceContentType,
  type ChannelCadence,
  addDays,
  localDate,
  nextFreeSlot,
  startOfLocalDay,
} from './cadence';
import { shiftQueue } from './dispatch';
import {
  type EpisodeAnchor,
  MIN_LEAD_MS,
  type OccupiedPost,
  type ReleaseItem,
  type UnplacedItem,
  earliestOf,
  jittered,
  later,
  latest,
} from './plan-release';

export interface BreakingBoost {
  /** Extra Short times a day, used only by breaking Shorts */
  extraPerDay: number;
  /** For this many local days from the first breaking Short */
  days: number;
}

export const BREAKING_DEFAULTS = {
  boost: { extraPerDay: 2, days: 3 },
  startAfterHours: 1,
} as const;

export interface PlanBreakingInput {
  episodeId: string;
  /** When the long video goes; the next scheduler run when absent */
  at?: Date | null;
  boost: BreakingBoost;
  /** Hours after its long video before the first breaking Short */
  startAfterHours: number;
  items: readonly ReleaseItem[];
  cadenceOf: (
    connectionId: string,
    contentType: CadenceContentType,
  ) => ChannelCadence;
  /** Every post on the release's channels, by every episode */
  occupied: readonly OccupiedPost[];
  anchors: ReadonlyMap<string, EpisodeAnchor>;
  now: Date;
  random: () => number;
}

export interface BreakingPlacedItem {
  key: string;
  connectionId: string;
  contentType: CadenceContentType;
  /** Null for the long video: it holds its own time, not a cadence slot */
  slotAt: Date | null;
  scheduledAt: Date;
  afterEpisodeFull: boolean;
  /** A Short on one of the boost's extra times */
  extra: boolean;
}

/** A scheduled Short the breaking release moves back */
export interface MovedShort {
  publishId: string;
  connectionId: string;
  episodeId: string;
  fromSlotAt: Date;
  fromScheduledAt: Date;
  slotAt: Date;
  scheduledAt: Date;
}

export interface QueueState {
  /** Shorts on the channel not yet out */
  queued: number;
  lastShortAt: Date | null;
}

export interface BreakingQueue {
  connectionId: string;
  before: QueueState;
  after: QueueState;
}

export interface BreakingPlan {
  anchor: Date | null;
  placed: BreakingPlacedItem[];
  unplaced: UnplacedItem[];
  moves: MovedShort[];
  queues: BreakingQueue[];
}

const HOUR_MS = 3_600_000;
const NOT_OUT = new Set(['scheduled', 'queued', 'publishing']);

/** The extra times are spread over at least this part of the day */
const BOOST_DAY = { start: 9 * 60, end: 21 * 60 };

const toMinutes = (time: string) =>
  Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));

const toTime = (minutes: number) =>
  `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;

/**
 * A boost day's Short times: the channel's own, and `extra` more, each in
 * the middle of the widest gap left between 09:00 and 21:00 (or the
 * channel's first and last time, when wider), on a 5-minute grid
 */
export function boostDayTimes(slotTimes: readonly string[], extra: number) {
  const own = [...new Set(slotTimes.map(toMinutes))].sort((a, b) => a - b);
  const start = Math.min(BOOST_DAY.start, own[0] ?? BOOST_DAY.start);
  const end = Math.max(BOOST_DAY.end, own[own.length - 1] ?? BOOST_DAY.end);
  const points = [...new Set([start, ...own, end])].sort((a, b) => a - b);
  const extras: number[] = [];

  for (let i = 0; i < extra; i++) {
    let widest = 0;
    for (let g = 1; g < points.length - 1; g++) {
      if (points[g + 1]! - points[g]! > points[widest + 1]! - points[widest]!) {
        widest = g;
      }
    }

    const lo = points[widest]!;
    const hi = points[widest + 1]!;
    const middle = Math.round((lo + hi) / 2 / 5) * 5;
    if (middle <= lo || middle >= hi) break;

    extras.push(middle);
    points.splice(widest + 1, 0, middle);
  }

  return [
    ...own.map((minutes) => ({ time: toTime(minutes), extra: false })),
    ...extras.map((minutes) => ({ time: toTime(minutes), extra: true })),
  ].sort((a, b) => a.time.localeCompare(b.time));
}

function weekday(isoDate: string) {
  return new Date(`${isoDate}T00:00:00Z`).getUTCDay();
}

export function planBreakingRelease(input: PlanBreakingInput): BreakingPlan {
  const { episodeId, items, cadenceOf, now, random, occupied } = input;
  const earliest = new Date(now.getTime() + MIN_LEAD_MS);
  const at = later(earliest, input.at);

  const placed: BreakingPlacedItem[] = [];
  const unplaced: UnplacedItem[] = [];
  const moves: MovedShort[] = [];

  // 1. Long videos: at their time, past the channel's spacing and limit
  for (const item of items.filter((i) => i.contentType === 'full')) {
    const taken = placed.filter(
      (p) => p.connectionId === item.connectionId && p.contentType === 'full',
    ).length;

    placed.push({
      key: item.key,
      connectionId: item.connectionId,
      contentType: 'full',
      slotAt: null,
      scheduledAt: new Date(at.getTime() + taken * 60_000),
      afterEpisodeFull: false,
      extra: false,
    });
  }

  // 2. The long video each channel's Shorts wait for
  const existing = input.anchors.get(episodeId);
  const anchor = earliestOf([
    ...placed.map((p) => p.scheduledAt),
    ...(existing ? [existing.earliest] : []),
  ]);
  const anchorOn = (connectionId: string) =>
    earliestOf(
      placed
        .filter((p) => p.connectionId === connectionId)
        .map((p) => p.scheduledAt),
    ) ??
    existing?.byChannel.get(connectionId) ??
    anchor;

  // 3. Shorts: the front of each channel's queue
  const shortItems = items.filter((i) => i.contentType === 'short');
  const shortChannels = [...new Set(shortItems.map((i) => i.connectionId))];

  for (const connectionId of shortChannels) {
    const cadence = cadenceOf(connectionId, 'short');
    const { timezone } = cadence;
    const own = anchorOn(connectionId);
    const floor = later(
      at,
      own && new Date(own.getTime() + input.startAfterHours * HOUR_MS),
    );
    const onChannel = occupied.filter((p) => p.connectionId === connectionId);
    const movable = (p: OccupiedPost) =>
      p.contentType === 'short' &&
      p.status === 'scheduled' &&
      p.slotted !== false &&
      !p.breaking &&
      p.at >= floor;

    // Every time a post that stays holds, and the long videos placed here
    const fixed = [
      ...onChannel.filter((p) => !movable(p)).map((p) => p.at),
      ...placed
        .filter((p) => p.connectionId === connectionId)
        .map((p) => p.scheduledAt),
    ];
    const isFixed = (slot: Date) =>
      fixed.some((t) => t.getTime() === slot.getTime());

    const times = boostDayTimes(cadence.slotTimes, input.boost.extraPerDay);
    let firstDay = localDate(floor, timezone);
    if (
      !times.some(
        ({ time }) =>
          fromZonedTime(`${firstDay}T${time}:00`, timezone) >= floor,
      )
    ) {
      firstDay = addDays(firstDay, 1);
    }
    const boostDays = new Set(
      Array.from({ length: input.boost.days }, (_, i) => addDays(firstDay, i)),
    );

    const mine = shortItems.filter((i) => i.connectionId === connectionId);
    const ours: BreakingPlacedItem[] = [];
    let previous: Date | null = null;

    const place = (item: ReleaseItem, slot: Date, extra: boolean) => {
      const scheduledAt = jittered(slot, cadence, floor, previous, random);
      previous = scheduledAt;
      ours.push({
        key: item.key,
        connectionId,
        contentType: 'short',
        slotAt: slot,
        scheduledAt,
        afterEpisodeFull: own !== null,
        extra,
      });
    };

    // 3a. The boost days: every time, normal and extra, in order
    let next = 0;
    for (const day of boostDays) {
      if (!cadence.daysOfWeek.includes(weekday(day))) continue;

      for (const { time, extra } of times) {
        const item = mine[next];
        if (!item) break;

        const slot = fromZonedTime(`${day}T${time}:00`, timezone);
        if (slot < floor || isFixed(slot)) continue;

        place(item, slot, extra);
        next++;
      }
    }

    // 3b. Any left: normal times, still ahead of the normal queue
    const queue = onChannel
      .filter(movable)
      .sort((a, b) => a.at.getTime() - b.at.getTime());
    const sameTypeFixed = onChannel
      .filter((p) => p.contentType === 'short' && !movable(p) && !p.breaking)
      .map((p) => p.at);
    const origin = queue[0] && localDate(queue[0].at, timezone);
    const countsTowardDay = () =>
      ours
        .filter((p) => !boostDays.has(localDate(p.slotAt!, timezone)))
        .map((p) => p.slotAt!);

    const afterBoost = startOfLocalDay(
      addDays(firstDay, input.boost.days),
      timezone,
    );

    for (const item of mine.slice(next)) {
      const lastOurs = latest(ours.map((p) => p.slotAt!));
      const slot = nextFreeSlot(
        cadence,
        later(floor, afterBoost, lastOurs && new Date(lastOurs.getTime() + 1)),
        [...sameTypeFixed, ...countsTowardDay()],
        {
          blocked: [...fixed, ...ours.map((p) => p.slotAt!)],
          origin,
        },
      );

      if (!slot) {
        unplaced.push({ ...item });
        continue;
      }

      place(item, slot, false);
    }

    placed.push(...ours);

    // 4. The normal Shorts from the first breaking Short on move back
    const first = earliestOf(ours.map((p) => p.slotAt!));
    const behind = first ? queue.filter((p) => p.at >= first) : [];
    const shifted = first
      ? shiftQueue(cadence, {
          contentType: 'short',
          now,
          from: first,
          queue: behind.map((p) => ({
            id: p.publishId,
            slotAt: p.at,
            scheduledAt: p.goesAt,
          })),
          others: [...sameTypeFixed, ...countsTowardDay()],
          blocked: [
            ...fixed,
            ...ours.map((p) => p.slotAt!),
            ...queue.filter((p) => p.at < first).map((p) => p.at),
          ],
        })
      : [];

    if (!shifted) {
      for (const item of ours) unplaced.push({ ...item });
      placed.splice(placed.length - ours.length, ours.length);
      continue;
    }

    for (const post of shifted) {
      if (post.slotAt.getTime() === post.from.getTime()) continue;

      const old = behind.find((p) => p.publishId === post.id)!;
      moves.push({
        publishId: post.id,
        connectionId,
        episodeId: old.episodeId,
        fromSlotAt: post.from,
        fromScheduledAt: old.goesAt,
        slotAt: post.slotAt,
        scheduledAt: post.scheduledAt,
      });
    }
  }

  const connectionIds = [...new Set(items.map((i) => i.connectionId))];
  const queues = connectionIds.map((connectionId): BreakingQueue => {
    const notOut = occupied.filter(
      (p) =>
        p.connectionId === connectionId &&
        p.contentType === 'short' &&
        NOT_OUT.has(p.status),
    );
    const movedTo = (p: OccupiedPost) =>
      moves.find((m) => m.publishId === p.publishId)?.slotAt ?? p.at;
    const breakingShorts = placed.filter(
      (p) => p.connectionId === connectionId && p.contentType === 'short',
    );

    return {
      connectionId,
      before: {
        queued: notOut.length,
        lastShortAt: latest(notOut.map((p) => p.at)),
      },
      after: {
        queued: notOut.length + breakingShorts.length,
        lastShortAt: latest([
          ...notOut.map(movedTo),
          ...breakingShorts.map((p) => p.slotAt!),
        ]),
      },
    };
  });

  return { anchor, placed, unplaced, moves, queues };
}

/** YouTube's daily upload budget: 10,000 quota units ÷ 1,600 per upload */
export const YOUTUBE_UPLOADS_PER_DAY = 6;

/**
 * The uploads a Pacific day may hold before a release warns (FILM-2212):
 * `YOUTUBE_DAILY_UPLOAD_WARN`, a positive whole number, server-only. Unset
 * or anything else is YouTube's default budget, 6. Set it when Google
 * grants the project more quota. It only moves the warning: nothing is
 * refused either way.
 */
export function youtubeDailyUploadWarnAt(value: string | undefined): number {
  const parsed = Number(value);

  return Number.isInteger(parsed) && parsed > 0
    ? parsed
    : YOUTUBE_UPLOADS_PER_DAY;
}

/** YouTube's quota day starts at midnight Pacific time */
const QUOTA_TIMEZONE = 'America/Los_Angeles';

export interface QuotaDay {
  /** The Pacific-time date */
  day: string;
  uploads: number;
  /** The uploads a day may hold before it warns */
  limit: number;
}

/**
 * The quota days with more YouTube uploads than the budget, across the
 * team's YouTube channels. It warns; it does not stop the release.
 */
export function youtubeQuotaWarnings(
  uploads: readonly Date[],
  limit = YOUTUBE_UPLOADS_PER_DAY,
): QuotaDay[] {
  const perDay = new Map<string, number>();

  for (const at of uploads) {
    const day = formatInTimeZone(at, QUOTA_TIMEZONE, 'yyyy-MM-dd');
    perDay.set(day, (perDay.get(day) ?? 0) + 1);
  }

  return [...perDay]
    .filter(([, count]) => count > limit)
    .map(([day, count]) => ({ day, uploads: count, limit }))
    .sort((a, b) => a.day.localeCompare(b.day));
}
