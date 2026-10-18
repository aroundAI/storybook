/**
 * FILM-719. A channel's posting cadence: when it may post, and how often.
 *
 * Spam risk is a channel's, so the rule is the channel's: one row per
 * (channel, content type) in `channel_posting_cadences`, and a channel with
 * no row posts on the defaults below. Slots are wall-clock times in the
 * channel's timezone; how many there are is the most that channel posts of
 * that type in one day.
 *
 * Environment-free and without `server-only`: the Publish screen, the
 * schedule action and the scheduled Lambda all import it.
 */
import { formatInTimeZone, fromZonedTime } from 'date-fns-tz';

export type CadenceContentType = 'full' | 'short';

export interface ChannelCadence {
  timezone: string;
  /** 'HH:MM' in `timezone`, ascending; their count is the daily cap */
  slotTimes: string[];
  /** 0 = Sunday … 6 = Saturday */
  daysOfWeek: number[];
  /** Full videos: a long video every this many local days */
  minDaysBetween: number;
  /** Shorts: post on every Nth local day, counted from the channel's queue */
  everyNDays: number;
  /** Shorts: not before this long after the episode's full video */
  startAfterHours: number;
  /** ± this many minutes, so posts do not land on the minute */
  jitterMinutes: number;
}

/** The columns of a `channel_posting_cadences` row the planner reads */
export interface ChannelCadenceRow {
  platform_connection_id: string;
  content_type: string;
  timezone: string;
  slot_times: string[];
  days_of_week: number[];
  min_days_between: number;
  every_n_days: number;
  start_after_hours: number;
  jitter_minutes: number;
  enabled: boolean;
}

export const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];

export const DEFAULT_CADENCE: Record<
  CadenceContentType,
  Omit<ChannelCadence, 'timezone'>
> = {
  full: {
    slotTimes: ['17:00'],
    daysOfWeek: ALL_DAYS,
    minDaysBetween: 3,
    everyNDays: 1,
    startAfterHours: 0,
    jitterMinutes: 20,
  },
  short: {
    slotTimes: ['18:00'],
    daysOfWeek: ALL_DAYS,
    minDaysBetween: 0,
    everyNDays: 1,
    startAfterHours: 2,
    jitterMinutes: 20,
  },
};

export const SLOT_TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

export function isValidTimeZone(timezone: string) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

/**
 * The cadence a channel posts on: its own row when it has an enabled one,
 * else the defaults in `fallbackTimezone`.
 */
export function resolveCadence(
  row: ChannelCadenceRow | undefined,
  contentType: CadenceContentType,
  fallbackTimezone: string,
): ChannelCadence {
  const defaults = DEFAULT_CADENCE[contentType];

  if (!row || !row.enabled) {
    return {
      ...defaults,
      timezone: isValidTimeZone(fallbackTimezone) ? fallbackTimezone : 'UTC',
    };
  }

  return {
    timezone: isValidTimeZone(row.timezone) ? row.timezone : 'UTC',
    slotTimes: [...row.slot_times].sort(),
    daysOfWeek: row.days_of_week,
    minDaysBetween: row.min_days_between,
    everyNDays: Math.max(1, row.every_n_days),
    startAfterHours: row.start_after_hours,
    jitterMinutes: row.jitter_minutes,
  };
}

/** The most a channel posts of one type in one local day */
export function dailyCap(cadence: ChannelCadence) {
  return Math.max(1, cadence.slotTimes.length);
}

export function localDate(at: Date, timezone: string) {
  return formatInTimeZone(at, timezone, 'yyyy-MM-dd');
}

/** The local date `days` after `isoDate` (YYYY-MM-DD): calendar days, not 24-hour steps */
export function addDays(isoDate: string, days: number) {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);

  return date.toISOString().slice(0, 10);
}

/** Calendar days from one local date to another */
export function daysBetween(fromIsoDate: string, toIsoDate: string) {
  return Math.round(
    (Date.parse(`${toIsoDate}T00:00:00Z`) -
      Date.parse(`${fromIsoDate}T00:00:00Z`)) /
      86_400_000,
  );
}

/** Midnight at the start of a local date in `timezone` */
export function startOfLocalDay(isoDate: string, timezone: string) {
  return fromZonedTime(`${isoDate}T00:00:00`, timezone);
}

/**
 * `at`, kept on `slot`'s local day: a post jittered or moved past midnight
 * would count against the next day's cap
 */
export function onSlotDay(at: Date, slot: Date, timezone: string) {
  const day = localDate(slot, timezone);
  const start = startOfLocalDay(day, timezone).getTime();
  const end = startOfLocalDay(addDays(day, 1), timezone).getTime() - 60_000;

  return new Date(Math.min(Math.max(at.getTime(), start), end));
}

function weekday(isoDate: string) {
  return new Date(`${isoDate}T00:00:00Z`).getUTCDay();
}

/** How far ahead a slot is looked for before the planner gives up */
export const HORIZON_DAYS = 365;

export interface SlotRules {
  /**
   * Every post on the channel, of any type: two posts never hold one time,
   * which the slot index would refuse
   */
  blocked?: readonly Date[];
  /**
   * The local date `everyNDays` counts from. Without one, the first free
   * slot is the start of the count.
   */
  origin?: string;
}

/**
 * The first slot at or after `from` that is free: on an allowed weekday and
 * on every Nth day, not already taken by any post, and on a local day that
 * has not reached the cap. `taken` is every post of this type on the
 * channel, by its slot (or, for a post scheduled without one, the time it
 * goes out), so a hand-scheduled post still uses up its day.
 */
export function nextFreeSlot(
  cadence: ChannelCadence,
  from: Date,
  taken: readonly Date[],
  rules: SlotRules = {},
): Date | null {
  const { timezone } = cadence;
  const cap = dailyCap(cadence);
  const every = Math.max(1, cadence.everyNDays);
  const perDay = new Map<string, number>();
  const exact = new Set<number>();

  for (const at of taken) {
    const day = localDate(at, timezone);
    perDay.set(day, (perDay.get(day) ?? 0) + 1);
    exact.add(at.getTime());
  }
  for (const at of rules.blocked ?? []) exact.add(at.getTime());

  const firstDay = localDate(from, timezone);
  const { origin } = rules;

  for (let offset = 0; offset < HORIZON_DAYS; offset++) {
    const day = addDays(firstDay, offset);

    if (origin && ((daysBetween(origin, day) % every) + every) % every !== 0) {
      continue;
    }
    if (!cadence.daysOfWeek.includes(weekday(day))) continue;
    if ((perDay.get(day) ?? 0) >= cap) continue;

    for (const time of cadence.slotTimes) {
      const slot = fromZonedTime(`${day}T${time}:00`, timezone);

      if (slot.getTime() < from.getTime()) continue;
      if (exact.has(slot.getTime())) continue;

      return slot;
    }
  }

  return null;
}
