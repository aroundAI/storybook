import 'server-only';

import type { SnapshotTotals, VideoMetric } from '@kit/clickhouse';
import { formatDateStr } from '@kit/clickhouse';

import type { YouTubeDailyMetrics } from '../providers/youtube/types';

/**
 * Lifetime cumulative counters as reported by platforms that expose no
 * per-day breakdown (TikTok, Instagram).
 */
export interface CumulativeTotals {
  views: number;
  likes: number;
  comments: number;
  shares: number;
  saves: number;
  watch_time_seconds: number;
  subscribers_gained: number;
}

/**
 * Delta between the current lifetime totals and the latest prior snapshot,
 * clamped to zero per metric — platforms occasionally restate counters
 * downward (deleted comments, spam-filtered views) and a negative daily
 * value would corrupt aggregates.
 */
export function computeSnapshotDelta(
  current: CumulativeTotals,
  baseline: SnapshotTotals | null,
): CumulativeTotals {
  if (!baseline) {
    return { ...current };
  }

  const clamp = (a: number, b: number) => Math.max(0, a - b);

  return {
    views: clamp(current.views, baseline.views),
    likes: clamp(current.likes, baseline.likes),
    comments: clamp(current.comments, baseline.comments),
    shares: clamp(current.shares, baseline.shares),
    saves: clamp(current.saves, baseline.saves),
    watch_time_seconds: clamp(
      current.watch_time_seconds,
      baseline.watch_time_seconds,
    ),
    subscribers_gained: clamp(
      current.subscribers_gained,
      baseline.subscribers_gained,
    ),
  };
}

/**
 * Fetch window for the YouTube Analytics API. Covers the last synced data
 * date minus 3 days (YouTube restates recent data for ~72h) up to now,
 * never reaching before the day the video was published.
 */
export function computeYouTubeWindow(input: {
  lastDataDate?: string;
  publishedAt: string;
  now?: Date;
}): { startDate: Date; endDate: Date } {
  const endDate = input.now ?? new Date();

  const anchor = input.lastDataDate
    ? new Date(`${input.lastDataDate}T00:00:00Z`)
    : endDate;
  const startDate = new Date(anchor.getTime() - 3 * 24 * 60 * 60 * 1000);

  const publishedAt = new Date(input.publishedAt);

  return {
    startDate: startDate > publishedAt ? startDate : publishedAt,
    endDate,
  };
}

/**
 * Latest data date present in a YouTube daily breakdown, or null when the
 * API returned no rows (data not yet available for the window).
 */
export function latestDataDate(
  dailyData: YouTubeDailyMetrics[],
): string | null {
  let latest: string | null = null;

  for (const day of dailyData) {
    if (!latest || day.date > latest) {
      latest = day.date;
    }
  }

  return latest;
}

/**
 * Map YouTube per-day metrics to daily ClickHouse rows. The raw provider
 * payload (retention, traffic sources, …) is attached to the latest day's
 * row only — it is a lifetime aggregate and duplicating it per day would
 * bloat storage without adding information.
 */
export function buildYouTubeDailyRows(input: {
  projectId: string;
  videoId: string;
  dailyData: YouTubeDailyMetrics[];
  extraMetricsJson: string;
}): VideoMetric[] {
  const latest = latestDataDate(input.dailyData);

  return input.dailyData.map((day) => ({
    project_id: input.projectId,
    video_id: input.videoId,
    platform: 'youtube' as const,
    metric_date: day.date,
    views: day.views,
    likes: day.likes,
    comments: day.comments,
    shares: day.shares,
    saves: 0,
    watch_time_seconds: Math.round(day.estimatedMinutesWatched * 60),
    revenue_cents: 0,
    subscribers_gained: day.subscribersGained,
    metric_source: 'analytics_api' as const,
    extra_metrics: day.date === latest ? input.extraMetricsJson : '{}',
  }));
}

/**
 * The metric_date a cumulative-snapshot delta row should carry.
 *
 * - With a baseline the delta accrued since the last snapshot and is
 *   attributed to the fetch day (UTC) — a documented approximation.
 * - Without a baseline, a video younger than 24h gets its whole lifetime
 *   attributed to its publish date; an older video gets no metric row at
 *   all (clean-baseline restart for adopted content) — callers must check
 *   shouldWriteMetricRow first.
 */
export function snapshotDeltaMetricDate(input: {
  hasBaseline: boolean;
  publishedAt: string;
  now?: Date;
}): string {
  const now = input.now ?? new Date();

  if (!input.hasBaseline) {
    return formatDateStr(new Date(input.publishedAt));
  }

  return formatDateStr(now);
}

/**
 * Whether a cumulative-snapshot sync should write a metric row (vs. only
 * recording the baseline snapshot). See snapshotDeltaMetricDate.
 */
export function shouldWriteMetricRow(input: {
  hasBaseline: boolean;
  publishedAt: string;
  now?: Date;
}): boolean {
  if (input.hasBaseline) {
    return true;
  }

  const now = input.now ?? new Date();
  const ageHours =
    (now.getTime() - new Date(input.publishedAt).getTime()) / (1000 * 60 * 60);

  return ageHours < 24;
}
