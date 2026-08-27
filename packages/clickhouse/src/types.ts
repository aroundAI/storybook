/**
 * ClickHouse Analytics Types
 *
 * Type definitions matching the ClickHouse video_metrics
 * and video_daily_stats schemas.
 */

/**
 * Platform types supported by the analytics system
 */
export type AnalyticsPlatform = 'youtube' | 'tiktok' | 'instagram';

/**
 * Origin of a metric row. Reporting-API rows are authoritative and replace
 * Analytics-API rows for the same (video, day) via ReplacingMergeTree.
 */
export type MetricSource =
  | 'analytics_api'
  | 'reporting_api'
  | 'snapshot_delta'
  | 'backfill';

/**
 * Daily metric row inserted into ClickHouse video_metrics.
 * One row per (video, platform, day) holding TRUE DAILY values keyed by the
 * platform data date; re-inserting the same key replaces the row
 * (ReplacingMergeTree on inserted_at).
 */
export interface VideoMetric {
  project_id: string;
  video_id: string;
  platform: AnalyticsPlatform;
  metric_date: string;
  views: number;
  likes: number;
  comments: number;
  shares: number;
  saves: number;
  watch_time_seconds: number;
  revenue_cents: number;
  subscribers_gained: number;
  metric_source?: MetricSource;
  extra_metrics: string;
}

/**
 * Lifetime cumulative totals snapshot for a video, one retained row per day.
 * Baseline store for TikTok/Instagram delta derivation, whose APIs only
 * expose lifetime counters.
 */
export interface VideoSnapshot {
  project_id: string;
  video_id: string;
  platform: AnalyticsPlatform;
  snapshot_date: string;
  views: number;
  likes: number;
  comments: number;
  shares: number;
  saves: number;
  watch_time_seconds: number;
  subscribers_gained: number;
}

/**
 * Latest-snapshot totals returned by queryLatestSnapshots, keyed by video_id.
 */
export interface SnapshotTotals {
  snapshot_date: string;
  views: number;
  likes: number;
  comments: number;
  shares: number;
  saves: number;
  watch_time_seconds: number;
  subscribers_gained: number;
}

/**
 * Aggregated daily stats from the video_daily_stats materialized view.
 * Pre-aggregated by (project_id, platform, video_id, metric_date).
 */
export interface DailyStats {
  project_id: string;
  video_id: string;
  platform: AnalyticsPlatform;
  metric_date: string;
  views: number;
  likes: number;
  comments: number;
  shares: number;
  saves: number;
  watch_time_seconds: number;
  revenue_cents: number;
  subscribers_gained: number;
}

/**
 * Aggregated totals (summed across multiple rows)
 */
export interface AggregatedTotals {
  views: number;
  likes: number;
  comments: number;
  shares: number;
  saves: number;
  watch_time_seconds: number;
  revenue_cents: number;
  subscribers_gained: number;
}

/**
 * Daily time series data point
 */
export interface DailyDataPoint {
  date: string;
  views: number;
  likes: number;
  comments: number;
  shares: number;
  saves: number;
  watch_time_seconds: number;
  revenue_cents: number;
}

/**
 * Platform breakdown entry
 */
export interface PlatformBreakdown {
  platform: AnalyticsPlatform;
  views: number;
  likes: number;
  comments: number;
  shares: number;
  saves: number;
  revenue_cents: number;
}

/**
 * Query filter options shared across query functions
 */
export interface QueryFilters {
  projectId?: string;
  videoIds?: string[];
  platforms?: AnalyticsPlatform[];
  startDate?: string;
  endDate?: string;
}

/**
 * Raw row shape returned by ClickHouse for daily-by-platform queries.
 * Used internally by queryDailyTimeSeriesByPlatform.
 */
export interface DailyPlatformMetricsRow {
  date: string;
  platform: string;
  views: number;
  likes: number;
  comments: number;
  shares: number;
}

/**
 * Platform engagement metrics (views, likes, comments, shares)
 */
export interface PlatformEngagement {
  views: number;
  likes: number;
  comments: number;
  shares: number;
}

/**
 * Daily time series entry with per-platform breakdown
 */
export interface DailyPlatformBreakdown {
  date: string;
  views: number;
  likes: number;
  comments: number;
  shares: number;
  byPlatform: Record<string, PlatformEngagement>;
}
