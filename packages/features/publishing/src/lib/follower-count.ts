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

export interface FollowerCountDisplay {
  /** "41.0K", with the date appended when the figure is not live. */
  short: string;
  /** "41,000 followers — Measured, as of Sep 15, 2026". */
  detail: string;
  /** True when the figure was stored at connection time. */
  stale: boolean;
}

export function describeFollowerCount(input: {
  count: number;
  source: FollowerCountSource | null | undefined;
  asOf: string | null | undefined;
  /** 0 or absent when exact. */
  roundingStep?: number;
}): FollowerCountDisplay {
  const stale = input.source === 'metadata';
  const day = input.asOf ? formatDay(input.asOf) : null;

  const qualifier = [
    input.source ? SOURCE_LABEL[input.source] : null,
    day ? `as of ${day}` : null,
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
