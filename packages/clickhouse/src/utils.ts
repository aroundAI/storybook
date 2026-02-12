/**
 * ClickHouse Utility Functions
 */

/**
 * Formats a Date to YYYY-MM-DD string for ClickHouse date filters.
 */
export function formatDateStr(date: Date): string {
    return date.toISOString().split('T')[0]!;
}
