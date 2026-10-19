/**
 * FILM-2211. The Schedule page's pure parts: what its URL asks for, the one
 * line that says how a channel posts, and how a post's status reads.
 *
 * Environment-free: the page, its client components and the calendar
 * service import it.
 */
import {
  type CadenceContentType,
  type ChannelCadence,
  DEFAULT_CADENCE,
} from './cadence/cadence';
import { takesVideo } from './constants';
import { isOfferedPlatform } from './platforms';

/** The longest span one calendar read covers (the MCP tool's cap too) */
export const MAX_CALENDAR_DAYS = 62;

export const SCHEDULE_TYPES = ['all', 'long', 'short'] as const;
export type ScheduleType = (typeof SCHEDULE_TYPES)[number];

export const SCHEDULE_STATUSES = [
  'scheduled',
  'queued',
  'publishing',
  'published',
  'failed',
  'held',
  'deleted',
] as const;
export type ScheduleStatus = (typeof SCHEDULE_STATUSES)[number];

const DAY_MS = 86_400_000;
const DAYS_BACK = 7;
const DAYS_AHEAD = 30;

export interface ScheduleFilters {
  type: ScheduleType;
  platform: string | null;
  status: ScheduleStatus | null;
  /** YYYY-MM-DD, UTC days */
  from: string;
  to: string;
  /** The asked range was longer than MAX_CALENDAR_DAYS and was cut */
  clamped: boolean;
  /** KB-207: posts of deleted episodes are shown too (`deleted=1`) */
  deletedEpisodes: boolean;
  range: { from: Date; to: Date };
}

type SearchParams = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function oneOf<T extends string>(values: readonly T[], value?: string) {
  return values.find((v) => v === value) ?? null;
}

function dayOf(at: Date) {
  return at.toISOString().slice(0, 10);
}

function parseDay(value: string | undefined) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;

  const at = new Date(`${value}T00:00:00Z`);

  // 2026-02-31 parses, as March: only a day that reads back the same is one
  return !isNaN(at.getTime()) && dayOf(at) === value ? at : null;
}

/** The page's filters from its search params: anything unknown is ignored */
export function parseScheduleFilters(
  params: SearchParams,
  now: Date,
): ScheduleFilters {
  const today = parseDay(dayOf(now))!;
  let from =
    parseDay(first(params.from)) ??
    new Date(today.getTime() - DAYS_BACK * DAY_MS);
  let to =
    parseDay(first(params.to)) ??
    new Date(today.getTime() + DAYS_AHEAD * DAY_MS);

  if (to < from) [from, to] = [to, from];

  // The read ends at the end of `to`, so the last day counts whole
  const lastDay = new Date(from.getTime() + (MAX_CALENDAR_DAYS - 1) * DAY_MS);
  const clamped = to > lastDay;
  if (clamped) to = lastDay;

  const platform = first(params.platform);

  return {
    type: oneOf(SCHEDULE_TYPES, first(params.type)) ?? 'all',
    platform: platform && isOfferedPlatform(platform) ? platform : null,
    status: oneOf(SCHEDULE_STATUSES, first(params.status)),
    from: dayOf(from),
    to: dayOf(to),
    clamped,
    deletedEpisodes: first(params.deleted) === '1',
    range: { from, to: new Date(to.getTime() + DAY_MS - 1) },
  };
}

/**
 * A post the filters keep: by type (long is anything not a Short), platform
 * and status. A deleted episode's post only when asked for (KB-207).
 */
export function matchesScheduleFilters(
  post: {
    contentType: string;
    platform: string;
    status: string;
    episodeDeleted?: boolean;
  },
  filters: Pick<ScheduleFilters, 'type' | 'platform' | 'status'> & {
    deletedEpisodes?: boolean;
  },
) {
  const short = post.contentType === 'short';

  if (post.episodeDeleted && !filters.deletedEpisodes) return false;
  if (filters.type === 'short' && !short) return false;
  if (filters.type === 'long' && short) return false;
  if (filters.platform && post.platform !== filters.platform) return false;
  if (filters.status && post.status !== filters.status) return false;

  return true;
}

export interface CadenceSummaryInput {
  contentType: CadenceContentType;
  own: boolean;
  enabled: boolean;
  cadence: Omit<ChannelCadence, 'timezone'> & { timezone: string | null };
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function every(days: number) {
  return days <= 1 ? 'daily' : `every ${days} days`;
}

/**
 * How a channel posts, in one line: "Long 20:00 every 3 days · Shorts
 * 11:00, 17:00 daily, from 2 h after · Asia/Kolkata". A type with no saved
 * rules, or with them switched off, posts on the defaults and says so. A
 * type the platform does not take (Instagram's long videos) is left out.
 */
export function cadenceSummary(
  cadences: CadenceSummaryInput[],
  platform: string,
) {
  const parts = (['full', 'short'] as const).flatMap((contentType) => {
    const state = cadences.find((c) => c.contentType === contentType);
    if (!state || !takesVideo(contentType, platform)) return [];

    // Saved rules switched off are kept, but the defaults are what apply
    const applies = state.own && state.enabled;
    const cadence = applies ? state.cadence : DEFAULT_CADENCE[contentType];
    const days =
      cadence.daysOfWeek.length < 7
        ? ` on ${[...cadence.daysOfWeek]
            .sort()
            .map((d) => WEEKDAYS[d])
            .join(', ')}`
        : '';

    const text =
      contentType === 'full'
        ? `Long ${cadence.slotTimes.join(', ')} ${every(cadence.minDaysBetween)}${days}`
        : `Shorts ${cadence.slotTimes.join(', ')} ${every(cadence.everyNDays)}${days}${
            cadence.startAfterHours > 0
              ? `, from ${cadence.startAfterHours} h after`
              : ''
          }`;

    return [
      { text, timezone: applies ? state.cadence.timezone : null, applies },
    ];
  });

  const zones = new Set(parts.map((part) => part.timezone));
  const shared = zones.size === 1 ? [...zones][0] : null;

  const line = parts
    .map((part) => {
      if (!part.applies) return `${part.text} (default)`;
      return shared || !part.timezone
        ? part.text
        : `${part.text} (${part.timezone})`;
    })
    .join(' · ');

  return shared ? `${line} · ${shared}` : line;
}

export type StatusTone = 'neutral' | 'success' | 'danger' | 'warning';

const STATUS_LABELS: Record<string, { label: string; tone: StatusTone }> = {
  draft: { label: 'Draft', tone: 'neutral' },
  scheduled: { label: 'Scheduled', tone: 'neutral' },
  queued: { label: 'Queued', tone: 'neutral' },
  publishing: { label: 'Publishing', tone: 'neutral' },
  published: { label: 'Published', tone: 'success' },
  unlisted: { label: 'Unlisted', tone: 'neutral' },
  failed: { label: 'Failed', tone: 'danger' },
  held: { label: 'Held', tone: 'warning' },
  deleting: { label: 'Taking down', tone: 'neutral' },
  deleted: { label: 'Removed', tone: 'neutral' },
};

/** How a calendar post's status reads on the page */
export function scheduleStatusOf(status: string) {
  return STATUS_LABELS[status] ?? { label: status, tone: 'neutral' as const };
}
