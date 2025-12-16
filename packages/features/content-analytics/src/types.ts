/**
 * Aggregated analytics totals for metric cards display
 */
export interface AnalyticsTotals {
  views: number;
  likes: number;
  comments: number;
  shares: number;
  watchTimeSeconds: number;
  subscribersGained: number;
  revenueCents: number;
  contentCount: number;
}

/**
 * Platform-specific metrics breakdown
 */
export interface PlatformMetrics {
  views: number;
  likes: number;
  comments: number;
  shares: number;
}

/**
 * Daily metrics data point for time series charts
 */
export interface DailyMetric {
  date: string;
  views: number;
  likes: number;
  comments: number;
  shares: number;
  byPlatform?: Record<string, PlatformMetrics>;
}
