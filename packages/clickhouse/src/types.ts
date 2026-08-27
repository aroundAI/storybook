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
  /** Per-day average view duration in seconds (0 when unknown). */
  avg_view_duration_seconds?: number;
  /** Per-day average view percentage 0-100 (0 when unknown). */
  avg_view_percentage?: number;
  dislikes?: number;
  extra_metrics: string;
}

/**
 * One point of a lifetime audience-retention curve. Latest fetch wins per
 * (video, elapsed_ratio).
 */
export interface RetentionCurvePoint {
  project_id: string;
  video_id: string;
  platform: AnalyticsPlatform;
  /** Position in the video, 0..1. */
  elapsed_ratio: number;
  /** Share of starters still watching at this position. */
  audience_watch_ratio: number;
}

/**
 * Audience breakdown dimensions stored in video_audience.
 */
export type AudienceDimension =
  | 'age_group'
  | 'gender'
  | 'country'
  | 'city'
  | 'device'
  | 'os'
  | 'follower_status';

/**
 * Latest-wins audience breakdown row. `views` is 0 when the platform only
 * reports percentages for the dimension.
 */
export interface VideoAudienceRow {
  project_id: string;
  video_id: string;
  platform: AnalyticsPlatform;
  dimension: AudienceDimension;
  key: string;
  views: number;
  percentage: number;
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
 * Thumbnail reach row (impressions, CTR, engaged views) per video/day.
 * Sourced from the YouTube Reporting API reach reports.
 */
export interface VideoReachDaily {
  project_id: string;
  video_id: string;
  platform: AnalyticsPlatform;
  metric_date: string;
  impressions: number;
  impressions_ctr: number;
  engaged_views: number;
}

/**
 * Traffic-source row per video/day/source.
 */
export interface VideoTrafficSource {
  project_id: string;
  video_id: string;
  platform: AnalyticsPlatform;
  metric_date: string;
  source: string;
  views: number;
  watch_time_minutes: number;
}

/**
 * Channel-level rollup row for videos not published through the platform,
 * keyed by connection. Keeps channel-wide totals (YPP watch hours) accurate.
 */
export interface ChannelDaily {
  connection_id: string;
  metric_date: string;
  views: number;
  watch_time_seconds: number;
  impressions: number;
  engaged_views: number;
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
