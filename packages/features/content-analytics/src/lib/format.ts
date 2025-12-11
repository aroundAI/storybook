/**
 * Formatting utilities for metric display
 */

/**
 * Formats large numbers with abbreviations (1.2K, 3.4M, etc.)
 * Handles both positive and negative values.
 */
export function formatNumber(value: number): string {
  const absValue = Math.abs(value);
  const sign = value < 0 ? '-' : '';

  if (absValue >= 1_000_000_000) {
    return `${sign}${(absValue / 1_000_000_000).toFixed(1)}B`;
  }
  if (absValue >= 1_000_000) {
    return `${sign}${(absValue / 1_000_000).toFixed(1)}M`;
  }
  if (absValue >= 1_000) {
    return `${sign}${(absValue / 1_000).toFixed(1)}K`;
  }
  return value.toLocaleString();
}

/**
 * Formats seconds into human-readable duration.
 * Returns "0m" for zero or negative values.
 */
export function formatDuration(seconds: number): string {
  if (seconds <= 0) {
    return '0m';
  }

  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);

  if (hours >= 1000) {
    return `${formatNumber(hours)}h`;
  }
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  return `${minutes}m`;
}

/**
 * Formats dollars to currency string
 */
export function formatCurrency(dollars: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(dollars);
}

/**
 * Formats percentage with sign
 */
export function formatPercent(value: number): string {
  const formatted = Math.abs(value).toFixed(1);
  return `${formatted}%`;
}

export interface ChangeResult {
  percentage: number;
  direction: 'up' | 'down' | 'neutral';
}

/**
 * Calculates percentage change between current and previous values
 */
export function calculateChange(
  current: number,
  previous: number,
): ChangeResult {
  if (previous === 0) {
    return {
      percentage: current > 0 ? 100 : 0,
      direction: current > 0 ? 'up' : 'neutral',
    };
  }

  const percentage = ((current - previous) / previous) * 100;

  return {
    percentage,
    direction: percentage > 1 ? 'up' : percentage < -1 ? 'down' : 'neutral',
  };
}
