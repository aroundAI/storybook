/**
 * KB-204. Whether a post at a chosen time keeps its channel's posting rules:
 * no more Shorts on a channel-local day than the channel's Shorts slots, and
 * no long video closer than `minDaysBetween` local days to another long
 * video on the channel. The planner never breaks these; this is the check
 * for a post whose time the caller chose (Publish now, a staggered
 * schedule, MCP schedule_publish).
 *
 * Candidates are checked in order, and each accepted one counts against the
 * ones after it, so two Shorts in one request see each other.
 *
 * Pure: the caller reads the channels' posts and cadences.
 */
import {
  type CadenceContentType,
  type ChannelCadence,
  dailyCap,
  daysBetween,
  localDate,
} from './cadence';

/** What the Publish screen says a post past its channel's rules does instead */
export const PUBLISH_CADENCE_HINT =
  'Schedule the release instead: each post goes into its channel’s queue on its next free day.';

/** What MCP schedule_publish says instead */
export const MCP_CADENCE_HINT =
  'Use schedule_release for an episode: it puts each post in its channel’s next free slot. Pass ignoreCadence: true to post at this time anyway.';

export interface CadenceCandidate {
  key: string;
  connectionId: string;
  contentType: CadenceContentType;
  /** When it goes out */
  at: Date;
}

/** A post on the channel's calendar: when it goes, or went, out */
export interface CalendarPost {
  connectionId: string;
  contentType: CadenceContentType;
  goesAt: Date;
}

export type CadenceConflict =
  | {
      rule: 'shorts-per-day';
      key: string;
      connectionId: string;
      /** The channel-local day, YYYY-MM-DD */
      day: string;
      /** Shorts already on that day */
      posted: number;
      cap: number;
    }
  | {
      rule: 'long-spacing';
      key: string;
      connectionId: string;
      day: string;
      /** The local day of the long video it is too close to */
      nearestDay: string;
      minDaysBetween: number;
    };

export function cadenceConflicts(input: {
  candidates: readonly CadenceCandidate[];
  posts: readonly CalendarPost[];
  cadenceOf: (
    connectionId: string,
    contentType: CadenceContentType,
  ) => ChannelCadence;
}): CadenceConflict[] {
  const posts = [...input.posts];
  const conflicts: CadenceConflict[] = [];

  for (const candidate of input.candidates) {
    const cadence = input.cadenceOf(
      candidate.connectionId,
      candidate.contentType,
    );
    const day = localDate(candidate.at, cadence.timezone);
    const sameKind = posts.filter(
      (post) =>
        post.connectionId === candidate.connectionId &&
        post.contentType === candidate.contentType,
    );

    if (candidate.contentType === 'short') {
      const cap = dailyCap(cadence);
      const posted = sameKind.filter(
        (post) => localDate(post.goesAt, cadence.timezone) === day,
      ).length;

      if (posted >= cap) {
        conflicts.push({
          rule: 'shorts-per-day',
          key: candidate.key,
          connectionId: candidate.connectionId,
          day,
          posted,
          cap,
        });
        continue;
      }
    } else if (cadence.minDaysBetween > 0) {
      const nearest = sameKind
        .map((post) => localDate(post.goesAt, cadence.timezone))
        .find(
          (other) => Math.abs(daysBetween(other, day)) < cadence.minDaysBetween,
        );

      if (nearest) {
        conflicts.push({
          rule: 'long-spacing',
          key: candidate.key,
          connectionId: candidate.connectionId,
          day,
          nearestDay: nearest,
          minDaysBetween: cadence.minDaysBetween,
        });
        continue;
      }
    }

    posts.push({
      connectionId: candidate.connectionId,
      contentType: candidate.contentType,
      goesAt: candidate.at,
    });
  }

  return conflicts;
}

/** What a conflict means, in words; `name` is the channel's */
export function describeConflict(conflict: CadenceConflict, name: string) {
  if (conflict.rule === 'shorts-per-day') {
    return `${name} already has ${conflict.posted} Short${conflict.posted === 1 ? '' : 's'} on ${conflict.day}, and its posting rules allow ${conflict.cap} a day.`;
  }

  return `${name} has a long video on ${conflict.nearestDay}, and its posting rules keep long videos ${conflict.minDaysBetween} day${conflict.minDaysBetween === 1 ? '' : 's'} apart.`;
}
