import { ActionRefusal } from './action-result';

/**
 * Checks a date the caller sent as "today" in their own time zone
 * (FILM-1610 review 4, G6).
 *
 * It must be a real calendar date — the schema's pattern alone accepts
 * `2026-02-31` — and within a day of the server's UTC date. Time zones run
 * from UTC−12 to UTC+14, so everyone's today is one of those three days.
 * Anything further is a device with the wrong clock, or a crafted request,
 * and would put the experiment's window somewhere nobody chose.
 */
export function assertCallerToday(date: string, now: Date = new Date()): void {
  const parsed = Date.parse(`${date}T00:00:00Z`);

  if (
    Number.isNaN(parsed) ||
    new Date(parsed).toISOString().slice(0, 10) !== date
  ) {
    throw new ActionRefusal(`${date} is not a calendar date.`);
  }

  const utcToday = Date.parse(`${now.toISOString().slice(0, 10)}T00:00:00Z`);

  if (Math.abs(parsed - utcToday) > 86_400_000) {
    throw new ActionRefusal(
      `${date} is not today's date in any time zone. Check this device's date and time, then try again.`,
    );
  }
}

/**
 * The caller's "today" when it passes `assertCallerToday`, otherwise the
 * server's UTC date (KB-24).
 *
 * For reads. A write refuses an implausible date, because it would store
 * it; a read that refused would blank a dashboard tile over a device clock,
 * so it answers as it did before callers sent a date at all. One rule for
 * what is plausible, two ways of acting on it.
 */
export function callerTodayOr(
  date: string | undefined,
  now: Date = new Date(),
): string {
  if (date) {
    try {
      assertCallerToday(date, now);

      return date;
    } catch (error) {
      // Implausible: fall through to the server's own date.
      if (!(error instanceof ActionRefusal)) throw error;
    }
  }

  return now.toISOString().slice(0, 10);
}

/** `YYYY-MM-DD` shifted by whole days, on the calendar rather than the clock. */
export function addCalendarDays(date: string, days: number): string {
  const shifted = new Date(`${date}T00:00:00Z`);
  shifted.setUTCDate(shifted.getUTCDate() + days);

  return shifted.toISOString().slice(0, 10);
}
