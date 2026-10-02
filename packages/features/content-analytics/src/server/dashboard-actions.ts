'use server';

import { z } from 'zod';

import { LANGUAGE_DIMENSIONS } from '@kit/clickhouse';
import { enhanceAction } from '@kit/next/actions';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

import {
  type ProjectRevenue,
  foldProjectRevenue,
} from '../lib/project-revenue';
import type { RevenueAccessNote } from '../lib/revenue-access';
import type { SummaryRevenueRow } from '../lib/revenue-by-currency';
import { PlatformSelectionSchema } from '../lib/schemas/platforms.schema';
import {
  getContentList,
  getProjectAnalytics,
  getProjectAudienceData,
  getProjectDailyMetrics,
} from './aggregation-queries';
import {
  getContentTypeComparison,
  getLanguagePerformance,
  getPlatformLanguageMatrix,
} from './language-analytics';
import { readAccountRevenueAccess } from './revenue-access-reader';
import { forEachProjectRevenueRow } from './revenue-queries';
import { assertProjectAccess } from './scope-access';

/**
 * Schema for getProjectAnalyticsAction
 */
const GetProjectAnalyticsSchema = z.object({
  projectId: z.string().uuid(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  /** The page's platform filter (FILM-1709); absent is every platform. */
  platforms: PlatformSelectionSchema.optional(),
});

/**
 * Get project analytics data: the headline MetricCards and the Overview's
 * per-platform split, both narrowed in the query by `platforms`.
 */
export const getProjectAnalyticsAction = enhanceAction(
  async ({ projectId, from, to, platforms }) => {
    return getProjectAnalytics(projectId, {
      startDate: from,
      endDate: to,
      platforms,
    });
  },
  {
    schema: GetProjectAnalyticsSchema,
    auth: true,
  },
);

/**
 * Schema for getContentListAction
 */
const GetContentListSchema = z.object({
  projectId: z.string().uuid(),
  // An `AnalyticsPlatform` list, not any string: this was
  // `z.array(z.string())`, so a name the analytics tables cannot hold
  // reached the publish query (FILM-1709).
  platforms: PlatformSelectionSchema.optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

/**
 * Get content list with analytics for the content tab
 */
export const getContentListAction = enhanceAction(
  async ({ projectId, platforms, from, to }) => {
    return getContentList(projectId, {
      platforms,
      startDate: from,
      endDate: to,
    });
  },
  {
    schema: GetContentListSchema,
    auth: true,
  },
);

/**
 * Schema for getProjectDailyMetricsAction
 */
const GetProjectDailyMetricsSchema = GetProjectAnalyticsSchema;

/**
 * Get daily metrics for the performance chart, for the selected platforms
 */
export const getProjectDailyMetricsAction = enhanceAction(
  async ({ projectId, from, to, platforms }) => {
    return getProjectDailyMetrics(projectId, {
      startDate: from,
      endDate: to,
      platforms,
    });
  },
  {
    schema: GetProjectDailyMetricsSchema,
    auth: true,
  },
);

const GetProjectRevenueSchema = z.object({
  projectId: z.string().uuid(),
  from: z.coerce.date(),
  to: z.coerce.date(),
  platforms: PlatformSelectionSchema.optional(),
});

/**
 * Revenue recorded against a project's publishes in the window, one mix
 * per currency (KB-16). Empty when nothing was recorded; null when the
 * caller may not read the project, as `getProjectAnalytics` answers.
 */
export const getProjectRevenueByCurrencyAction = enhanceAction(
  async ({
    projectId,
    from,
    to,
    platforms,
  }): Promise<ProjectRevenue[] | null> => {
    const client = getSupabaseServerClient();

    try {
      await assertProjectAccess(client, projectId);
    } catch {
      return null;
    }

    const rows: SummaryRevenueRow[] = [];

    // The same day boundaries as the Overview's other reads
    // (`getProjectAnalytics`), so the card and the tiles cover one window.
    await forEachProjectRevenueRow(
      client,
      projectId,
      from.toISOString().split('T')[0]!,
      to.toISOString().split('T')[0]!,
      (row) => rows.push(row),
      { platforms },
    );

    return foldProjectRevenue(rows);
  },
  {
    schema: GetProjectRevenueSchema,
    auth: true,
  },
);

/**
 * Why the project's channels have no measured revenue, one sentence per
 * reason (FILM-1726): the platform's, the creator's or ours. Read from the
 * account's connected channels and what each was granted. Null when the
 * caller may not read the project.
 */
export const getProjectRevenueAccessAction = enhanceAction(
  async ({ projectId }): Promise<RevenueAccessNote[] | null> => {
    const client = getSupabaseServerClient();

    try {
      await assertProjectAccess(client, projectId);
    } catch {
      return null;
    }

    const { data: project, error: projectError } = await client
      .from('projects')
      .select('account_id')
      .eq('id', projectId)
      .maybeSingle();

    if (projectError) throw projectError;
    if (!project) return null;

    return readAccountRevenueAccess(client, project.account_id);
  },
  {
    schema: z.object({ projectId: z.string().uuid() }),
    auth: true,
  },
);

/**
 * Schema for getProjectAudienceDataAction
 */
const GetProjectAudienceDataSchema = GetProjectAnalyticsSchema;

/**
 * Get audience demographics and geography data, over the selected
 * platforms' videos only
 */
export const getProjectAudienceDataAction = enhanceAction(
  async ({ projectId, from, to, platforms }) => {
    return getProjectAudienceData(projectId, {
      startDate: from,
      endDate: to,
      platforms,
    });
  },
  {
    schema: GetProjectAudienceDataSchema,
    auth: true,
  },
);

/**
 * Schema for getLanguageAnalyticsAction
 */
const GetLanguageAnalyticsSchema = z.object({
  projectId: z.string().uuid(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  /**
   * Content language or channel target language (FILM-1702). Defaults to
   * content, which is the dimension every other analytics surface filters
   * on.
   */
  dimension: z.enum(LANGUAGE_DIMENSIONS).default('content'),
  /** The page's platform filter (FILM-1709); absent is every platform. */
  platforms: PlatformSelectionSchema.optional(),
});

/**
 * Get language performance data for the Language tab
 */
export const getLanguagePerformanceAction = enhanceAction(
  async ({ projectId, from, to, dimension, platforms }) => {
    return getLanguagePerformance(projectId, {
      startDate: from,
      endDate: to,
      dimension,
      platforms,
    });
  },
  {
    schema: GetLanguageAnalyticsSchema,
    auth: true,
  },
);

/**
 * Get platform × language matrix for the Language tab
 */
export const getPlatformLanguageMatrixAction = enhanceAction(
  async ({ projectId, from, to, dimension, platforms }) => {
    return getPlatformLanguageMatrix(projectId, {
      startDate: from,
      endDate: to,
      dimension,
      platforms,
    });
  },
  {
    schema: GetLanguageAnalyticsSchema,
    auth: true,
  },
);

/**
 * Get content type comparison for the Language tab
 */
export const getContentTypeComparisonAction = enhanceAction(
  async ({ projectId, from, to, platforms }) => {
    return getContentTypeComparison(projectId, {
      startDate: from,
      endDate: to,
      platforms,
    });
  },
  {
    // Shorts against long-form is not a language question, so it takes no
    // language dimension.
    schema: GetProjectAnalyticsSchema,
    auth: true,
  },
);

/**
 * Get shorts source performance for Phase 3
 */
export const getShortsSourcePerformanceAction = enhanceAction(
  async ({ projectId, from, to, dimension, platforms }) => {
    const { getShortsSourcePerformance } = await import('./language-analytics');
    return getShortsSourcePerformance(projectId, {
      startDate: from,
      endDate: to,
      dimension,
      platforms,
      limit: 10,
    });
  },
  {
    schema: GetLanguageAnalyticsSchema,
    auth: true,
  },
);

/**
 * Get geography by language for Phase 4
 */
export const getGeographyByLanguageAction = enhanceAction(
  async ({ projectId, from, to, dimension, platforms }) => {
    const { getGeographyByLanguage } = await import('./language-analytics');
    return getGeographyByLanguage(projectId, {
      startDate: from,
      endDate: to,
      dimension,
      platforms,
    });
  },
  {
    schema: GetLanguageAnalyticsSchema,
    auth: true,
  },
);

/**
 * Get language trend over time for trend chart
 */
export const getLanguageTrendAction = enhanceAction(
  async ({ projectId, from, to, dimension, platforms }) => {
    const { getLanguageTrend } = await import('./language-analytics');
    return getLanguageTrend(projectId, {
      startDate: from,
      endDate: to,
      dimension,
      platforms,
    });
  },
  {
    schema: GetLanguageAnalyticsSchema,
    auth: true,
  },
);

/**
 * How many videos are in a language other than their channel's target.
 *
 * Takes no dimension and no window: it compares the two dimensions with
 * each other, across every published video, so it reads the same whichever
 * way the Language tab is set.
 */
export const getLanguageDivergenceAction = enhanceAction(
  async ({ projectId, platforms }) => {
    const { getLanguageDivergence } = await import('./language-analytics');
    return getLanguageDivergence(projectId, { platforms });
  },
  {
    schema: z.object({
      projectId: z.string().uuid(),
      platforms: PlatformSelectionSchema.optional(),
    }),
    auth: true,
  },
);
