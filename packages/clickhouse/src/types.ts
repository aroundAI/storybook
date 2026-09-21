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
  /** Gross losses. Net movement is gained - lost. */
  subscribers_lost?: number;
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
  /**
   * Required, not optional (FILM-1618). Both columns are `UInt32 DEFAULT 0`
   * and inserts go out as JSONEachRow, so an omitted field is silently
   * filled with a zero the server never complains about. They were
   * optional here, the only accumulator could not carry them, and both
   * columns were therefore zero in every environment from migration 006
   * until FILM-1618 — with nothing to catch it at any layer. Making them
   * required means a new construction site has to name them.
   */
  subscribers_gained: number;
  subscribers_lost: number;
}

/**
 * Dimension row for a published video, synced from Postgres. Joined FINAL
 * by the deep-dive queries for age-controlled and segment analytics.
 */
export interface VideoDim {
  video_id: string;
  project_id: string;
  account_id: string;
  episode_id: string;
  /**
   * The channel this video was published to (platform_connections.id).
   * A project spans several channels, so this is the grouping key for
   * per-channel analysis. UNATTRIBUTED_CONNECTION_ID when unknown.
   */
  connection_id: string;
  platform: string;
  content_type: string;
  language: string;
  title: string;
  /** DateTime string, e.g. '2026-06-14 08:30:00'. */
  published_at: string;
  /**
   * The *episode's* rendered duration — not the published clip's. Renamed
   * from `duration_seconds` (FILM-1710) so nothing reads it as the asset's:
   * a Short cut from a 22-minute episode carries ~1,320 here. 0 when the
   * render never reported one.
   */
  episode_duration_seconds: number;
  /**
   * The published asset's duration as the platform reports it
   * (`publishes.duration_seconds`). Null is `duration_unknown` — the state of
   * every row until the provider has been asked, and of every Instagram row,
   * because Meta's Media node has no duration field. Never coerce it to 0.
   */
  asset_duration_seconds: number | null;
  /** 'dimension:slug' strings, e.g. 'topic:volcanoes'. */
  tags: string[];
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
  /**
   * Several projects, where one is not enough — a report may name a set.
   * Same purpose as `projectId`: it leads every metrics table's sort key,
   * so it is what keeps a `videoIds` read from scanning the table.
   */
  projectIds?: string[];
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
