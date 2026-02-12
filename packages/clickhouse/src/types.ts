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
 * Raw metric event inserted into ClickHouse video_metrics table.
 * Each row is an immutable log entry from a platform API sync.
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
    extra_metrics: string;
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
 * Formats a Date to YYYY-MM-DD string for ClickHouse date filters.
 */
export function formatDateStr(date: Date): string {
    return date.toISOString().split('T')[0]!;
}
