/**
 * Time Utilities for Lambda Workers
 *
 * Helper functions for parsing and manipulating time values
 * in VEO prompt timeline events.
 */

/**
 * Parse timestamp string "MM:SS" to seconds
 * Used for VEO timeline event timestamps
 *
 * @example
 * parseTimeToSeconds("01:30") // returns 90
 * parseTimeToSeconds("00:15") // returns 15
 * parseTimeToSeconds("2:45")  // returns 165
 */
export function parseTimeToSeconds(time: string): number {
    if (!time || typeof time !== 'string') {
        return 0;
    }
    const parts = time.split(':').map(Number);
    const [minutes, seconds] = parts;
    return (minutes || 0) * 60 + (seconds || 0);
}

/**
 * Format seconds as "MM:SS" timestamp string
 * Inverse of parseTimeToSeconds
 *
 * @example
 * formatSecondsAsTime(90)  // returns "01:30"
 * formatSecondsAsTime(15)  // returns "00:15"
 * formatSecondsAsTime(165) // returns "02:45"
 */
export function formatSecondsAsTime(totalSeconds: number): string {
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = Math.floor(totalSeconds % 60);
    return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
}
