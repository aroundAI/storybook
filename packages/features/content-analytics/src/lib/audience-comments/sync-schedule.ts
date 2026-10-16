/**
 * FILM-1733. When a video's comments are read again, and how.
 *
 * New comments arrive fastest in a video's first days, so a young video is
 * read often and an old one rarely. Every comment is read again at least
 * once a week (a refresh): that catches edits and deletions, and keeps every
 * stored YouTube comment well inside the 30 days its Developer Policies
 * allow without a refresh (III.E.4.c).
 *
 * Pure: the job passes the clock.
 */

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

/** How long a stored YouTube comment may go without being returned again */
export const YOUTUBE_COMMENT_RETENTION_MS = 30 * DAY_MS;

/** Every comment is read again at least this often */
export const REFRESH_EVERY_MS = 7 * DAY_MS;

/** After this many failures in a row a video is tried once a day */
export const MAX_CONSECUTIVE_FAILURES = 5;

/** A read of new comments goes back this far past the last one, for clock skew */
export const SINCE_OVERLAP_MS = HOUR_MS;

export interface CommentSyncRecord {
  last_synced_at: string | null;
  last_refreshed_at: string | null;
  last_status: string;
  consecutive_failures: number;
  updated_at: string;
}

/** How long after its last read a video of this age is read again */
export function readIntervalMs(ageMs: number) {
  if (ageMs < 2 * DAY_MS) return HOUR_MS;
  if (ageMs < 7 * DAY_MS) return 6 * HOUR_MS;
  if (ageMs < 30 * DAY_MS) return DAY_MS;

  return 7 * DAY_MS;
}

export type CommentSyncPlan =
  | { due: false }
  | {
      due: true;
      /** Read every comment again, not only new ones */
      refresh: boolean;
      /** For a read of new comments: the earliest one wanted */
      since: Date | null;
      /** How overdue it is, for ordering a batch: larger first */
      urgency: number;
    };

export function planCommentSync(input: {
  publishedAt: string;
  sync: CommentSyncRecord | null;
  now: Date;
}): CommentSyncPlan {
  const now = input.now.getTime();
  const { sync } = input;

  if (!sync || !sync.last_synced_at) {
    return { due: true, refresh: true, since: null, urgency: Infinity };
  }

  if (sync.consecutive_failures >= MAX_CONSECUTIVE_FAILURES) {
    const lastTry = new Date(sync.updated_at).getTime();
    if (now - lastTry < DAY_MS) return { due: false };
  }

  const lastRead = new Date(sync.last_synced_at).getTime();
  const lastRefresh = sync.last_refreshed_at
    ? new Date(sync.last_refreshed_at).getTime()
    : 0;
  const age = now - new Date(input.publishedAt).getTime();

  const refreshOverdue = now - lastRefresh - REFRESH_EVERY_MS;
  if (refreshOverdue >= 0) {
    return {
      due: true,
      refresh: true,
      since: null,
      urgency: refreshOverdue / REFRESH_EVERY_MS + 1,
    };
  }

  const interval = readIntervalMs(age);
  const overdue = now - lastRead - interval;
  if (overdue < 0) return { due: false };

  return {
    due: true,
    refresh: false,
    since: new Date(lastRead - SINCE_OVERLAP_MS),
    urgency: overdue / interval,
  };
}
