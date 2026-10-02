import 'server-only';

import { z } from 'zod';

import { WeeklyDiagnosticsSchema } from '@kit/content-analytics/lib/schemas/diagnostics';
import { TrafficBreakdownSchema } from '@kit/content-analytics/lib/schemas/traffic';
import {
  BackCatalogSchema,
  CohortCurvesSchema,
  MedianPerformanceSchema,
  ReturningViewerProxySchema,
  RollingViewsSchema,
  YppProgressSchema,
  getBackCatalogService,
  getCohortCurvesService,
  getMedianPerformanceService,
  getReturningViewerProxyService,
  getRollingViewsService,
  getTrafficBreakdownService,
  getYppProgressService,
} from '@kit/content-analytics/server/deep-dive-service';
import { getWeeklyDiagnosticsService } from '@kit/content-analytics/server/diagnostics-service';
import {
  SubscriberSeriesSchema,
  getSubscriberSeriesService,
} from '@kit/content-analytics/server/subscriber-series-service';

import { defineTool } from '../../../registry';
import {
  READ_ONLY,
  analyticsNotes,
  callService,
  channelIdArg,
  dateRangeArgs,
  parseWith,
  platformArg,
  platformsOf,
  requireTeamScope,
  windowOf,
} from './shared';

export const DEEP_DIVE_VIEWS = [
  'median',
  'rolling_views',
  'traffic',
  'back_catalog',
  'cohorts',
  'ypp_progress',
  'returning_viewers',
  'weekly_diagnostics',
  'subscribers',
] as const;

/** The Deep Dive's own window: 52 weeks, where the page uses one. */
const DEEP_DIVE_DAYS = 364;

/**
 * The Deep Dive, one card per call. Every view reads ClickHouse through its
 * service, which proves the scope on the principal's client first; with
 * ClickHouse off each series is empty, and `notes.measured` says why.
 */
export const getDeepDive = defineTool({
  name: 'get_deep_dive',
  title: 'Deep dive',
  description:
    'One Deep Dive card for a project or, without `projectId`, the whole team: `median` views per video per month or quarter, `rolling_views`, `traffic` sources, `back_catalog` share, upload `cohorts` at fixed ages, `ypp_progress` per YouTube channel, the `returning_viewers` proxy (subscribed share), `weekly_diagnostics` (recent videos with CTR and retention cliffs) or the `subscribers` curve. Optional channel, platform, content type and language filters narrow the scope.',
  inputSchema: {
    view: z.enum(DEEP_DIVE_VIEWS),
    projectId: z.string().uuid().optional(),
    channelId: channelIdArg,
    platform: platformArg,
    contentType: z.string().max(50).optional(),
    language: z.string().max(10).optional(),
    ...dateRangeArgs,
    bucket: z
      .enum(['day', 'week', 'month', 'quarter'])
      .optional()
      .describe(
        'median, cohorts: month or quarter. traffic: day, week or month. Others ignore it.',
      ),
    mode: z
      .enum(['cohort_views_to_date', 'views_in_period'])
      .optional()
      .describe('median only.'),
    windowDays: z
      .number()
      .int()
      .optional()
      .describe(
        'rolling_views (7–365, default 90) and ypp_progress (90–400, default 365).',
      ),
    ageDays: z
      .number()
      .int()
      .optional()
      .describe(
        'back_catalog: a video older than this is back catalogue (30–365, default 90).',
      ),
    checkpoints: z
      .array(z.number().int())
      .optional()
      .describe('cohorts: ages in days to read, default 30, 90, 180, 365.'),
    sinceDays: z
      .number()
      .int()
      .optional()
      .describe(
        'weekly_diagnostics: how far back "recent" reaches (1–90, default 7).',
      ),
    limit: z
      .number()
      .int()
      .optional()
      .describe('weekly_diagnostics: at most this many videos (default 50).'),
  },
  scope: 'studio:read',
  annotations: READ_ONLY,
  async handler(input, context) {
    const teamScope = await requireTeamScope(context, {
      projectId: input.projectId,
      channelId: input.channelId,
    });
    const platforms = platformsOf(input.platform);
    const scope = {
      ...teamScope,
      platforms,
      contentType: input.contentType,
      language: input.language,
    };
    const window = windowOf(input, DEEP_DIVE_DAYS);
    const client = context.principal.supabase;

    const [data, notes] = await Promise.all([
      callService(async () => {
        switch (input.view) {
          case 'median':
            return getMedianPerformanceService(
              client,
              parseWith(MedianPerformanceSchema, {
                scope,
                bucket: input.bucket,
                mode: input.mode,
                from: input.from,
                to: input.to,
              }),
            );
          case 'rolling_views':
            return getRollingViewsService(
              client,
              parseWith(RollingViewsSchema, {
                scope,
                windowDays: input.windowDays,
                from: input.from,
                to: input.to,
              }),
            );
          case 'traffic':
            return getTrafficBreakdownService(
              client,
              parseWith(TrafficBreakdownSchema, {
                scope,
                bucket: input.bucket,
                from: window.from,
                to: window.to,
              }),
            );
          case 'back_catalog':
            return getBackCatalogService(
              client,
              parseWith(BackCatalogSchema, {
                scope,
                ageDays: input.ageDays,
                from: input.from,
                to: input.to,
              }),
            );
          case 'cohorts':
            return getCohortCurvesService(
              client,
              parseWith(CohortCurvesSchema, {
                scope,
                checkpoints: input.checkpoints,
                bucket: input.bucket,
              }),
            );
          case 'ypp_progress':
            return getYppProgressService(
              client,
              parseWith(YppProgressSchema, {
                accountId: context.accountId,
                connectionId: input.channelId,
                windowDays: input.windowDays,
              }),
            );
          case 'returning_viewers':
            return getReturningViewerProxyService(
              client,
              parseWith(ReturningViewerProxySchema, { scope }),
            );
          case 'weekly_diagnostics':
            return getWeeklyDiagnosticsService(
              client,
              parseWith(WeeklyDiagnosticsSchema, {
                scope,
                sinceDays: input.sinceDays,
                limit: input.limit,
              }),
            );
          case 'subscribers':
            return getSubscriberSeriesService(
              client,
              parseWith(SubscriberSeriesSchema, {
                scope: {
                  projectId: teamScope.projectId,
                  accountId: teamScope.accountId,
                  connectionId: teamScope.connectionId,
                  platforms,
                },
                from: window.from,
                to: window.to,
              }),
            );
        }
      }),
      analyticsNotes(context, scope, window),
    ]);

    return { structuredContent: { view: input.view, data, notes } };
  },
});
