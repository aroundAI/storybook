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
