import {
  SUBSCRIBER_LEVEL_FRESH_DAYS,
  SUBSCRIBER_SOURCE_LABEL,
  isLevelOutdated,
  roundingErrorOf,
} from '@kit/clickhouse';

import { formatFollowers } from './platform-limits';
import type { FollowerCountSource } from './types';

/**
 * How a connection's follower count is described wherever it is shown
 * (FILM-1617): a measured or reconstructed level is dated by its newest data,
 * and a count stored at connection time is marked as not live.
 */

export type { FollowerCountSource };

function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * From the one label table every subscriber surface reads, so the chip and
 * the Deep Dive cannot describe the same day differently. A stored count has
 * no subscriber source, so it keeps its own.
 */
export const FOLLOWER_SOURCE_LABEL: Record<FollowerCountSource, string> = {
  snapshot: capitalise(SUBSCRIBER_SOURCE_LABEL.snapshot),
  reconstructed: capitalise(SUBSCRIBER_SOURCE_LABEL.interpolated),
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

/** The shared freshness rule, re-exported for the chip's callers. */
export const FOLLOWER_COUNT_FRESH_DAYS = SUBSCRIBER_LEVEL_FRESH_DAYS;

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
    isLevelOutdated(input.asOf, today);
  const stale = input.source === 'metadata' || old;
  const day = input.asOf ? formatDay(input.asOf) : null;

  const qualifier = [
    input.source ? FOLLOWER_SOURCE_LABEL[input.source] : null,
    day ? (old ? `no newer data since ${day}` : `as of ${day}`) : null,
  ]
    .filter(Boolean)
    .join(', ');

  // Off either way by up to step − 1: a reconstructed level can sit anywhere
  // in the platform's rounded band. The short form cannot carry this —
  // `formatFollowers` rounds to one decimal itself.
  const error = roundingErrorOf(input.roundingStep ?? 0);
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
