/**
 * Format a number for display with K/M suffixes
 */
export function formatNumber(value: number): string {
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(1)}M`;
  }
  if (value >= 1_000) {
    return `${(value / 1_000).toFixed(1)}K`;
  }
  return value.toLocaleString();
}

/**
 * Format a number as a percentage string
 */
export function formatPercent(value: number): string {
  return `${Math.abs(value).toFixed(1)}%`;
}
