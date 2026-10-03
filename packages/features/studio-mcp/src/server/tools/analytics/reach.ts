import 'server-only';

import { z } from 'zod';

import {
  REACH_WINDOWS,
  type ReachWindow,
  windowBounds,
} from '@kit/content-analytics/lib/reach-overview';
import { loadReachOverviewService } from '@kit/content-analytics/server/reach-overview';

import { McpToolError } from '../../../errors';
import { defineTool } from '../../../registry';
import { READ_ONLY, analyticsNotes, callService } from './shared';

/**
 * The reach page: accounts reached per channel and per post over a 7, 30
 * or 90 day window. Each figure is a `Measured` value that says when it is
 * not measured and why (Facebook's 30-day gap, Instagram's 90-day one).
 */
export const getReachOverview = defineTool({
  name: 'get_reach_overview',
  title: 'Reach overview',
  description:
    'Cross-platform reach for the team over the last 7, 30 or 90 days: totals and per-platform counts, each channel’s reach with its history, and the most-viewed posts in the window. A figure a platform does not report for that window is marked not measured, with the reason.',
  inputSchema: {
    windowDays: z
      .number()
      .int()
      .default(30)
      .describe(`One of ${REACH_WINDOWS.join(', ')}.`),
  },
  scope: 'studio:read',
  annotations: READ_ONLY,
  async handler(input, context) {
    if (!(REACH_WINDOWS as readonly number[]).includes(input.windowDays)) {
      throw new McpToolError(
        'VALIDATION_FAILED',
        `windowDays must be one of ${REACH_WINDOWS.join(', ')}.`,
      );
    }

    const window = input.windowDays as ReachWindow;
    const now = new Date();
    const bounds = windowBounds(window, now);
    const accountId = context.accountId;

    const [data, notes] = await Promise.all([
      callService(() =>
        loadReachOverviewService(context.principal.supabase, {
          accountId,
          window,
          now,
        }),
      ),
      analyticsNotes(context, { accountId }, bounds),
    ]);

    return { structuredContent: { data, notes } };
  },
});
