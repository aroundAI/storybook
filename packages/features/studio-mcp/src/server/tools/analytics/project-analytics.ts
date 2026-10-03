import 'server-only';

import { z } from 'zod';

import {
  GetContentListSchema,
  GetProjectAnalyticsSchema,
  getContentListService,
  getProjectAnalyticsService,
  getProjectAudienceDataService,
  getProjectDailyMetricsService,
} from '@kit/content-analytics/server/dashboard-service';

import { McpToolError } from '../../../errors';
import { defineTool } from '../../../registry';
import {
  READ_ONLY,
  analyticsNotes,
  callService,
  dateRangeArgs,
  parseWith,
  platformArg,
  platformsOf,
  requireTeamScope,
  windowOf,
} from './shared';

export const PROJECT_ANALYTICS_VIEWS = [
  'overview',
  'content',
  'daily',
  'audience',
] as const;

/**
 * The project dashboard's Overview, Content and Audience tabs, one view per
 * call, through the same services the page's actions wrap.
 */
export const getProjectAnalytics = defineTool({
  name: 'get_project_analytics',
  title: 'Project analytics',
  description:
    'A project dashboard view: `overview` (totals, seasons and the per-platform split), `content` (every published video with its figures), `daily` (the performance chart series) or `audience` (demographics and geography). Same checks and same unmeasured states as the page.',
  inputSchema: {
    projectId: z.string().uuid(),
    view: z.enum(PROJECT_ANALYTICS_VIEWS),
    ...dateRangeArgs,
    platform: platformArg,
  },
  scope: 'studio:read',
  annotations: READ_ONLY,
  async handler(input, context) {
    const scope = await requireTeamScope(context, {
      projectId: input.projectId,
    });
    const window = windowOf(input);
    const platforms = platformsOf(input.platform);
    const client = context.principal.supabase;
    const range = {
      projectId: input.projectId,
      from: window.fromDate,
      to: window.toDate,
      platforms,
    };

    const [data, notes] = await Promise.all([
      callService(async () => {
        switch (input.view) {
          case 'overview': {
            const analytics = await getProjectAnalyticsService(
              client,
              parseWith(GetProjectAnalyticsSchema, range),
            );

            // The read answers "no access" with null; the scope was proven
            // above, so null here is the project gone between the two.
            if (!analytics) {
              throw new McpToolError(
                'FORBIDDEN',
                'Project not found or access denied',
              );
            }

            return analytics;
          }
          case 'content':
            return getContentListService(
              client,
              parseWith(GetContentListSchema, range),
            );
          case 'daily':
            return getProjectDailyMetricsService(
              client,
              parseWith(GetProjectAnalyticsSchema, range),
            );
          case 'audience':
            return getProjectAudienceDataService(
              client,
              parseWith(GetProjectAnalyticsSchema, range),
            );
        }
      }),
      analyticsNotes(context, { ...scope, platforms }, window),
    ]);

    return { structuredContent: { view: input.view, data, notes } };
  },
});
