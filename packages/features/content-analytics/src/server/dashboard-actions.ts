'use server';

import { z } from 'zod';

import { enhanceAction } from '@kit/next/actions';

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
});

/**
 * Get language performance data for the Language tab
 */
export const getLanguagePerformanceAction = enhanceAction(
  async ({ projectId, from, to }) => {
    return getLanguagePerformance(projectId, {
      startDate: from,
      endDate: to,
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
  async ({ projectId, from, to }) => {
    return getPlatformLanguageMatrix(projectId, {
      startDate: from,
      endDate: to,
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
    schema: GetLanguageAnalyticsSchema,
    auth: true,
  },
);
