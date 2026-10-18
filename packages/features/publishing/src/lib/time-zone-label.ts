import { formatInTimeZone } from 'date-fns-tz';

/**
 * A timezone as people read it, on the given day: "GMT+5:30", "EST",
 * "EDT". The release panel and the Schedule page both name a zone this
 * way; one that cannot be formatted is named as it is.
 */
export function timeZoneLabel(timeZone: string, at = new Date()) {
  try {
    return formatInTimeZone(at, timeZone, 'zzz');
  } catch {
    return timeZone;
  }
}
