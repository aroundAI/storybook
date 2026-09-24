import 'server-only';

import type {
  AnalyticsPlatform,
  RetentionCurvePoint,
  SnapshotTotals,
  VideoAudienceRow,
  VideoMetric,
} from '@kit/clickhouse';
import { VIEW_DEFINITIONS, formatDateStr } from '@kit/clickhouse';

import type { InstagramInsightsResult } from '../providers/instagram/types';
import type { TikTokAnalyticsResult } from '../providers/tiktok/types';
import type {
  YouTubeAnalyticsResult,
  YouTubeDailyMetrics,
} from '../providers/youtube/types';

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
 * The first day YouTube reports engaged views, from the view-definition
 * registry (FILM-1722) so the date lives in one place. A figure for an
 * earlier day is not the metric, whatever the API returns for it.
 */
const ENGAGED_VIEWS_FROM = (() => {
  const definition = VIEW_DEFINITIONS.find(
    (entry) => entry.id === 'youtube.engagedViews',
  );
  if (!definition?.effectiveFrom) {
    throw new Error('view-definitions has no dated youtube.engagedViews entry');
  }
  return definition.effectiveFrom;
})();

function engagedViewsFor(day: YouTubeDailyMetrics): number | null {
  if (day.date < ENGAGED_VIEWS_FROM) return null;
  return day.engagedViews ?? null;
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
  metricSource?: 'analytics_api' | 'backfill';
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
    metric_source: input.metricSource ?? ('analytics_api' as const),
    avg_view_duration_seconds: day.averageViewDuration,
    // Always set, null included: the Reporting ingest writes this key too,
    // and an omitted field would erase its figure (KB-50).
    engaged_views: engagedViewsFor(day),
    extra_metrics: day.date === latest ? input.extraMetricsJson : '{}',
  }));
}

/**
 * Retention curve points from a YouTube analytics payload (lifetime data;
 * latest fetch replaces earlier points).
 */
export function buildRetentionPoints(input: {
  projectId: string;
  videoId: string;
  analytics: YouTubeAnalyticsResult;
}): RetentionCurvePoint[] {
  const points = input.analytics.retention?.points ?? [];

  return points.map((point) => ({
    project_id: input.projectId,
    video_id: input.videoId,
    platform: 'youtube' as const,
    elapsed_ratio: point.elapsedVideoTimeRatio,
    audience_watch_ratio: point.audienceWatchRatio,
  }));
}

/**
 * Audience breakdown rows (demographics, geography, devices, OS,
 * subscribed status) from a platform analytics payload. These are
 * window/lifetime aggregates — latest fetch wins per key.
 */
export function buildAudienceRows(input: {
  projectId: string;
  videoId: string;
  platform: AnalyticsPlatform;
  analytics:
    | YouTubeAnalyticsResult
    | TikTokAnalyticsResult
    | InstagramInsightsResult;
}): VideoAudienceRow[] {
  const base = {
    project_id: input.projectId,
    video_id: input.videoId,
    platform: input.platform,
  };
  const rows: VideoAudienceRow[] = [];

  const push = (
    dimension: VideoAudienceRow['dimension'],
    key: string,
    values: { views?: number; percentage?: number },
  ) => {
    if (!key) return;
    rows.push({
      ...base,
      dimension,
      key,
      views: values.views ?? 0,
      percentage: values.percentage ?? 0,
    });
  };

  if (input.platform === 'youtube') {
    const data = input.analytics as YouTubeAnalyticsResult;

    for (const group of data.demographics?.ageGroups ?? []) {
      push('age_group', group.ageGroup, { percentage: group.viewPercentage });
    }
    for (const gender of data.demographics?.genders ?? []) {
      push('gender', gender.gender, { percentage: gender.viewPercentage });
    }
    for (const country of data.geography ?? []) {
      push('country', country.country, {
        views: country.views,
        percentage: country.viewPercentage,
      });
    }
    for (const city of data.cityGeography ?? []) {
      push('city', city.city, { views: city.views });
    }
    for (const device of data.deviceBreakdown ?? []) {
      push('device', device.deviceType, { views: device.views });
    }
    for (const os of data.operatingSystem ?? []) {
      push('os', os.operatingSystem, { views: os.views });
    }
    if (data.subscribedStatus) {
      push('follower_status', 'subscribed', {
        views: data.subscribedStatus.subscribed,
      });
      push('follower_status', 'not_subscribed', {
        views: data.subscribedStatus.notSubscribed,
      });
    }

    return rows;
  }

  if (input.platform === 'tiktok') {
    const data = input.analytics as TikTokAnalyticsResult;

    for (const country of data.audience?.countries ?? []) {
      push('country', country.country, { percentage: country.percentage });
    }
    const genders = data.audience?.genderDistribution;
    if (genders) {
      push('gender', 'male', { percentage: genders.male });
      push('gender', 'female', { percentage: genders.female });
      push('gender', 'other', { percentage: genders.other });
    }
    for (const age of data.audience?.ageGroups ?? []) {
      push('age_group', age.ageGroup, { percentage: age.percentage });
    }

    return rows;
  }

  const data = input.analytics as InstagramInsightsResult;

  for (const country of data.audience?.countries ?? []) {
    push('country', country.country, { views: country.count });
  }
  for (const city of data.audience?.cities ?? []) {
    push('city', city.city, { views: city.count });
  }
  for (const genderAge of data.audience?.genderAge ?? []) {
    push('age_group', genderAge.dimension, { views: genderAge.count });
  }

  return rows;
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
