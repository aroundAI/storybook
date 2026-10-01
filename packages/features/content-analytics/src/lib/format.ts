/**
 * Formatting utilities for metric display
 */
import { format } from 'date-fns';

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
 * Formats **US dollars**, whole units.
 *
 * Only for figures that are dollars by construction: ClickHouse's
 * `video_revenue_daily.revenue_cents`, which has no currency column and only
 * USD-sourced writers (`revenue-writers.test.ts`). Anything read from
 * `revenue_records` may be in any currency and goes through `formatMoney`
 * / `formatCurrencyAmount` in `./money` instead (KB-12).
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

/**
 * A percentage change, or the fact that there is nothing to compare to.
 *
 * `no-baseline` is not a zero and not an increase. A card reading it draws
 * no arrow and no figure (KB-16): the previous case returned `100, up` for
 * `previous === 0`, and three of the four dashboards passed no previous
 * period at all, so every non-zero metric read "+100.0%".
 */
export type ChangeResult =
  | { kind: 'change'; percentage: number; direction: 'up' | 'down' | 'neutral' }
  | { kind: 'no-baseline' };

/**
 * Change from `previous` to `current`. `previous` is null when no earlier
 * period was measured, and a previous period of zero is no baseline either:
 * a change from nothing is not a percentage.
 */
export function calculateChange(
  current: number,
  previous: number | null,
): ChangeResult {
  if (previous === null || previous === 0) {
    return { kind: 'no-baseline' };
  }

  const percentage = ((current - previous) / previous) * 100;

  return {
    kind: 'change',
    percentage,
    direction: percentage > 1 ? 'up' : percentage < -1 ? 'down' : 'neutral',
  };
}

/**
 * Formats a date using date-fns format strings
 * @param date - The date to format
 * @param formatStr - The format string (e.g., 'MMM d', 'MMMM d, yyyy')
 */
export function formatDate(date: Date, formatStr: string): string {
  return format(date, formatStr);
}
