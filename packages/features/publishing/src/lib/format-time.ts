/**
 * Time formatting utilities for the shorts clipper
 */

/**
 * Format seconds to MM:SS or HH:MM:SS
 */
export function formatTime(seconds: number): string {
  const totalSeconds = Math.floor(seconds);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const secs = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }
  return `${minutes}:${secs.toString().padStart(2, '0')}`;
}

/**
 * Format seconds to MM:SS.ms (with milliseconds)
 */
export function formatTimeWithMs(seconds: number): string {
  const totalSeconds = Math.floor(seconds);
  const minutes = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;
  const ms = Math.floor((seconds % 1) * 10);

  return `${minutes}:${secs.toString().padStart(2, '0')}.${ms}`;
}

/**
 * Parse time string to seconds
 * Accepts: "1:30", "01:30", "1:30.5", "90"
 */
export function parseTime(timeStr: string): number {
  const cleaned = timeStr.trim();

  // Check if it's just a number (seconds)
  if (/^\d+(\.\d+)?$/.test(cleaned)) {
    return parseFloat(cleaned);
  }

  // Parse MM:SS or HH:MM:SS format
  const parts = cleaned.split(':');
  if (parts.length === 2) {
    const minutes = parseInt(parts[0] ?? '0', 10);
    const seconds = parseFloat(parts[1] ?? '0');
    return minutes * 60 + seconds;
  }
  if (parts.length === 3) {
    const hours = parseInt(parts[0] ?? '0', 10);
    const minutes = parseInt(parts[1] ?? '0', 10);
    const seconds = parseFloat(parts[2] ?? '0');
    return hours * 3600 + minutes * 60 + seconds;
  }

  return 0;
}

/**
 * Calculate clip duration and format it
 */
export function getClipDuration(startTime: number, endTime: number): string {
  const duration = endTime - startTime;
  return formatTime(duration);
}

/**
 * Check if a duration is valid for a platform's shorts
 */
export function isValidShortsDuration(
  duration: number,
  minDuration: number,
  maxDuration: number,
): boolean {
  return duration >= minDuration && duration <= maxDuration;
}
