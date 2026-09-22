'use server';

import { z } from 'zod';

import { LANGUAGE_DIMENSIONS } from '@kit/clickhouse';
import { enhanceAction } from '@kit/next/actions';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

import {
  type ProjectRevenue,
  foldProjectRevenue,
} from '../lib/project-revenue';
import type { SummaryRevenueRow } from '../lib/revenue-by-currency';
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
import { forEachProjectRevenueRow } from './revenue-queries';
import { assertProjectAccess } from './scope-access';

/**
 * Schema for getProjectAnalyticsAction
 */
const GetProjectAnalyticsSchema = z.object({
  projectId: z.string().uuid(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

/**
 * Get project analytics data
 */
export const getProjectAnalyticsAction = enhanceAction(
  async ({ projectId, from, to }) => {
    return getProjectAnalytics(projectId, {
      startDate: from,
      endDate: to,
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
  platforms: z.array(z.string()).optional(),
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
const GetProjectDailyMetricsSchema = z.object({
  projectId: z.string().uuid(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

/**
 * Get daily metrics for the performance chart
 */
export const getProjectDailyMetricsAction = enhanceAction(
  async ({ projectId, from, to }) => {
    return getProjectDailyMetrics(projectId, {
      startDate: from,
      endDate: to,
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
});

/**
 * Revenue recorded against a project's publishes in the window, one mix
 * per currency (KB-16). Empty when nothing was recorded; null when the
 * caller may not read the project, as `getProjectAnalytics` answers.
 */
export const getProjectRevenueByCurrencyAction = enhanceAction(
  async ({ projectId, from, to }): Promise<ProjectRevenue[] | null> => {
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
    );

    return foldProjectRevenue(rows);
  },
  {
    schema: GetProjectRevenueSchema,
    auth: true,
  },
);

/**
 * Schema for getProjectAudienceDataAction
 */
const GetProjectAudienceDataSchema = z.object({
  projectId: z.string().uuid(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

/**
 * Get audience demographics and geography data
 */
export const getProjectAudienceDataAction = enhanceAction(
  async ({ projectId, from, to }) => {
    return getProjectAudienceData(projectId, {
      startDate: from,
      endDate: to,
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
});

/**
 * Get language performance data for the Language tab
 */
export const getLanguagePerformanceAction = enhanceAction(
  async ({ projectId, from, to, dimension }) => {
    return getLanguagePerformance(projectId, {
      startDate: from,
      endDate: to,
      dimension,
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
  async ({ projectId, from, to, dimension }) => {
    return getPlatformLanguageMatrix(projectId, {
      startDate: from,
      endDate: to,
      dimension,
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
  async ({ projectId, from, to }) => {
    return getContentTypeComparison(projectId, {
      startDate: from,
      endDate: to,
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
  async ({ projectId, from, to, dimension }) => {
    const { getShortsSourcePerformance } = await import('./language-analytics');
    return getShortsSourcePerformance(projectId, {
      startDate: from,
      endDate: to,
      dimension,
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
  async ({ projectId, from, to, dimension }) => {
    const { getGeographyByLanguage } = await import('./language-analytics');
    return getGeographyByLanguage(projectId, {
      startDate: from,
      endDate: to,
      dimension,
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
  async ({ projectId, from, to, dimension }) => {
    const { getLanguageTrend } = await import('./language-analytics');
    return getLanguageTrend(projectId, {
      startDate: from,
      endDate: to,
      dimension,
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
  async ({ projectId }) => {
    const { getLanguageDivergence } = await import('./language-analytics');
    return getLanguageDivergence(projectId);
  },
  {
    schema: z.object({ projectId: z.string().uuid() }),
    auth: true,
  },
);
