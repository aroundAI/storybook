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
  /**
   * Null where the platform does not measure it (migration 014, KB-114):
   * saves on YouTube and TikTok, watch time on TikTok and Instagram.
   */
  saves: number | null;
  watch_time_seconds: number | null;
  /**
   * **US dollars, or zero** — this table has no currency column (KB-12).
   * Every reader prints it as dollars, which holds only because every
   * writer writes USD-sourced figures: today a literal 0 on every ingest
   * path, and YouTube's estimate (requested without a `currency`, so USD)
   * if that ever changes. Revenue in any other currency is entered by a
   * person and lives in Postgres `revenue_records`, beside its currency.
   * `revenue-writers.test.ts` in @kit/content-analytics binds this to the
   * writers, so a new one cannot make it quietly untrue.
   */
  revenue_cents: number;
  /** Null for TikTok, which reports no per-video follower gains (KB-114). */
  subscribers_gained: number | null;
  /**
   * The four below are **null when the platform does not measure them**
   * (migration 013, KB-111) — TikTok and Instagram report none of them.
   * Never 0 for "not measured": a 0 is read as a measurement and pooled.
   */
  /** Gross losses. Net movement is gained - lost. */
  subscribers_lost?: number | null;
  metric_source?: MetricSource;
  /** Per-day average view duration in seconds. */
  avg_view_duration_seconds?: number | null;
  /** Per-day average view percentage 0-100. */
  avg_view_percentage?: number | null;
  dislikes?: number | null;
  /**
   * YouTube engaged views: the view-counting methodology before 2026-08-27,
   * continuous across that change (migration 012, KB-50). **Null means not
   * reported** — never zero. Both YouTube writers must set it, because the
   * later row replaces the whole row; omitting it erases the other's figure.
   */
  engaged_views?: number | null;
  /**
   * Accounts that saw this post for the first time that day (migration
   * 015, FILM-1712): the day's increase in the platform's lifetime unique
   * reach. Instagram only; **null means not measured**. A unique count: it
   * sums over one post's days and never across posts.
   */
  accounts_reached?: number | null;
  extra_metrics: string;
}

/**
 * A YouTube `video_metrics` row. Two writers share its key — the Reporting
 * ingest and the Analytics-API sync/backfill — and the later row replaces the
 * whole row, so a column one of them leaves out is erased from the other's
 * figure (KB-50, KB-94). Both return this type, which makes every column they
 * share required: leaving one out is a type error, not a silent zero.
 *
 * YouTube measures all four of the KB-111 columns, so here they are numbers,
 * never null: a null from either writer would replace the other's figure.
 */
export type YouTubeVideoMetric = Omit<
  VideoMetric,
  | 'saves'
  | 'watch_time_seconds'
  | 'subscribers_gained'
  | 'subscribers_lost'
  | 'avg_view_duration_seconds'
  | 'avg_view_percentage'
  | 'dislikes'
  | 'accounts_reached'
> & {
  platform: 'youtube';
  /** YouTube reports no per-video unique reach. */
  accounts_reached?: null;
  metric_source: MetricSource;
  /** YouTube has no saves metric (KB-114): not measured, never 0. */
  saves: null;
  watch_time_seconds: number;
  subscribers_gained: number;
  subscribers_lost: number;
  avg_view_duration_seconds: number;
  avg_view_percentage: number;
  dislikes: number;
  engaged_views: number | null;
};

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
  /** Null where the platform does not measure it (migration 017). */
  saves: number | null;
  watch_time_seconds: number | null;
  subscribers_gained: number | null;
  /** Lifetime unique accounts reached (Instagram); null when not measured. */
  accounts_reached: number | null;
}

/**
 * Thumbnail reach row (impressions, CTR) per video/day.
 * Sourced from the YouTube Reporting API reach reports, which carry no
 * engaged views — migration 011 dropped the column that pretended to.
 */
export interface VideoReachDaily {
  project_id: string;
  video_id: string;
  platform: AnalyticsPlatform;
  metric_date: string;
  impressions: number;
  impressions_ctr: number;
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
 *
 * Written from `channel_basic_a3` only. The reach residual lives in
 * `ChannelReachDaily`: sharing this key with a second report made the later
 * report's zeroes erase the earlier one's figures (FILM-1504).
 */
export interface ChannelDaily {
  connection_id: string;
  metric_date: string;
  views: number;
  watch_time_seconds: number;
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
 * Channel reach residual: thumbnail impressions for videos not published
 * through the platform, per connection and day (FILM-1504, migration 011).
 * Every field is required, for FILM-1618's reason — an omitted JSONEachRow
 * field becomes a silent zero.
 */
export interface ChannelReachDaily {
  connection_id: string;
  metric_date: string;
  impressions: number;
  /** Impression-weighted over the residual videos, as a ratio (0..1). */
  impressions_ctr: number;
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
  /**
   * The published asset's language (`publishes.language`), or
   * LANGUAGE_NOT_SET when nobody set one. Never a defaulted code.
   */
  language: string;
  /**
   * The channel's target language (`platform_connections.language`), or
   * LANGUAGE_NOT_SET for a publish with no channel. See
   * lib/language-dimension.ts for why both exist.
   */
  channel_language: string;
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
  /** The latest snapshot's own values, NULL included (migration 017). */
  saves: number | null;
  watch_time_seconds: number | null;
  subscribers_gained: number | null;
  /** The latest snapshot's own value: null when it recorded no reach. */
  accounts_reached: number | null;
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
  /** Which of the sometimes-unmeasured sums had any measured row (KB-114). */
  measured: MeasuredColumns;
}

/**
 * The summed columns a platform may not measure (KB-114). The sum beside
 * each reads 0 when none of its rows measured it; this says whether that 0
 * is a measurement. `count(col) > 0` in SQL, since `count` skips NULL.
 */
export interface MeasuredColumns {
  saves: boolean;
  watch_time_seconds: boolean;
  subscribers_gained: boolean;
}

/** Per-video totals, with which columns were measured at all. */
export interface PerVideoTotals extends AggregatedTotals {
  measured: MeasuredColumns;
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
