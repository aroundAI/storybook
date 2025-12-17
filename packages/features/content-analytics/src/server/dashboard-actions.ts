'use server';

import { z } from 'zod';

import { enhanceAction } from '@kit/next/actions';

import {
  getContentList,
  getProjectAnalytics,
  getProjectAudienceData,
  getProjectDailyMetrics,
} from './aggregation-queries';

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
