/**
 * YouTube's days are Pacific days: a report "covers 12:00–23:59 PST"
 * (capability reference, YouTube; the Reporting dimensions reference says
 * the same of `date`), and Analytics' `day` rows are the same days. A
 * sandbox that cut days at UTC midnight would hide exactly the time-zone
 * mistake it exists to catch, so these helpers cut them where YouTube does,
 * daylight saving included.
 */

const FORMAT = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Los_Angeles',
  timeZoneName: 'shortOffset',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** Minutes Pacific time is ahead of UTC at an instant (-420 or -480). */
function offsetMinutes(ms: number) {
  const name =
    FORMAT.formatToParts(new Date(ms)).find((p) => p.type === 'timeZoneName')
      ?.value ?? 'GMT-8';
  const match = /GMT([+-])(\d{1,2})(?::(\d{2}))?/.exec(name);
  if (!match) return 0;
  const minutes = Number(match[2]) * 60 + Number(match[3] ?? 0);
  return match[1] === '-' ? -minutes : minutes;
}

/** The Pacific calendar date an instant falls on, `YYYY-MM-DD`. */
export function pacificDate(ms: number) {
  return new Date(ms + offsetMinutes(ms) * 60_000).toISOString().slice(0, 10);
}

/** The instant a Pacific calendar date begins. */
export function pacificMidnight(date: string) {
  const utcMidnight = Date.parse(`${date}T00:00:00Z`);
  // The offset at local midnight is the offset a few hours later, except on
  // the two changeover days; checking the result settles those.
  let start = utcMidnight - offsetMinutes(utcMidnight + 12 * 3_600_000) * 60_000;
  if (pacificDate(start) !== date) start += 3_600_000;
  if (pacificDate(start - 1) === date) start -= 3_600_000;
  return start;
}

/** The next calendar date. */
export function nextDate(date: string) {
  return new Date(Date.parse(`${date}T00:00:00Z`) + 86_400_000)
    .toISOString()
    .slice(0, 10);
}
