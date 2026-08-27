'use server';

import 'server-only';

import {
  queryAudienceRows,
  queryDailyStats,
  queryTotalsByVideoIds,
} from '@kit/clickhouse/server';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Language performance summary
 */
export interface LanguagePerformance {
  language: string;
  views: number;
  viewsChange: number; // percentage change vs previous period
  likes: number;
  comments: number;
  shares: number;
  engagement: number; // (likes + comments + shares) / views * 100
  revenueCents: number;
  contentCount: number;
}

/**
 * Platform × Language matrix entry
 */
export interface PlatformLanguageEntry {
  platform: string;
  language: string;
  views: number;
  likes: number;
  comments: number;
  shares: number;
  engagementRate: number;
  revenueCents: number;
  contentCount: number;
}

/**
 * Content type comparison (shorts vs long-form)
 */
export interface ContentTypeComparison {
  longForm: {
    views: number;
    likes: number;
    comments: number;
    shares: number;
    engagement: number;
    revenueCents: number;
    subscribersGained: number;
    contentCount: number;
  };
  shorts: {
    views: number;
    likes: number;
    comments: number;
    shares: number;
    engagement: number;
    revenueCents: number;
    subscribersGained: number;
    contentCount: number;
  };
}

// =============================================================================
// Helper: resolve publish IDs + language map for a project
// =============================================================================

async function resolveProjectPublishes(
  projectId: string,
  extraSelect?: string,
) {
  const client = getSupabaseServerClient();

  const { data: seasons } = await client
    .from('seasons')
    .select('id')
    .eq('project_id', projectId)
    .is('deleted_at', null);

  if (!seasons || seasons.length === 0) return null;

  const seasonIds = seasons.map((s) => s.id);

  const { data: episodes } = await client
    .from('episodes')
    .select('id, title')
    .in('season_id', seasonIds)
    .is('deleted_at', null);

  if (!episodes || episodes.length === 0) return null;

  const episodeIds = episodes.map((e) => e.id);

  const selectCols = extraSelect
    ? `id, platform_connection_id, ${extraSelect}`
    : 'id, platform_connection_id';
  const { data: rawPublishes } = await client
    .from('publishes')
    .select(selectCols)
    .in('episode_id', episodeIds);

  if (!rawPublishes || rawPublishes.length === 0) return null;

  // Cast to proper shape — Supabase returns GenericStringError for dynamic selects
  const publishes = rawPublishes as unknown as Array<{
    id: string;
    platform_connection_id: string | null;
    [key: string]: unknown;
  }>;

  // Build language map from platform connections
  const connectionIds = [
    ...new Set(publishes.map((p) => p.platform_connection_id).filter(Boolean)),
  ];
  const languageByConnection = new Map<string, string>();

  if (connectionIds.length > 0) {
    const { data: connections } = await client
      .from('platform_connections')
      .select('id, language')
      .in('id', connectionIds as string[]);

    for (const conn of connections || []) {
      const c = conn as unknown as { id: string; language?: string };
      languageByConnection.set(c.id, c.language || 'en');
    }
  }

  const publishLanguageMap = new Map<string, string>();
  for (const p of publishes) {
    const connId = p.platform_connection_id;
    const language = connId ? languageByConnection.get(connId) || 'en' : 'en';
    publishLanguageMap.set(p.id, language);
  }

  return {
    publishes,
    episodes,
    publishLanguageMap,
    publishIds: publishes.map((p) => p.id),
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
  options?: { startDate?: Date; endDate?: Date },
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

  const resolved = await resolveProjectPublishes(projectId);
  if (!resolved) return [];

  const { publishIds, publishLanguageMap } = resolved;

  const startDateStr = startDate.toISOString().split('T')[0]!;
  const endDateStr = endDate.toISOString().split('T')[0]!;
  const prevStartStr = previousStartDate.toISOString().split('T')[0]!;
  const prevEndStr = previousEndDate.toISOString().split('T')[0]!;

  // Query ClickHouse for current and previous periods
  const [currentTotals, previousTotals] = await Promise.all([
    queryTotalsByVideoIds(publishIds, {
      startDate: startDateStr,
      endDate: endDateStr,
    }),
    queryTotalsByVideoIds(publishIds, {
      startDate: prevStartStr,
      endDate: prevEndStr,
    }),
  ]);

  // Aggregate by language (current period)
  const languageStats = new Map<
    string,
    {
      views: number;
      likes: number;
      comments: number;
      shares: number;
      revenueCents: number;
      publishCount: number;
    }
  >();

  for (const [publishId, stats] of currentTotals) {
    const language = publishLanguageMap.get(publishId) || 'en';
    const current = languageStats.get(language) || {
      views: 0,
      likes: 0,
      comments: 0,
      shares: 0,
      revenueCents: 0,
      publishCount: 0,
    };

    current.views += stats.views;
    current.likes += stats.likes;
    current.comments += stats.comments;
    current.shares += stats.shares;
    current.revenueCents += stats.revenue_cents;
    current.publishCount++;

    languageStats.set(language, current);
  }

  // Previous period views by language
  const previousViewsByLanguage = new Map<string, number>();
  for (const [publishId, stats] of previousTotals) {
    const language = publishLanguageMap.get(publishId) || 'en';
    previousViewsByLanguage.set(
      language,
      (previousViewsByLanguage.get(language) || 0) + stats.views,
    );
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

    const engagement =
      stats.views > 0
        ? ((stats.likes + stats.comments + stats.shares) / stats.views) * 100
        : 0;

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
  options?: { startDate?: Date; endDate?: Date },
): Promise<PlatformLanguageEntry[]> {
  const endDate = options?.endDate || new Date();
  const startDate =
    options?.startDate || new Date(endDate.getTime() - THIRTY_DAYS_MS);

  const resolved = await resolveProjectPublishes(projectId, 'platform');
  if (!resolved) return [];

  const { publishes, publishIds, publishLanguageMap } = resolved;

  const startDateStr = startDate.toISOString().split('T')[0]!;
  const endDateStr = endDate.toISOString().split('T')[0]!;

  // Build publish -> platform map
  const publishPlatformMap = new Map<string, string>();
  for (const p of publishes) {
    publishPlatformMap.set(p.id as string, (p.platform as string) || 'unknown');
  }

  const perVideoTotals = await queryTotalsByVideoIds(publishIds, {
    startDate: startDateStr,
    endDate: endDateStr,
  });

  // Aggregate by platform-language
  const matrix = new Map<
    string,
    {
      platform: string;
      language: string;
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
    const language = publishLanguageMap.get(publishId) || 'en';
    const key = `${platform}:${language}`;

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

    current.views += stats.views;
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
    const engagementRate =
      entry.views > 0
        ? ((entry.likes + entry.comments + entry.shares) / entry.views) * 100
        : 0;

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
// Content Type Comparison (shorts vs long-form)
// =============================================================================

/**
 * Get content type comparison (shorts vs long-form)
 */
export async function getContentTypeComparison(
  projectId: string,
  options?: { startDate?: Date; endDate?: Date },
): Promise<ContentTypeComparison> {
  const endDate = options?.endDate || new Date();
  const startDate =
    options?.startDate || new Date(endDate.getTime() - THIRTY_DAYS_MS);

  const resolved = await resolveProjectPublishes(projectId, 'content_type');
  if (!resolved) return getEmptyComparison();

  const { publishes, publishIds } = resolved;

  const startDateStr = startDate.toISOString().split('T')[0]!;
  const endDateStr = endDate.toISOString().split('T')[0]!;

  // Build content type map
  const publishContentTypeMap = new Map<string, string>();
  for (const p of publishes) {
    publishContentTypeMap.set(
      p.id as string,
      (p.content_type as string) || 'full',
    );
  }

  const perVideoTotals = await queryTotalsByVideoIds(publishIds, {
    startDate: startDateStr,
    endDate: endDateStr,
  });

  // Aggregate by content type
  const longForm = {
    views: 0,
    likes: 0,
    comments: 0,
    shares: 0,
    revenueCents: 0,
    subscribersGained: 0,
    contentCount: 0,
  };
  const shorts = {
    views: 0,
    likes: 0,
    comments: 0,
    shares: 0,
    revenueCents: 0,
    subscribersGained: 0,
    contentCount: 0,
  };

  for (const [publishId, stats] of perVideoTotals) {
    const contentType = publishContentTypeMap.get(publishId) || 'full';
    const isShort = contentType === 'short' || contentType === 'teaser';
    const target = isShort ? shorts : longForm;

    target.views += stats.views;
    target.likes += stats.likes;
    target.comments += stats.comments;
    target.shares += stats.shares;
    target.revenueCents += stats.revenue_cents;
    target.subscribersGained += stats.subscribers_gained;
    target.contentCount++;
  }

  return {
    longForm: {
      ...longForm,
      engagement:
        longForm.views > 0
          ? ((longForm.likes + longForm.comments + longForm.shares) /
              longForm.views) *
            100
          : 0,
    },
    shorts: {
      ...shorts,
      engagement:
        shorts.views > 0
          ? ((shorts.likes + shorts.comments + shorts.shares) / shorts.views) *
            100
          : 0,
    },
  };
}

function getEmptyComparison(): ContentTypeComparison {
  return {
    longForm: {
      views: 0,
      likes: 0,
      comments: 0,
      shares: 0,
      engagement: 0,
      revenueCents: 0,
      subscribersGained: 0,
      contentCount: 0,
    },
    shorts: {
      views: 0,
      likes: 0,
      comments: 0,
      shares: 0,
      engagement: 0,
      revenueCents: 0,
      subscribersGained: 0,
      contentCount: 0,
    },
  };
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
  language: string;
  platform: string;
  views: number;
  likes: number;
  comments: number;
  engagement: number;
}

/**
 * Get shorts performance with source episode/shot tracing
 * Shows which clips perform best across languages and platforms
 */
export async function getShortsSourcePerformance(
  projectId: string,
  options?: { startDate?: Date; endDate?: Date; limit?: number },
): Promise<ShortsSourcePerformance[]> {
  const client = getSupabaseServerClient();

  const endDate = options?.endDate || new Date();
  const startDate =
    options?.startDate || new Date(endDate.getTime() - THIRTY_DAYS_MS);
  const limit = options?.limit || 10;

  // Get project structure
  const { data: seasons } = await client
    .from('seasons')
    .select('id')
    .eq('project_id', projectId)
    .is('deleted_at', null);

  if (!seasons || seasons.length === 0) return [];

  const seasonIds = seasons.map((s) => s.id);

  const { data: episodes } = await client
    .from('episodes')
    .select('id, title')
    .in('season_id', seasonIds)
    .is('deleted_at', null);

  if (!episodes || episodes.length === 0) return [];

  const episodeIds = episodes.map((e) => e.id);
  const episodeTitleMap = new Map<string, string>();
  for (const ep of episodes) {
    episodeTitleMap.set(ep.id, ep.title);
  }

  // Get shorts publishes
  const { data: publishes } = await client
    .from('publishes')
    .select(
      'id, title, platform, platform_connection_id, episode_id, content_type',
    )
    .in('episode_id', episodeIds)
    .eq('content_type', 'short');

  if (!publishes || publishes.length === 0) return [];

  const publishIds = publishes.map((p) => p.id);

  // Get language from platform connections
  const connectionIds = [
    ...new Set(publishes.map((p) => p.platform_connection_id).filter(Boolean)),
  ];
  const languageByConnection = new Map<string, string>();

  if (connectionIds.length > 0) {
    const { data: connections } = await client
      .from('platform_connections')
      .select('id, language')
      .in('id', connectionIds as string[]);

    for (const conn of connections || []) {
      const c = conn as unknown as { id: string; language?: string };
      languageByConnection.set(c.id, c.language || 'en');
    }
  }

  const startDateStr = startDate.toISOString().split('T')[0]!;
  const endDateStr = endDate.toISOString().split('T')[0]!;

  // Get metrics from ClickHouse
  const perVideoTotals = await queryTotalsByVideoIds(publishIds, {
    startDate: startDateStr,
    endDate: endDateStr,
  });

  // Build results
  const results: ShortsSourcePerformance[] = [];
  for (const pub of publishes) {
    const stats = perVideoTotals.get(pub.id);
    if (!stats) continue;

    const connId = pub.platform_connection_id;
    const language = connId ? languageByConnection.get(connId) || 'en' : 'en';
    const engagement =
      stats.views > 0
        ? ((stats.likes + stats.comments) / stats.views) * 100
        : 0;

    results.push({
      publishId: pub.id,
      publishTitle: pub.title || 'Untitled Short',
      sourceEpisodeId: pub.episode_id,
      sourceEpisodeTitle: pub.episode_id
        ? episodeTitleMap.get(pub.episode_id) || null
        : null,
      sourceShotId: null, // Will be available after migration
      language,
      platform: pub.platform,
      views: stats.views,
      likes: stats.likes,
      comments: stats.comments,
      engagement,
    });
  }

  return results.sort((a, b) => b.views - a.views).slice(0, limit);
}

// =============================================================================
// Phase 4: Geography by Language
// =============================================================================

/**
 * Geography breakdown for a language
 */
export interface GeographyByLanguage {
  language: string;
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
  options?: { startDate?: Date; endDate?: Date },
): Promise<GeographyByLanguage[]> {
  const endDate = options?.endDate || new Date();
  const startDate =
    options?.startDate || new Date(endDate.getTime() - THIRTY_DAYS_MS);

  const resolved = await resolveProjectPublishes(projectId);
  if (!resolved) return [];

  const { publishIds, publishLanguageMap } = resolved;

  const startDateStr = startDate.toISOString().split('T')[0]!;
  const endDateStr = endDate.toISOString().split('T')[0]!;

  // Per-video totals weight the per-video country breakdowns
  const [perVideoTotals, countryRows] = await Promise.all([
    queryTotalsByVideoIds(publishIds, {
      startDate: startDateStr,
      endDate: endDateStr,
    }),
    queryAudienceRows({ videoIds: publishIds, dimension: 'country' }),
  ]);

  // language → country → weighted views
  const byLanguage = new Map<string, Map<string, number>>();

  for (const row of countryRows) {
    const language = publishLanguageMap.get(row.videoId) || 'en';
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
    const language = publishLanguageMap.get(publishId) || 'en';
    if (!byLanguage.has(language) && stats.views > 0) {
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
  viewsByLanguage: Record<string, number>;
}

/**
 * Get daily views by language for trend visualization.
 * Uses ClickHouse queryDailyStats for per-video daily data.
 */
export async function getLanguageTrend(
  projectId: string,
  options?: { startDate?: Date; endDate?: Date },
): Promise<LanguageTrendEntry[]> {
  const endDate = options?.endDate || new Date();
  const startDate =
    options?.startDate || new Date(endDate.getTime() - THIRTY_DAYS_MS);

  const resolved = await resolveProjectPublishes(projectId);
  if (!resolved) return [];

  const { publishIds, publishLanguageMap } = resolved;

  const startDateStr = startDate.toISOString().split('T')[0]!;
  const endDateStr = endDate.toISOString().split('T')[0]!;

  // Get daily stats from ClickHouse
  const dailyStats = await queryDailyStats({
    videoIds: publishIds,
    startDate: startDateStr,
    endDate: endDateStr,
  });

  // Aggregate by date and language
  const trendByDate = new Map<string, Map<string, number>>();

  for (const stat of dailyStats) {
    const date = stat.metric_date;
    const language = publishLanguageMap.get(stat.video_id) || 'en';

    if (!trendByDate.has(date)) {
      trendByDate.set(date, new Map());
    }

    const dateData = trendByDate.get(date)!;
    dateData.set(language, (dateData.get(language) || 0) + stat.views);
  }

  // Convert to array
  return Array.from(trendByDate.entries())
    .map(([date, langMap]) => ({
      date,
      viewsByLanguage: Object.fromEntries(langMap),
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
}
