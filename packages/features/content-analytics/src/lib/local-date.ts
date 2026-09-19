/**
 * Calendar days in the user's own time zone, `YYYY-MM-DD` (FILM-1610).
 *
 * A timestamp's first ten characters are its UTC day, which is a day off
 * for anyone far enough from UTC: a video published at 01:30 in Kolkata was
 * published on the previous UTC day. Built from the date's parts rather than
 * a locale's format, which is locale data, not a contract.
 */
export function localDateOf(value: Date | string): string {
  const date = typeof value === 'string' ? new Date(value) : value;
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');

  return `${date.getFullYear()}-${month}-${day}`;
}

/** Today in the user's calendar. */
export function localToday(): string {
  return localDateOf(new Date());
}
