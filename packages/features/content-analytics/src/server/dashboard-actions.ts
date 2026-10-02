'use server';

import { enhanceAction } from '@kit/next/actions';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

import {
  GetContentListSchema,
  GetLanguageAnalyticsSchema,
  GetLanguageDivergenceSchema,
  GetProjectAnalyticsSchema,
  GetProjectAudienceDataSchema,
  GetProjectDailyMetricsSchema,
  GetProjectRevenueAccessSchema,
  GetProjectRevenueSchema,
  getContentListService,
  getContentTypeComparisonService,
  getGeographyByLanguageService,
  getLanguageDivergenceService,
  getLanguagePerformanceService,
  getLanguageTrendService,
  getPlatformLanguageMatrixService,
  getProjectAnalyticsService,
  getProjectAudienceDataService,
  getProjectDailyMetricsService,
  getProjectRevenueAccessService,
  getProjectRevenueByCurrencyService,
  getShortsSourcePerformanceService,
} from './dashboard-service';

/**
 * The project dashboard's actions: each is the cookie-session wrapper over
 * its service in `dashboard-service.ts` (FILM-1906), which holds the logic
 * and the access checks.
 */

/**
 * Get project analytics data: the headline MetricCards and the Overview's
 * per-platform split, both narrowed in the query by `platforms`.
 */
export const getProjectAnalyticsAction = enhanceAction(
  async (input) => getProjectAnalyticsService(getSupabaseServerClient(), input),
  {
    schema: GetProjectAnalyticsSchema,
    auth: true,
  },
);

/**
 * Get content list with analytics for the content tab
 */
export const getContentListAction = enhanceAction(
  async (input) => getContentListService(getSupabaseServerClient(), input),
  {
    schema: GetContentListSchema,
    auth: true,
  },
);

/**
 * Get daily metrics for the performance chart, for the selected platforms
 */
export const getProjectDailyMetricsAction = enhanceAction(
  async (input) =>
    getProjectDailyMetricsService(getSupabaseServerClient(), input),
  {
    schema: GetProjectDailyMetricsSchema,
    auth: true,
  },
);

/**
 * Revenue recorded against a project's publishes in the window, one mix
 * per currency (KB-16). Empty when nothing was recorded; null when the
 * caller may not read the project, as `getProjectAnalytics` answers.
 */
export const getProjectRevenueByCurrencyAction = enhanceAction(
  async (input) =>
    getProjectRevenueByCurrencyService(getSupabaseServerClient(), input),
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
  async (input) =>
    getProjectRevenueAccessService(getSupabaseServerClient(), input),
  {
    schema: GetProjectRevenueAccessSchema,
    auth: true,
  },
);

/**
 * Get audience demographics and geography data, over the selected
 * platforms' videos only
 */
export const getProjectAudienceDataAction = enhanceAction(
  async (input) =>
    getProjectAudienceDataService(getSupabaseServerClient(), input),
  {
    schema: GetProjectAudienceDataSchema,
    auth: true,
  },
);

/**
 * Get language performance data for the Language tab
 */
export const getLanguagePerformanceAction = enhanceAction(
  async (input) =>
    getLanguagePerformanceService(getSupabaseServerClient(), input),
  {
    schema: GetLanguageAnalyticsSchema,
    auth: true,
  },
);

/**
 * Get platform × language matrix for the Language tab
 */
export const getPlatformLanguageMatrixAction = enhanceAction(
  async (input) =>
    getPlatformLanguageMatrixService(getSupabaseServerClient(), input),
  {
    schema: GetLanguageAnalyticsSchema,
    auth: true,
  },
);

/**
 * Get content type comparison for the Language tab
 */
export const getContentTypeComparisonAction = enhanceAction(
  async (input) =>
    getContentTypeComparisonService(getSupabaseServerClient(), input),
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
  async (input) =>
    getShortsSourcePerformanceService(getSupabaseServerClient(), input),
  {
    schema: GetLanguageAnalyticsSchema,
    auth: true,
  },
);

/**
 * Get geography by language for Phase 4
 */
export const getGeographyByLanguageAction = enhanceAction(
  async (input) =>
    getGeographyByLanguageService(getSupabaseServerClient(), input),
  {
    schema: GetLanguageAnalyticsSchema,
    auth: true,
  },
);

/**
 * Get language trend over time for trend chart
 */
export const getLanguageTrendAction = enhanceAction(
  async (input) => getLanguageTrendService(getSupabaseServerClient(), input),
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
  async (input) =>
    getLanguageDivergenceService(getSupabaseServerClient(), input),
  {
    schema: GetLanguageDivergenceSchema,
    auth: true,
  },
);
