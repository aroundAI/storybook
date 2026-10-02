import 'server-only';

import { z } from 'zod';

import { LANGUAGE_DIMENSIONS } from '@kit/clickhouse';

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
import type { AnalyticsClient } from './analytics-client';
import {
  getContentTypeComparison,
  getGeographyByLanguage,
  getLanguageDivergence,
  getLanguagePerformance,
  getLanguageTrend,
  getPlatformLanguageMatrix,
  getShortsSourcePerformance,
} from './language-analytics';
import { readAccountRevenueAccess } from './revenue-access-reader';
import { forEachProjectRevenueRow } from './revenue-queries';
import { assertProjectAccess } from './scope-access';

/**
 * The project dashboard's reads as services (FILM-1906): each takes the
 * caller's client and the action's parsed input, and `dashboard-actions.ts`
 * is the thin `'use server'` wrapper over it. The schemas live here, where a
 * non-function export is allowed, so the wrapper and an MCP tool parse the
 * same shape.
 *
 * Access is the underlying reads' own: `getProjectAnalytics`,
 * `getProjectDailyMetrics` and the language reads answer "no access" with an
 * empty result; the revenue reads answer it with null. Nothing here adds or
 * removes a check.
 */

export const GetProjectAnalyticsSchema = z.object({
  projectId: z.string().uuid(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  /** The page's platform filter (FILM-1709); absent is every platform. */
  platforms: PlatformSelectionSchema.optional(),
});

export type GetProjectAnalyticsInput = z.infer<
  typeof GetProjectAnalyticsSchema
>;

/**
 * Project analytics data: the headline MetricCards and the Overview's
 * per-platform split, both narrowed in the query by `platforms`.
 */
export async function getProjectAnalyticsService(
  client: AnalyticsClient,
  { projectId, from, to, platforms }: GetProjectAnalyticsInput,
) {
  return getProjectAnalytics(
    projectId,
    { startDate: from, endDate: to, platforms },
    client,
  );
}

export const GetContentListSchema = z.object({
  projectId: z.string().uuid(),
  // An `AnalyticsPlatform` list, not any string: this was
  // `z.array(z.string())`, so a name the analytics tables cannot hold
  // reached the publish query (FILM-1709).
  platforms: PlatformSelectionSchema.optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

export type GetContentListInput = z.infer<typeof GetContentListSchema>;

/** Content list with analytics for the content tab. */
export async function getContentListService(
  client: AnalyticsClient,
  { projectId, platforms, from, to }: GetContentListInput,
) {
  return getContentList(
    projectId,
    { platforms, startDate: from, endDate: to },
    client,
  );
}

export const GetProjectDailyMetricsSchema = GetProjectAnalyticsSchema;

/** Daily metrics for the performance chart, for the selected platforms. */
export async function getProjectDailyMetricsService(
  client: AnalyticsClient,
  { projectId, from, to, platforms }: GetProjectAnalyticsInput,
) {
  return getProjectDailyMetrics(
    projectId,
    { startDate: from, endDate: to, platforms },
    client,
  );
}

export const GetProjectRevenueSchema = z.object({
  projectId: z.string().uuid(),
  from: z.coerce.date(),
  to: z.coerce.date(),
  platforms: PlatformSelectionSchema.optional(),
});

export type GetProjectRevenueInput = z.infer<typeof GetProjectRevenueSchema>;

/**
 * Revenue recorded against a project's publishes in the window, one mix
 * per currency (KB-16). Empty when nothing was recorded; null when the
 * caller may not read the project, as `getProjectAnalytics` answers.
 */
export async function getProjectRevenueByCurrencyService(
  client: AnalyticsClient,
  { projectId, from, to, platforms }: GetProjectRevenueInput,
): Promise<ProjectRevenue[] | null> {
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
}

export const GetProjectRevenueAccessSchema = z.object({
  projectId: z.string().uuid(),
});

export type GetProjectRevenueAccessInput = z.infer<
  typeof GetProjectRevenueAccessSchema
>;

/**
 * Why the project's channels have no measured revenue, one sentence per
 * reason (FILM-1726): the platform's, the creator's or ours. Read from the
 * account's connected channels and what each was granted. Null when the
 * caller may not read the project.
 */
export async function getProjectRevenueAccessService(
  client: AnalyticsClient,
  { projectId }: GetProjectRevenueAccessInput,
): Promise<RevenueAccessNote[] | null> {
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
}

export const GetProjectAudienceDataSchema = GetProjectAnalyticsSchema;

/**
 * Audience demographics and geography data, over the selected platforms'
 * videos only.
 */
export async function getProjectAudienceDataService(
  client: AnalyticsClient,
  { projectId, from, to, platforms }: GetProjectAnalyticsInput,
) {
  return getProjectAudienceData(
    projectId,
    { startDate: from, endDate: to, platforms },
    client,
  );
}

export const GetLanguageAnalyticsSchema = z.object({
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

export type GetLanguageAnalyticsInput = z.infer<
  typeof GetLanguageAnalyticsSchema
>;

/** Language performance data for the Language tab. */
export async function getLanguagePerformanceService(
  client: AnalyticsClient,
  { projectId, from, to, dimension, platforms }: GetLanguageAnalyticsInput,
) {
  return getLanguagePerformance(
    projectId,
    { startDate: from, endDate: to, dimension, platforms },
    client,
  );
}

/** Platform × language matrix for the Language tab. */
export async function getPlatformLanguageMatrixService(
  client: AnalyticsClient,
  { projectId, from, to, dimension, platforms }: GetLanguageAnalyticsInput,
) {
  return getPlatformLanguageMatrix(
    projectId,
    { startDate: from, endDate: to, dimension, platforms },
    client,
  );
}

/**
 * Content type comparison for the Language tab. Shorts against long-form
 * is not a language question, so it takes no language dimension.
 */
export async function getContentTypeComparisonService(
  client: AnalyticsClient,
  { projectId, from, to, platforms }: GetProjectAnalyticsInput,
) {
  return getContentTypeComparison(
    projectId,
    { startDate: from, endDate: to, platforms },
    client,
  );
}

/** Shorts source performance for Phase 3. */
export async function getShortsSourcePerformanceService(
  client: AnalyticsClient,
  { projectId, from, to, dimension, platforms }: GetLanguageAnalyticsInput,
) {
  return getShortsSourcePerformance(
    projectId,
    { startDate: from, endDate: to, dimension, platforms, limit: 10 },
    client,
  );
}

/** Geography by language for Phase 4. */
export async function getGeographyByLanguageService(
  client: AnalyticsClient,
  { projectId, from, to, dimension, platforms }: GetLanguageAnalyticsInput,
) {
  return getGeographyByLanguage(
    projectId,
    { startDate: from, endDate: to, dimension, platforms },
    client,
  );
}

/** Language trend over time for the trend chart. */
export async function getLanguageTrendService(
  client: AnalyticsClient,
  { projectId, from, to, dimension, platforms }: GetLanguageAnalyticsInput,
) {
  return getLanguageTrend(
    projectId,
    { startDate: from, endDate: to, dimension, platforms },
    client,
  );
}

export const GetLanguageDivergenceSchema = z.object({
  projectId: z.string().uuid(),
  platforms: PlatformSelectionSchema.optional(),
});

export type GetLanguageDivergenceInput = z.infer<
  typeof GetLanguageDivergenceSchema
>;

/**
 * How many videos are in a language other than their channel's target.
 *
 * Takes no dimension and no window: it compares the two dimensions with
 * each other, across every published video, so it reads the same whichever
 * way the Language tab is set.
 */
export async function getLanguageDivergenceService(
  client: AnalyticsClient,
  { projectId, platforms }: GetLanguageDivergenceInput,
) {
  return getLanguageDivergence(projectId, { platforms }, client);
}
