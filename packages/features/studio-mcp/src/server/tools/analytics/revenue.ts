import 'server-only';

import { z } from 'zod';

import {
  GetRevenueProjectionSchema,
  GetRevenueSummarySchema,
  GetRevenueTimeSeriesSchema,
  GetTopContentByRevenueSchema,
} from '@kit/content-analytics/lib/schemas/revenue';
import {
  GetProjectRevenueAccessSchema,
  GetProjectRevenueSchema,
  getProjectRevenueAccessService,
  getProjectRevenueByCurrencyService,
} from '@kit/content-analytics/server/dashboard-service';
import { readAccountRevenueAccess } from '@kit/content-analytics/server/revenue-access-reader';
import {
  getRevenueProjectionService,
  getRevenueSummaryService,
  getRevenueTimeSeriesService,
  getTopContentByRevenueService,
} from '@kit/content-analytics/server/revenue-service';

import { McpToolError } from '../../../errors';
import { defineTool } from '../../../registry';
import {
  CalendarDay,
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

export const REVENUE_VIEWS = [
  'summary',
  'timeseries',
  'top_content',
  'projection',
  'by_currency',
] as const;

/**
 * The revenue dashboard. Every view first applies the same revenue-access
 * check the web does (criterion 5): `getProjectRevenueAccessService` for a
 * project, the account reader otherwise. Its notes say why revenue is not
 * measured when it is not, and are returned with every figure; a project
 * the caller may not read is refused there before any figure is read.
 */
export const getRevenue = defineTool({
  name: 'get_revenue',
  title: 'Revenue',
  description:
    'Revenue as the dashboard shows it, one total per currency and never summed across currencies: `summary` (totals, mix and RPM against the previous period), `timeseries`, `top_content`, `projection` (next month and year from the last 30 days), or `by_currency` for one project (needs `projectId`). `revenueAccess` lists why revenue is not measured, per platform, exactly as the page does.',
  inputSchema: {
    view: z.enum(REVENUE_VIEWS),
    projectId: z
      .string()
      .uuid()
      .optional()
      .describe(
        'Required for by_currency; otherwise narrows the access notes to the project.',
      ),
    ...dateRangeArgs,
    platform: platformArg,
    limit: z
      .number()
      .int()
      .min(1)
      .max(50)
      .optional()
      .describe('top_content: how many per currency (default 10).'),
    asOf: CalendarDay.optional().describe(
      'projection: the caller’s calendar day (default today, UTC).',
    ),
  },
  scope: 'studio:read',
  annotations: READ_ONLY,
  async handler(input, context) {
    const client = context.principal.supabase;
    const accountId = context.accountId;
    const window = windowOf(input);
    const platforms = platformsOf(input.platform);

    if (input.projectId) {
      await requireTeamScope(context, { projectId: input.projectId });
    } else if (input.view === 'by_currency') {
      throw new McpToolError(
        'VALIDATION_FAILED',
        'by_currency needs a projectId.',
      );
    }

    // The web's check, first. Null means the caller may not read the
    // project: refused here, before any figure.
    const revenueAccess = await callService(async () => {
      if (!input.projectId) return readAccountRevenueAccess(client, accountId);

      const notes = await getProjectRevenueAccessService(
        client,
        parseWith(GetProjectRevenueAccessSchema, {
          projectId: input.projectId,
        }),
      );

      if (notes === null) {
        throw new McpToolError(
          'FORBIDDEN',
          'Project not found or access denied',
        );
      }

      return notes;
    });

    const period = { accountId, startDate: window.from, endDate: window.to };

    const [data, notes] = await Promise.all([
      callService(async () => {
        switch (input.view) {
          case 'summary':
            return getRevenueSummaryService(
              client,
              parseWith(GetRevenueSummarySchema, period),
            );
          case 'timeseries':
            return getRevenueTimeSeriesService(
              client,
              parseWith(GetRevenueTimeSeriesSchema, period),
            );
          case 'top_content':
            return getTopContentByRevenueService(
              client,
              parseWith(GetTopContentByRevenueSchema, {
                ...period,
                limit: input.limit,
              }),
            );
          case 'projection':
            return getRevenueProjectionService(
              client,
              parseWith(GetRevenueProjectionSchema, {
                accountId,
                asOf: input.asOf,
              }),
            );
          case 'by_currency':
            return getProjectRevenueByCurrencyService(
              client,
              parseWith(GetProjectRevenueSchema, {
                projectId: input.projectId,
                from: window.fromDate,
                to: window.toDate,
                platforms,
              }),
            );
        }
      }),
      analyticsNotes(
        context,
        input.projectId
          ? { projectId: input.projectId, platforms }
          : { accountId, platforms },
        window,
      ),
    ]);

    return {
      structuredContent: { view: input.view, data, revenueAccess, notes },
    };
  },
});
