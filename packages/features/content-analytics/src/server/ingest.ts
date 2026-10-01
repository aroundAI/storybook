import 'server-only';

import type {
  AllSurfaceAggregates,
  AnalyticsPlatform,
  FacebookDenominators,
  RetentionCurvePoint,
  SnapshotTotals,
  VideoAudienceRow,
  VideoMetric,
  YouTubeVideoMetric,
} from '@kit/clickhouse';
import {
  FACEBOOK_DENOMINATOR_COLUMNS,
  VIEW_DEFINITIONS,
  formatDateStr,
} from '@kit/clickhouse';

import type {
  FacebookInsightsResult,
  FacebookRetentionGraph,
} from '../providers/facebook/types';
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
export interface CumulativeTotals extends AllSurfaceAggregates {
  /** Null for Facebook, which has no single view (migration 020). */
  views: number | null;
  likes: number;
  comments: number;
  shares: number;
  /** Null where the platform does not measure it (migration 017). */
  saves: number | null;
  watch_time_seconds: number | null;
  subscribers_gained: number | null;
  /**
   * Lifetime unique accounts reached. Instagram only; null when not
   * measured. Not a counter: its delta is "first-time viewers that day".
   */
  accounts_reached: number | null;
  /** Lifetime reposts. Instagram FEED and REELS only; null when not measured. */
  reposts: number | null;
  /** Facebook's own denominators (migration 020); absent on every other platform. */
  denominators?: FacebookDenominators;
}

/**
 * The day's increase in a post's lifetime reach (FILM-1712). NULL when it
 * cannot be measured: today's figure is missing, or the baseline snapshot
 * exists but recorded no reach (taken before migration 015) — subtracting
 * from nothing would put the post's whole lifetime on one day. With no
 * baseline at all, the lifetime is the delta, as for every counter.
 */
export function accountsReachedDelta(
  current: number | null,
  baseline: SnapshotTotals | null,
): number | null {
  if (current === null) return null;
  if (!baseline) return current;
  if (baseline.accounts_reached === null) return null;

  return Math.max(0, current - baseline.accounts_reached);
}

/**
 * A nullable counter's delta (migration 017): null when today's figure is
 * unmeasured, or when the baseline snapshot recorded none — subtracting from
 * nothing would put the whole lifetime on one day. Clamped as every counter.
 */
function measuredDelta(
  current: number | null,
  baseline: number | null,
): number | null {
  if (current === null || baseline === null) return null;

  return Math.max(0, current - baseline);
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
    views: measuredDelta(current.views, baseline.views),
    likes: clamp(current.likes, baseline.likes),
    comments: clamp(current.comments, baseline.comments),
    shares: clamp(current.shares, baseline.shares),
    saves: measuredDelta(current.saves, baseline.saves),
    watch_time_seconds: measuredDelta(
      current.watch_time_seconds,
      baseline.watch_time_seconds,
    ),
    subscribers_gained: measuredDelta(
      current.subscribers_gained,
      baseline.subscribers_gained,
    ),
    accounts_reached: accountsReachedDelta(current.accounts_reached, baseline),
    reposts: measuredDelta(current.reposts, baseline.reposts),
    all_surface_views: measuredDelta(
      current.all_surface_views,
      baseline.all_surface_views,
    ),
    all_surface_likes: measuredDelta(
      current.all_surface_likes,
      baseline.all_surface_likes,
    ),
    all_surface_comments: measuredDelta(
      current.all_surface_comments,
      baseline.all_surface_comments,
    ),
    ...(current.denominators && {
      denominators: denominatorDelta(current.denominators, baseline),
    }),
  };
}

/**
 * Each of Facebook's denominators as a counter delta: null when today's
 * figure or the baseline's is unmeasured, as for every nullable counter.
 */
function denominatorDelta(
  current: FacebookDenominators,
  baseline: SnapshotTotals,
): FacebookDenominators {
  return Object.fromEntries(
    FACEBOOK_DENOMINATOR_COLUMNS.map((column) => [
      column,
      measuredDelta(current[column], baseline[column] ?? null),
    ]),
  ) as Record<keyof FacebookDenominators, number | null>;
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
 * `extra_metrics` is no longer written (FILM-1712): it held each provider's
 * raw payload, which nothing read, and Instagram's reach — its only figure
 * with no column — now has `accounts_reached`. The column stays, empty.
 */
const NO_EXTRA_METRICS = '{}';

/**
 * Map YouTube per-day metrics to daily ClickHouse rows.
 */
export function buildYouTubeDailyRows(input: {
  projectId: string;
  videoId: string;
  dailyData: YouTubeDailyMetrics[];
  metricSource?: 'analytics_api' | 'backfill';
}): YouTubeVideoMetric[] {
  return input.dailyData.map((day) => ({
    project_id: input.projectId,
    video_id: input.videoId,
    platform: 'youtube' as const,
    metric_date: day.date,
    views: day.views,
    likes: day.likes,
    comments: day.comments,
    shares: day.shares,
    saves: null,
    watch_time_seconds: Math.round(day.estimatedMinutesWatched * 60),
    revenue_cents: 0,
    subscribers_gained: day.subscribersGained,
    subscribers_lost: day.subscribersLost,
    metric_source: input.metricSource ?? ('analytics_api' as const),
    avg_view_duration_seconds: day.averageViewDuration,
    avg_view_percentage: day.averageViewPercentage,
    dislikes: day.dislikes,
    // Always set, null included: the Reporting ingest writes this key too,
    // and an omitted field would erase its figure (KB-50).
    engaged_views: engagedViewsFor(day),
    extra_metrics: NO_EXTRA_METRICS,
  }));
}

/**
 * A TikTok/Instagram `video_metrics` row: the lifetime-counter delta for one
 * day. What each platform does not report on any surface we ingest is pinned
 * to `null` by the type — not measured. A 0 there was read as a measurement
 * and pooled with YouTube's figures (KB-111, KB-114).
 *
 * - Neither reports subscribers lost, average view duration, average
 *   percentage viewed or dislikes (KB-111).
 * - TikTok: saves have no creator-auth surface, watch time is Business API
 *   only, and there are no per-video follower gains (KB-114).
 * - Instagram: Reels watch time is documented but never requested
 *   (FILM-1712), and neither are follows, so follower gains are not
 *   measured either. Saves are.
 */
type NeverMeasuredBySnapshot = {
  subscribers_lost: null;
  avg_view_duration_seconds: null;
  avg_view_percentage: null;
  dislikes: null;
};

export type SnapshotDeltaMetric = VideoMetric &
  NeverMeasuredBySnapshot &
  (
    | {
        platform: 'tiktok';
        saves: null;
        watch_time_seconds: null;
        subscribers_gained: null;
        /** Reach is Business API only (FILM-1730), which we do not call. */
        accounts_reached: null;
        reposts: null;
        /** Instagram-only aggregates (FILM-1722). */
        all_surface_views: null;
        all_surface_likes: null;
        all_surface_comments: null;
      }
    | {
        platform: 'instagram';
        /** Measured, except where Meta omits it (STORY has no `saved`). */
        saves: number | null;
        /** Reels only (FILM-1712); null for other media or when omitted. */
        watch_time_seconds: number | null;
        subscribers_gained: null;
        accounts_reached: number | null;
        /** FEED and REELS (FILM-1712); null for a Story or when omitted. */
        reposts: number | null;
        /** Boosted placements included (FILM-1722); never views, likes or comments. */
        all_surface_views: number | null;
        all_surface_likes: number | null;
        all_surface_comments: number | null;
      }
    | (FacebookDenominators & {
        platform: 'facebook';
        /** Four kinds of view and none of them this column's (FILM-1722). */
        views: null;
        saves: null;
        /** Replays included on a reel. */
        watch_time_seconds: number | null;
        /** Follows Meta credits to a reel; null for a video in the player. */
        subscribers_gained: number | null;
        /** `post_total_media_view_unique`: people, not plays. */
        accounts_reached: number | null;
        reposts: null;
        /** Instagram-only aggregates (FILM-1722). */
        all_surface_views: null;
        all_surface_likes: null;
        all_surface_comments: null;
      })
  ) &
  ({ platform: 'facebook' } | { views: number });

export function buildSnapshotDeltaRow(input: {
  projectId: string;
  videoId: string;
  platform: 'tiktok' | 'instagram' | 'facebook';
  metricDate: string;
  delta: CumulativeTotals;
}): SnapshotDeltaMetric {
  const base = {
    project_id: input.projectId,
    video_id: input.videoId,
    metric_date: input.metricDate,
    likes: input.delta.likes,
    comments: input.delta.comments,
    shares: input.delta.shares,
    revenue_cents: 0,
    subscribers_lost: null,
    avg_view_duration_seconds: null,
    avg_view_percentage: null,
    dislikes: null,
    metric_source: 'snapshot_delta' as const,
    extra_metrics: NO_EXTRA_METRICS,
  };

  if (input.platform === 'facebook') {
    if (!input.delta.denominators) {
      throw new Error('A Facebook row needs its denominators (FILM-1720)');
    }

    return {
      ...base,
      ...input.delta.denominators,
      platform: 'facebook',
      views: null,
      saves: null,
      watch_time_seconds: input.delta.watch_time_seconds,
      subscribers_gained: input.delta.subscribers_gained,
      accounts_reached: input.delta.accounts_reached,
      reposts: null,
      all_surface_views: null,
      all_surface_likes: null,
      all_surface_comments: null,
    };
  }

  // TikTok and Instagram measure views on every row; only a Facebook
  // snapshot holds a NULL one, so a NULL here is a wrong baseline, not a 0.
  const views = input.delta.views;
  if (views === null) {
    throw new Error(`A ${input.platform} row has no views (migration 020)`);
  }

  if (input.platform === 'tiktok') {
    return {
      ...base,
      views,
      platform: 'tiktok',
      saves: null,
      watch_time_seconds: null,
      subscribers_gained: null,
      accounts_reached: null,
      reposts: null,
      all_surface_views: null,
      all_surface_likes: null,
      all_surface_comments: null,
    };
  }

  return {
    ...base,
    views,
    platform: 'instagram',
    saves: input.delta.saves,
    watch_time_seconds: input.delta.watch_time_seconds,
    subscribers_gained: null,
    accounts_reached: input.delta.accounts_reached,
    reposts: input.delta.reposts,
    all_surface_views: input.delta.all_surface_views,
    all_surface_likes: input.delta.all_surface_likes,
    all_surface_comments: input.delta.all_surface_comments,
  };
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
 * Facebook's `total_video_retention_graph` as curve points (FILM-1720):
 * the share of 3-second views still playing at each of 40 equal intervals.
 * Latest fetch replaces earlier points, as for YouTube's lifetime curve.
 */
export function buildFacebookRetentionPoints(input: {
  projectId: string;
  videoId: string;
  retention: FacebookRetentionGraph | null;
}): RetentionCurvePoint[] {
  return (input.retention ?? []).map((point) => ({
    project_id: input.projectId,
    video_id: input.videoId,
    platform: 'facebook' as const,
    elapsed_ratio: point.elapsedRatio,
    audience_watch_ratio: point.watchRatio,
  }));
}

/**
 * A Facebook sync's lifetime totals. No `views`: Facebook's kinds of view
 * are its denominators. Reactions, comments and shares are counted as Meta
 * answers them; a figure it leaves out of an answer that otherwise came
 * back is 0 (Meta omits a metric with nothing to count — inferred, see the
 * capability reference's ledger).
 */
export function facebookCumulativeTotals(
  result: FacebookInsightsResult,
): CumulativeTotals {
  const totals = result.totals;

  return {
    views: null,
    likes: totals.reactions ?? 0,
    comments: totals.comments ?? 0,
    shares: totals.shares ?? 0,
    saves: null,
    watch_time_seconds:
      totals.viewTimeMs === null ? null : Math.round(totals.viewTimeMs / 1000),
    subscribers_gained: totals.follows,
    accounts_reached: totals.uniqueViewers,
    reposts: null,
    all_surface_views: null,
    all_surface_likes: null,
    all_surface_comments: null,
    denominators: {
      media_views: totals.mediaViews,
      plays: totals.firstPlays,
      replays: totals.replayCount,
      views_3s: totals.threeSecondViews,
      views_3s_organic: totals.threeSecondViewsOrganic,
      views_3s_paid: totals.threeSecondViewsPaid,
      views_3s_autoplayed: totals.threeSecondViewsAutoplayed,
      views_3s_clicked_to_play: totals.threeSecondViewsClickedToPlay,
      views_15s: totals.fifteenSecondViews,
      complete_views: totals.completeViews,
    },
  };
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
  for (const age of data.audience?.ages ?? []) {
    push('age_group', age.ageGroup, { views: age.count });
  }
  // Meta's F/M/U, stored as the gender values TikTok's rows use
  const INSTAGRAM_GENDER: Record<string, string> = {
    F: 'female',
    M: 'male',
    U: 'other',
  };
  for (const gender of data.audience?.genders ?? []) {
    push('gender', INSTAGRAM_GENDER[gender.gender] ?? gender.gender, {
      views: gender.count,
    });
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
