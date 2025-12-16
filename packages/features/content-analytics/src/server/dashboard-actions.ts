'use server';

import { z } from 'zod';

import { enhanceAction } from '@kit/next/actions';

import { getContentList, getProjectAnalytics } from './aggregation-queries';

/**
 * Schema for getProjectAnalyticsAction
 */
const GetProjectAnalyticsSchema = z.object({
  projectId: z.string().uuid(),
});

/**
 * Get project analytics data
 */
export const getProjectAnalyticsAction = enhanceAction(
  async ({ projectId }) => {
    return getProjectAnalytics(projectId);
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
