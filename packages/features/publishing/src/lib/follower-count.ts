import { formatFollowers } from './platform-limits';
import type { FollowerCountSource } from './types';

/**
 * How a connection's follower count is described wherever it is shown
 * (FILM-1617): a measured or reconstructed level is dated by its newest data,
 * and a count stored at connection time is marked as not live.
 */

export type { FollowerCountSource };

const SOURCE_LABEL: Record<FollowerCountSource, string> = {
  snapshot: 'Measured',
  reconstructed: 'Reconstructed from daily movement',
  metadata: 'Stored when the account was connected, not live',
};

/** `YYYY-MM-DD` as "Sep 12, 2026", read in UTC so it never shifts a day. */
function formatDay(date: string): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

/**
 * How old a measured count may be before it is marked as old. A week clears
 * YouTube's usual 2-3 day reporting lag, so a healthy channel is never
 * marked; a disconnected one, or one whose capture broke, soon is.
 */
export const FOLLOWER_COUNT_FRESH_DAYS = 7;

function daysBetween(from: string, to: string): number {
  return Math.round(
    (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) /
      86_400_000,
  );
}

export interface FollowerCountDisplay {
  /** "41.0K", with the date appended when the figure is not live. */
  short: string;
  /** "41,000 followers — Measured, as of Sep 15, 2026". */
  detail: string;
  /** True when the figure is not current: stored at connection, or old. */
  stale: boolean;
}

export function describeFollowerCount(input: {
  count: number;
  source: FollowerCountSource | null | undefined;
  asOf: string | null | undefined;
  /** 0 or absent when exact. */
  roundingStep?: number;
  /** `YYYY-MM-DD`; defaults to the current UTC date. */
  today?: string;
}): FollowerCountDisplay {
  const today = input.today ?? new Date().toISOString().slice(0, 10);

  // A measured count ages like a stored one: its source says how it was
  // taken, not whether it is still true.
  const old =
    input.source !== 'metadata' &&
    input.asOf != null &&
    daysBetween(input.asOf, today) > FOLLOWER_COUNT_FRESH_DAYS;
  const stale = input.source === 'metadata' || old;
  const day = input.asOf ? formatDay(input.asOf) : null;

  const qualifier = [
    input.source ? SOURCE_LABEL[input.source] : null,
    day ? (old ? `no newer data since ${day}` : `as of ${day}`) : null,
  ]
    .filter(Boolean)
    .join(', ');

  // Off either way by up to step − 1: a reconstructed level can sit anywhere
  // in the platform's rounded band. The short form cannot carry this —
  // `formatFollowers` rounds to one decimal itself.
  const error = Math.max(0, (input.roundingStep ?? 0) - 1);
  const rounding =
    error > 0
      ? ` Rounded by the platform — may be off by up to ${error.toLocaleString(
          'en-US',
        )} either way.`
      : '';

  return {
    short: `${formatFollowers(input.count)}${stale && day ? ` · ${day}` : ''}`,
    detail: `${input.count.toLocaleString('en-US')} followers${
      qualifier ? ` — ${qualifier}` : ''
    }${rounding ? `.${rounding}` : ''}`,
    stale,
  };
}
