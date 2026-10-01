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
export interface VideoMetric extends Partial<FacebookDenominators> {
  project_id: string;
  video_id: string;
  platform: AnalyticsPlatform;
  metric_date: string;
  /**
   * Null for Facebook (migration 020): it reports four kinds of view and
   * none is a view in this column's sense (FILM-1722), so a pooled views
   * figure never adds one. Its kinds are `FacebookDenominators`.
   */
  views: number | null;
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
  /**
   * Reposts added that day (migration 018, FILM-1712). Instagram FEED and
   * REELS only; **null means not measured**.
   */
  reposts?: number | null;
  /** The day's increase in Instagram's all-surface aggregates (migration 019). */
  all_surface_views?: number | null;
  all_surface_likes?: number | null;
  all_surface_comments?: number | null;
  extra_metrics: string;
}

/**
 * Instagram's all-surface aggregates (FILM-1722, migration 019):
 * `total_views_count`, `total_like_count`, `total_comments_count`. They fold
 * in boosted placements (and replays, for views), so they are never `views`,
 * `likes` or `comments`. Lifetime in a snapshot; **null means not measured**
 * — every YouTube and TikTok row, a Story, or a field Meta omitted.
 */
export interface AllSurfaceAggregates {
  all_surface_views: number | null;
  all_surface_likes: number | null;
  all_surface_comments: number | null;
}

/**
 * Facebook's own denominators (migration 020, FILM-1720), each its own
 * column so none is summed into another or into `views`. Lifetime on a
 * snapshot, the day's increase on a `video_metrics` row; **null means not
 * measured** — every row of every other platform, and a metric Meta left
 * out (the Reels-only ones on an ordinary video).
 */
export interface FacebookDenominators {
  /** `post_media_view`: played or displayed — the impression replacement. */
  media_views: number | null;
  /** `blue_reels_play_count`: at least 1 ms, replays excluded. */
  plays: number | null;
  /** `fb_reels_replay_count`. */
  replays: number | null;
  /** `total_video_views`: 3 seconds, or nearly the whole of a shorter video. */
  views_3s: number | null;
  /** `total_video_views_organic` and `_paid`: Meta's split, kept apart. */
  views_3s_organic: number | null;
  views_3s_paid: number | null;
  /** `total_video_views_autoplayed` and `_clicked_to_play`: intent, kept apart. */
  views_3s_autoplayed: number | null;
  views_3s_clicked_to_play: number | null;
  /** `total_video_15s_views`. Not ThruPlay, which is an Ads metric. */
  views_15s: number | null;
  /** `total_video_complete_views`: 97% or more of the video. */
  complete_views: number | null;
}

export const FACEBOOK_DENOMINATOR_COLUMNS = [
  'media_views',
  'plays',
  'replays',
  'views_3s',
  'views_3s_organic',
  'views_3s_paid',
  'views_3s_autoplayed',
  'views_3s_clicked_to_play',
  'views_15s',
  'complete_views',
] as const satisfies readonly (keyof FacebookDenominators)[];

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
  | 'views'
  | 'saves'
  | 'watch_time_seconds'
  | 'subscribers_gained'
  | 'subscribers_lost'
  | 'avg_view_duration_seconds'
  | 'avg_view_percentage'
  | 'dislikes'
  | 'accounts_reached'
  | 'reposts'
  | keyof AllSurfaceAggregates
> & {
  platform: 'youtube';
  /** YouTube's views are measured: the column's own definition. */
  views: number;
  /** YouTube reports no per-video unique reach. */
  accounts_reached?: null;
  /** YouTube reports no reposts. */
  reposts?: null;
  /** Instagram-only aggregates. */
  all_surface_views?: null;
  all_surface_likes?: null;
  all_surface_comments?: null;
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
export interface VideoSnapshot
  extends AllSurfaceAggregates,
    Partial<FacebookDenominators> {
  project_id: string;
  video_id: string;
  platform: AnalyticsPlatform;
  snapshot_date: string;
  /** Null for Facebook (migration 020), as on `VideoMetric`. */
  views: number | null;
  likes: number;
  comments: number;
  shares: number;
  /** Null where the platform does not measure it (migration 017). */
  saves: number | null;
  watch_time_seconds: number | null;
  subscribers_gained: number | null;
  /** Lifetime unique accounts reached (Instagram); null when not measured. */
  accounts_reached: number | null;
  /** Lifetime reposts (Instagram FEED and REELS); null when not measured. */
  reposts: number | null;
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
export interface SnapshotTotals
  extends AllSurfaceAggregates,
    Partial<FacebookDenominators> {
  snapshot_date: string;
  /** Null for Facebook (migration 020), as on `VideoMetric`. */
  views: number | null;
  likes: number;
  comments: number;
  shares: number;
  /** The latest snapshot's own values, NULL included (migration 017). */
  saves: number | null;
  watch_time_seconds: number | null;
  subscribers_gained: number | null;
  /** The latest snapshot's own value: null when it recorded no reach. */
  accounts_reached: number | null;
  /** The latest snapshot's own value: null when it recorded no reposts. */
  reposts: number | null;
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
