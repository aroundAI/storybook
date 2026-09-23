/**
 * When a stored access token counts as spent. One rule for the web app, which
 * refreshes before handing a token out, and the publish worker, which never
 * refreshes and so refuses the same tokens (KB-15). Pure, so the worker
 * lambda can import it.
 */

/** A token this close to expiry is refreshed before use, never handed out. */
export const EXPIRY_BUFFER_MS = 5 * 60 * 1000;

/**
 * The token-refresh cron job's window: the connections it selects, and the
 * ones it refreshes. Run every 30 minutes, it leaves every token it can
 * refresh at least 30 minutes from expiry.
 */
export const CRON_REFRESH_WINDOW_MS = 60 * 60 * 1000;

/** True when a token expiring at `expiresAt` should be refreshed before use. */
export function isWithinRefreshWindow(
  expiresAt: Date,
  now: Date,
  windowMs: number = EXPIRY_BUFFER_MS,
): boolean {
  return expiresAt.getTime() - now.getTime() < windowMs;
}
