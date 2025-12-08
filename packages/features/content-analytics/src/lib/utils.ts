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
  const match = isoDuration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!match) return 0;
  const hours = parseInt(match[1] || '0');
  const minutes = parseInt(match[2] || '0');
  const seconds = parseInt(match[3] || '0');
  return hours * 3600 + minutes * 60 + seconds;
}
