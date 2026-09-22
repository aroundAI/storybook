/**
 * Utility functions for content analytics
 */

/**
 * Formats a Date to YYYY-MM-DD string for YouTube Analytics API
 */
export function formatDate(date: Date): string {
  return date.toISOString().split('T')[0]!;
}

/**
 * Parses ISO 8601 duration (PT1H2M3S) to seconds
 *
 * @example
 * parseDuration('PT1H2M3S') // returns 3723
 * parseDuration('PT30M') // returns 1800
 * parseDuration('PT45S') // returns 45
 */
export function parseDuration(isoDuration: string): number {
  return parseIsoDurationSeconds(isoDuration) ?? 0;
}

/**
 * ISO 8601 duration to whole seconds, or null when there is no duration to
 * report (FILM-1710).
 *
 * `parseDuration` answers 0 for anything it cannot read, and 0 is a
 * measurement. YouTube sends `P0D` for a live broadcast that has not
 * finished, and a string this does not recognise is not a zero-length video
 * either — both are *unknown*. It also reads the day designator, which
 * YouTube uses past 24 hours (`P1DT2H`) and the older pattern ignored.
 */
export function parseIsoDurationSeconds(isoDuration: string): number | null {
  const match = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(
    isoDuration,
  );

  if (!match) return null;

  const [days, hours, minutes, seconds] = match
    .slice(1)
    .map((part) => Number.parseInt(part ?? '0', 10));

  const total = days! * 86_400 + hours! * 3600 + minutes! * 60 + seconds!;

  return total > 0 ? total : null;
}
