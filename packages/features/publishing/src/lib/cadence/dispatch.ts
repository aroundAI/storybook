/**
 * FILM-719. What the scheduled job does with a post that is due.
 *
 * - A Short that waits for its episode's long video goes once that video is
 *   live, waits while it is still on its way, and fails when it will never
 *   go out: no Short promotes a video nobody can watch.
 * - A post that holds a cadence slot is put back a day when its channel has
 *   already had its day's posts of that type, as a "Publish now" can do.
 *   A post scheduled by hand is the owner's explicit choice and goes.
 *
 * Environment-free: the scheduled Lambda imports it.
 */

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

export const LONG_VIDEO_NEVER_WENT_OUT =
  "This Short waits for its episode's long video, which did not go out. Publish the long video, then schedule the Short again.";

/** The most a channel posts of one type a day: its slots, else one */
export function dailyCapOf(
  row: { slot_times: readonly string[]; enabled: boolean } | null | undefined,
) {
  return row?.enabled ? Math.max(1, row.slot_times.length) : 1;
}

/** Posts of a type a channel made, or is making, in the last day */
export function postsInLastDay(
  rows: ReadonlyArray<{ status: string; published_at: string | null }>,
  now: Date,
) {
  const since = now.getTime() - 86_400_000;

  return rows.filter(
    (row) =>
      row.status === 'queued' ||
      row.status === 'publishing' ||
      (LIVE.has(row.status) &&
        !!row.published_at &&
        new Date(row.published_at).getTime() > since),
  ).length;
}

/** How many days a post over the cap is moved on before giving up */
export const MAX_DEFER_DAYS = 7;

/** The same time of day, `days` later */
export function deferredBy(at: Date, days: number) {
  return new Date(at.getTime() + days * 86_400_000);
}
