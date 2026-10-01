import 'server-only';

import {
  FORMAT_FAMILIES,
  displayedEngagementRatePercent,
  formatFamilyOfDim,
} from '@kit/clickhouse';
import type {
  AnalyticsPlatform,
  FormatFamily,
  LanguageDimension,
  SegmentConfidence,
} from '@kit/clickhouse';
import {
  LANGUAGE_DIMENSION_SEGMENTS,
  fromDimLanguage,
  queryAudienceRows,
  queryDailyStats,
  queryLanguagePairs,
  querySegmentPerformance,
  queryTotalsByVideoIds,
  queryVideoLanguages,
} from '@kit/clickhouse/server';
import { fetchAllByIds } from '@kit/shared/pagination';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

import { measuredFigure, sumMeasured } from '../lib/export-coverage';
import type { LanguageDivergence } from '../lib/language-divergence';
import { summariseLanguagePairs } from '../lib/language-divergence';
import {
  LANGUAGE_CHECKPOINT_DAYS,
  languageKey,
  resolveLanguageDimension,
} from '../lib/language-labels';
import { compareViewsDesc, viewsToAdd } from '../lib/views';
import type { Views } from '../lib/views';
import { assertScopeAccess } from './scope-access';

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

/** Options every windowed read here takes. */
interface LanguageReadOptions {
  startDate?: Date;
  endDate?: Date;
  /**
   * Which language the figures are grouped by. Resolved through
   * `resolveLanguageDimension` rather than trusted: the actions that call
   * these pass it through from their input, which can be anything.
   */
  dimension?: LanguageDimension;
  /**
   * The page's platform filter (FILM-1709). Narrows the video set every
   * Language figure is built from, so all six follow it.
   */
  platforms?: AnalyticsPlatform[];
}

/** A language's figures at a fixed video age, from querySegmentPerformance. */
export interface LanguageCheckpoint {
  days: number;
  medianViews: number;
  /** Videos old enough to be measured at `days`. Drives `confidence`. */
  matureVideoCount: number;
  confidence: SegmentConfidence;
}

/**
 * Language performance summary
 */
export interface LanguagePerformance {
  /**
   * Null when no language was set — never a defaulted code. What "not set"
   * means depends on the dimension; `languageName` words it.
   */
  language: string | null;
  views: number;
  viewsChange: number; // percentage change vs previous period
  likes: number;
  comments: number;
  shares: number;
  engagement: number; // engagementRatio (FILM-1713), as a percentage
  revenueCents: number;
  contentCount: number;
  /** Every published video in this language, with or without views. */
  videoCount: number;
  /**
   * Null when no video in this language has reached the checkpoint age:
   * there is no median to report, which is not a median of zero.
   */
  checkpoint: LanguageCheckpoint | null;
}

/**
 * Platform × Language matrix entry
 */
export interface PlatformLanguageEntry {
  platform: string;
  /** Null when no language was set. */
  language: string | null;
  views: number;
  likes: number;
  comments: number;
  shares: number;
  engagementRate: number;
  revenueCents: number;
  contentCount: number;
}

/** One format family's totals over the window (FILM-1716). */
export interface FormatFamilyTotals {
  family: FormatFamily;
  views: number;
  likes: number;
  comments: number;
  shares: number;
  engagement: number;
  revenueCents: number;
  /** Null where no video measured it: only YouTube reports it (KB-162). */
  subscribersGained: number | null;
  contentCount: number;
}

/**
 * A project's figures by format family (FILM-1716).
 *
 * This was "shorts vs long-form": `short` and `teaser` in one bucket,
 * everything else in the other, every platform pooled. A trailer read as
 * long-form, a YouTube Short and an X timeline clip as the same product.
 */
export interface ContentTypeComparison {
  /** Families with at least one video, in `FORMAT_FAMILIES` order. */
  families: FormatFamilyTotals[];
  /**
   * Videos no family maps — counted here, never folded into one. Zero
   * unless `video_dim` holds a value the family table does not know, which
   * verify-queries also fails on.
   */
  unclassified: number;
  /** Videos placed by their declared type, their asset duration unknown. */
  durationUnknown: number;
}

// =============================================================================
// Helper: every video in a project, with the language the dimension selects
// =============================================================================

/**
 * A project's videos and the language each is grouped under.
 *
 * Read from `video_dim`, which carries both languages. This used to walk
 * Postgres — seasons, episodes, publishes, then `platform_connections` — and
 * so could only ever see the channel's target language, while every other
 * analytics surface filtered on the publish's. The two agreed only when
 * routing worked, and nothing showed when it had not (FILM-1702).
 *
 * That walk ran under the caller's RLS, which is what kept one tenant out of
 * another's figures. ClickHouse has no row-level security, so the check is
 * made here instead; "no access" answers with nothing, as it always did.
 */
async function resolveProjectVideos(
  projectId: string,
  dimensionInput: unknown,
  contentType?: string,
  platforms?: AnalyticsPlatform[],
) {
  const dimension = resolveLanguageDimension(dimensionInput);

  try {
    await assertScopeAccess({ projectId });
  } catch {
    return null;
  }

  const videos = await queryVideoLanguages({
    scope: { projectId, contentType, platforms },
  });

  if (videos.length === 0) return null;

  const languageByVideo = new Map<string, string | null>();

  for (const video of videos) {
    languageByVideo.set(
      video.videoId,
      dimension === 'channel' ? video.channelLanguage : video.language,
    );
  }

  return {
    videos,
    dimension,
    languageByVideo,
    videoIds: videos.map((video) => video.videoId),
  };
}

// =============================================================================
// Phase 1: Language Performance
// =============================================================================

/**
 * Get language performance breakdown for a project
 */
export async function getLanguagePerformance(
  projectId: string,
  options?: LanguageReadOptions,
): Promise<LanguagePerformance[]> {
  const endDate = options?.endDate || new Date();
  const startDate =
    options?.startDate || new Date(endDate.getTime() - THIRTY_DAYS_MS);

  // Previous period for comparison
  const periodDays =
    (endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24);
  const previousEndDate = new Date(startDate.getTime() - 1);
  const previousStartDate = new Date(
    previousEndDate.getTime() - periodDays * 24 * 60 * 60 * 1000,
  );

  const resolved = await resolveProjectVideos(
    projectId,
    options?.dimension,
    undefined,
    options?.platforms,
  );
  if (!resolved) return [];

  const { videos, videoIds, languageByVideo, dimension } = resolved;

  const startDateStr = startDate.toISOString().split('T')[0]!;
  const endDateStr = endDate.toISOString().split('T')[0]!;
  const prevStartStr = previousStartDate.toISOString().split('T')[0]!;
  const prevEndStr = previousEndDate.toISOString().split('T')[0]!;

  // The windowed totals, and the same per-language query the Deep Dive
  // runs. `minVideos: 1` because a thin language is dimmed on screen, not
  // dropped here: the gate that hides it would hide the only figure a new
  // channel has.
  const [currentTotals, previousTotals, segments] = await Promise.all([
    queryTotalsByVideoIds(videoIds, {
      startDate: startDateStr,
      endDate: endDateStr,
      projectIds: [projectId],
    }),
    queryTotalsByVideoIds(videoIds, {
      startDate: prevStartStr,
      endDate: prevEndStr,
      projectIds: [projectId],
    }),
    querySegmentPerformance({
      scope: { projectId, platforms: options?.platforms },
      segment: { kind: LANGUAGE_DIMENSION_SEGMENTS[dimension] },
      minVideos: 1,
      checkpointDays: LANGUAGE_CHECKPOINT_DAYS,
    }),
  ]);

  // Every language with a published video gets a row, views or not. Built
  // from the window's totals alone, a language with a quiet month vanished
  // and read as "we do not publish in it".
  const languageStats = new Map<
    string | null,
    {
      views: number;
      likes: number;
      comments: number;
      shares: number;
      revenueCents: number;
      publishCount: number;
      videoCount: number;
    }
  >();

  for (const video of videos) {
    const language = languageByVideo.get(video.videoId) ?? null;
    const current = languageStats.get(language) || {
      views: 0,
      likes: 0,
      comments: 0,
      shares: 0,
      revenueCents: 0,
      publishCount: 0,
      videoCount: 0,
    };

    current.videoCount++;
    languageStats.set(language, current);
  }

  for (const [publishId, stats] of currentTotals) {
    const current = languageStats.get(languageByVideo.get(publishId) ?? null);

    if (!current) continue;

    current.views += viewsToAdd(stats.views);
    current.likes += stats.likes;
    current.comments += stats.comments;
    current.shares += stats.shares;
    current.revenueCents += stats.revenue_cents;
    current.publishCount++;
  }

  // Previous period views by language
  const previousViewsByLanguage = new Map<string | null, number>();
  for (const [publishId, stats] of previousTotals) {
    const language = languageByVideo.get(publishId) ?? null;
    previousViewsByLanguage.set(
      language,
      (previousViewsByLanguage.get(language) || 0) + viewsToAdd(stats.views),
    );
  }

  const checkpointByLanguage = new Map<string | null, LanguageCheckpoint>();
  for (const row of segments) {
    checkpointByLanguage.set(fromDimLanguage(row.segment), {
      days: LANGUAGE_CHECKPOINT_DAYS,
      medianViews: row.medianViews,
      matureVideoCount: row.matureVideoCount,
      confidence: row.confidence,
    });
  }

  // Build result
  const results: LanguagePerformance[] = [];
  for (const [language, stats] of languageStats) {
    const previousViews = previousViewsByLanguage.get(language) || 0;
    const viewsChange =
      previousViews > 0
        ? ((stats.views - previousViews) / previousViews) * 100
        : stats.views > 0
          ? 100
          : 0;

    const engagement = displayedEngagementRatePercent(stats);

    results.push({
      language,
      views: stats.views,
      viewsChange,
      likes: stats.likes,
      comments: stats.comments,
      shares: stats.shares,
      engagement,
      revenueCents: stats.revenueCents,
      contentCount: stats.publishCount,
      videoCount: stats.videoCount,
      checkpoint: checkpointByLanguage.get(language) ?? null,
    });
  }

  return results.sort((a, b) => b.views - a.views);
}

// =============================================================================
// Phase 2: Platform × Language Matrix
// =============================================================================

/**
 * Get platform × language performance matrix
 */
export async function getPlatformLanguageMatrix(
  projectId: string,
  options?: LanguageReadOptions,
): Promise<PlatformLanguageEntry[]> {
  const endDate = options?.endDate || new Date();
  const startDate =
    options?.startDate || new Date(endDate.getTime() - THIRTY_DAYS_MS);

  const resolved = await resolveProjectVideos(
    projectId,
    options?.dimension,
    undefined,
    options?.platforms,
  );
  if (!resolved) return [];

  const { videos, videoIds, languageByVideo } = resolved;

  const startDateStr = startDate.toISOString().split('T')[0]!;
  const endDateStr = endDate.toISOString().split('T')[0]!;

  // Build publish -> platform map
  const publishPlatformMap = new Map<string, string>();
  for (const video of videos) {
    publishPlatformMap.set(video.videoId, video.platform || 'unknown');
  }

  const perVideoTotals = await queryTotalsByVideoIds(videoIds, {
    startDate: startDateStr,
    endDate: endDateStr,
    projectIds: [projectId],
  });

  // Aggregate by platform-language
  const matrix = new Map<
    string,
    {
      platform: string;
      language: string | null;
      views: number;
      likes: number;
      comments: number;
      shares: number;
      revenueCents: number;
      publishCount: number;
    }
  >();

  for (const [publishId, stats] of perVideoTotals) {
    const platform = publishPlatformMap.get(publishId) || 'unknown';
    const language = languageByVideo.get(publishId) ?? null;
    const key = `${platform}:${languageKey(language)}`;

    const current = matrix.get(key) || {
      platform,
      language,
      views: 0,
      likes: 0,
      comments: 0,
      shares: 0,
      revenueCents: 0,
      publishCount: 0,
    };

    current.views += viewsToAdd(stats.views);
    current.likes += stats.likes;
    current.comments += stats.comments;
    current.shares += stats.shares;
    current.revenueCents += stats.revenue_cents;
    current.publishCount++;

    matrix.set(key, current);
  }

  // Build result
  const results: PlatformLanguageEntry[] = [];
  for (const entry of matrix.values()) {
    const engagementRate = displayedEngagementRatePercent(entry);

    results.push({
      platform: entry.platform,
      language: entry.language,
      views: entry.views,
      likes: entry.likes,
      comments: entry.comments,
      shares: entry.shares,
      engagementRate,
      revenueCents: entry.revenueCents,
      contentCount: entry.publishCount,
    });
  }

  return results.sort((a, b) => b.views - a.views);
}

// =============================================================================
// Format family comparison (FILM-1716)
// =============================================================================

/**
 * A project's figures by format family over a window
 */
export async function getContentTypeComparison(
  projectId: string,
  options?: Omit<LanguageReadOptions, 'dimension'>,
): Promise<ContentTypeComparison> {
  const endDate = options?.endDate || new Date();
  const startDate =
    options?.startDate || new Date(endDate.getTime() - THIRTY_DAYS_MS);

  const resolved = await resolveProjectVideos(
    projectId,
    undefined,
    undefined,
    options?.platforms,
  );
  if (!resolved) return getEmptyComparison();

  const { videos, videoIds } = resolved;

  const startDateStr = startDate.toISOString().split('T')[0]!;
  const endDateStr = endDate.toISOString().split('T')[0]!;

  const familyByVideo = new Map(
    videos.map((video) => [
      video.videoId,
      formatFamilyOfDim({
        platform: video.platform,
        content_type: video.contentType,
        asset_duration_seconds: video.assetDurationSeconds,
      }),
    ]),
  );

  const perVideoTotals = await queryTotalsByVideoIds(videoIds, {
    startDate: startDateStr,
    endDate: endDateStr,
    projectIds: [projectId],
  });

  const totals = new Map<
    FormatFamily,
    Omit<FormatFamilyTotals, 'engagement'>
  >();
  let unclassified = 0;
  let durationUnknown = 0;

  for (const [publishId, stats] of perVideoTotals) {
    const placed = familyByVideo.get(publishId);

    if (!placed?.ok) {
      unclassified++;
      continue;
    }
    if (!placed.duration.known) durationUnknown++;

    const target = totals.get(placed.family) ?? {
      family: placed.family,
      views: 0,
      likes: 0,
      comments: 0,
      shares: 0,
      revenueCents: 0,
      subscribersGained: null,
      contentCount: 0,
    };

    target.views += viewsToAdd(stats.views);
    target.likes += stats.likes;
    target.comments += stats.comments;
    target.shares += stats.shares;
    target.revenueCents += stats.revenue_cents;
    // Only a measured gain adds; none measured stays null (KB-162).
    target.subscribersGained = sumMeasured([
      target.subscribersGained,
      measuredFigure(stats, 'subscribers_gained'),
    ]).value;
    target.contentCount++;
    totals.set(placed.family, target);
  }

  return {
    families: FORMAT_FAMILIES.flatMap((family) => {
      const total = totals.get(family);
      return total
        ? [{ ...total, engagement: displayedEngagementRatePercent(total) }]
        : [];
    }),
    unclassified,
    durationUnknown,
  };
}

function getEmptyComparison(): ContentTypeComparison {
  return { families: [], unclassified: 0, durationUnknown: 0 };
}

// =============================================================================
// Phase 3: Shorts Source Performance
// =============================================================================

/**
 * Shorts performance with source episode info
 */
export interface ShortsSourcePerformance {
  publishId: string;
  publishTitle: string;
  sourceEpisodeId: string | null;
  sourceEpisodeTitle: string | null;
  sourceShotId: string | null;
  /** Null when no language was set. */
  language: string | null;
  platform: string;
  /** Null for a Facebook Short: no single view (KB-153). */
  views: Views;
  likes: number;
  comments: number;
  engagement: number | null;
}

/**
 * Get shorts performance with source episode/shot tracing
 * Shows which clips perform best across languages and platforms
 */
export async function getShortsSourcePerformance(
  projectId: string,
  options?: LanguageReadOptions & { limit?: number },
): Promise<ShortsSourcePerformance[]> {
  const endDate = options?.endDate || new Date();
  const startDate =
    options?.startDate || new Date(endDate.getTime() - THIRTY_DAYS_MS);
  const limit = options?.limit || 10;

  const resolved = await resolveProjectVideos(
    projectId,
    options?.dimension,
    'short',
    options?.platforms,
  );

  if (!resolved) return [];

  const { videos, videoIds, languageByVideo } = resolved;

  const startDateStr = startDate.toISOString().split('T')[0]!;
  const endDateStr = endDate.toISOString().split('T')[0]!;

  // Get metrics from ClickHouse
  const perVideoTotals = await queryTotalsByVideoIds(videoIds, {
    startDate: startDateStr,
    endDate: endDateStr,
    projectIds: [projectId],
  });

  // Build results
  const results: ShortsSourcePerformance[] = [];
  for (const video of videos) {
    const stats = perVideoTotals.get(video.videoId);
    if (!stats) continue;

    // A Facebook Short has no views to divide by: not measured (KB-153).
    const engagement =
      stats.views === null
        ? null
        : stats.views > 0
          ? ((stats.likes + stats.comments) / stats.views) * 100
          : 0;

    results.push({
      publishId: video.videoId,
      publishTitle: video.title || 'Untitled Short',
      sourceEpisodeId: video.episodeId,
      sourceEpisodeTitle: null,
      sourceShotId: null, // Will be available after migration
      language: languageByVideo.get(video.videoId) ?? null,
      platform: video.platform,
      views: stats.views,
      likes: stats.likes,
      comments: stats.comments,
      engagement,
    });
  }

  const top = results.sort(compareViewsDesc).slice(0, limit);

  // Episode titles are not a dimension, so they stay in Postgres — looked
  // up for the rows that survived the cut, not for the whole library.
  const episodeTitles = await fetchEpisodeTitles(
    top.flatMap((short) =>
      short.sourceEpisodeId ? [short.sourceEpisodeId] : [],
    ),
  );

  return top.map((short) => ({
    ...short,
    sourceEpisodeTitle: short.sourceEpisodeId
      ? (episodeTitles.get(short.sourceEpisodeId) ?? null)
      : null,
  }));
}

async function fetchEpisodeTitles(
  episodeIds: string[],
): Promise<Map<string, string>> {
  const titles = new Map<string, string>();
  const uniqueIds = [...new Set(episodeIds)];

  if (uniqueIds.length === 0) return titles;

  const client = getSupabaseServerClient();

  const episodes = await fetchAllByIds<{ id: string; title: string }>(
    uniqueIds,
    (chunk, from, to) =>
      client
        .from('episodes')
        .select('id, title')
        .in('id', chunk)
        .order('id')
        .range(from, to),
    'shorts episodes',
  );

  for (const episode of episodes) {
    titles.set(episode.id, episode.title);
  }

  return titles;
}

// =============================================================================
// Phase 4: Geography by Language
// =============================================================================

/**
 * Geography breakdown for a language
 */
export interface GeographyByLanguage {
  /** Null when no language was set. */
  language: string | null;
  countries: {
    country: string;
    views: number;
    percentage: number;
  }[];
}

/**
 * Get geographic distribution of views by language.
 * NOTE: Geography data in ClickHouse extra_metrics is not yet populated
 * by the ingestion layer. This function returns view-based totals
 * until extra_metrics includes geography from platform APIs.
 */
export async function getGeographyByLanguage(
  projectId: string,
  options?: LanguageReadOptions,
): Promise<GeographyByLanguage[]> {
  const endDate = options?.endDate || new Date();
  const startDate =
    options?.startDate || new Date(endDate.getTime() - THIRTY_DAYS_MS);

  const resolved = await resolveProjectVideos(
    projectId,
    options?.dimension,
    undefined,
    options?.platforms,
  );
  if (!resolved) return [];

  const { videoIds, languageByVideo } = resolved;

  const startDateStr = startDate.toISOString().split('T')[0]!;
  const endDateStr = endDate.toISOString().split('T')[0]!;

  // Per-video totals weight the per-video country breakdowns
  const [perVideoTotals, countryRows] = await Promise.all([
    queryTotalsByVideoIds(videoIds, {
      startDate: startDateStr,
      endDate: endDateStr,
      projectIds: [projectId],
    }),
    queryAudienceRows({
      videoIds,
      projectIds: [projectId],
      dimension: 'country',
    }),
  ]);

  // language → country → weighted views
  const byLanguage = new Map<string | null, Map<string, number>>();

  for (const row of countryRows) {
    const language = languageByVideo.get(row.videoId) ?? null;
    const videoViews = perVideoTotals.get(row.videoId)?.views || 0;
    const weight =
      row.views > 0 ? row.views : (row.percentage / 100) * videoViews;

    if (weight <= 0) continue;

    const countries = byLanguage.get(language) ?? new Map<string, number>();
    countries.set(row.key, (countries.get(row.key) ?? 0) + weight);
    byLanguage.set(language, countries);
  }

  // Videos with no audience rows still contribute to their language bucket
  for (const [publishId, stats] of perVideoTotals) {
    const language = languageByVideo.get(publishId) ?? null;
    if (!byLanguage.has(language) && stats.views !== null && stats.views > 0) {
      byLanguage.set(language, new Map([['Unknown', stats.views]]));
    }
  }

  const results: GeographyByLanguage[] = [];

  for (const [language, countries] of byLanguage) {
    const total = Array.from(countries.values()).reduce((s, v) => s + v, 0);
    if (total <= 0) continue;

    results.push({
      language,
      countries: Array.from(countries.entries())
        .filter(([, views]) => views > 0)
        .map(([country, views]) => ({
          country,
          views: Math.round(views),
          percentage: Math.round((views / total) * 1000) / 10,
        }))
        .sort((a, b) => b.views - a.views),
    });
  }

  return results.sort((a, b) => {
    const aTotal = a.countries.reduce((sum, c) => sum + c.views, 0);
    const bTotal = b.countries.reduce((sum, c) => sum + c.views, 0);
    return bTotal - aTotal;
  });
}

// =============================================================================
// Language Trend Over Time
// =============================================================================

/**
 * Daily views by language for trend chart
 */
export interface LanguageTrendEntry {
  date: string;
  /**
   * Keyed by `languageKey`, because a record key cannot be null: a language
   * nobody set is under LANGUAGE_NOT_SET_KEY, never under a real code.
   */
  viewsByLanguage: Record<string, number>;
}

/**
 * Get daily views by language for trend visualization.
 * Uses ClickHouse queryDailyStats for per-video daily data.
 */
export async function getLanguageTrend(
  projectId: string,
  options?: LanguageReadOptions,
): Promise<LanguageTrendEntry[]> {
  const endDate = options?.endDate || new Date();
  const startDate =
    options?.startDate || new Date(endDate.getTime() - THIRTY_DAYS_MS);

  const resolved = await resolveProjectVideos(
    projectId,
    options?.dimension,
    undefined,
    options?.platforms,
  );
  if (!resolved) return [];

  const { videoIds, languageByVideo } = resolved;

  const startDateStr = startDate.toISOString().split('T')[0]!;
  const endDateStr = endDate.toISOString().split('T')[0]!;

  // Get daily stats from ClickHouse
  const dailyStats = await queryDailyStats({
    videoIds,
    startDate: startDateStr,
    endDate: endDateStr,
  });

  // Aggregate by date and language
  const trendByDate = new Map<string, Map<string, number>>();

  for (const stat of dailyStats) {
    const date = stat.metric_date;
    const language = languageKey(languageByVideo.get(stat.video_id) ?? null);

    if (!trendByDate.has(date)) {
      trendByDate.set(date, new Map());
    }

    const dateData = trendByDate.get(date)!;
    dateData.set(
      language,
      (dateData.get(language) || 0) + viewsToAdd(stat.views),
    );
  }

  // Convert to array
  return Array.from(trendByDate.entries())
    .map(([date, langMap]) => ({
      date,
      viewsByLanguage: Object.fromEntries(langMap),
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

// =============================================================================
// Where the two dimensions disagree
// =============================================================================

/**
 * How many of a project's videos are in a language other than their
 * channel's target.
 *
 * The two language dimensions agree only when routing worked. A video that
 * landed on the wrong channel, or a channel carrying mixed content, makes
 * them disagree, and the Language tab's two settings then tell different
 * stories about the same videos. This is the count that says how far apart
 * those stories are — a routing diagnostic, not a bug report.
 */
export async function getLanguageDivergence(
  projectId: string,
  options?: Pick<LanguageReadOptions, 'platforms'>,
): Promise<LanguageDivergence | null> {
  try {
    await assertScopeAccess({ projectId });
  } catch {
    return null;
  }

  return summariseLanguagePairs(
    await queryLanguagePairs({
      scope: { projectId, platforms: options?.platforms },
    }),
  );
}
