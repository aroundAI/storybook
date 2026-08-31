'use server';

import { z } from 'zod';

import {
  queryBackCatalogShare,
  queryChannelWatchWindow,
  queryCohortCurves,
  queryMedianViewsPerVideo,
  queryRollingViews,
  queryTrafficShareTrend,
  queryWatchWindowTotals,
} from '@kit/clickhouse/server';
import type { DimScope } from '@kit/clickhouse/server';
import { enhanceAction } from '@kit/next/actions';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

import { formatDate } from '../lib/utils';

/**
 * Scope shared by the deep-dive actions: project- or account-level, with
 * optional segment filters.
 */
const ScopeSchema = z
  .object({
    projectId: z.string().uuid().optional(),
    accountId: z.string().uuid().optional(),
    platform: z.enum(['youtube', 'tiktok', 'instagram']).optional(),
    contentType: z.string().max(50).optional(),
    language: z.string().max(10).optional(),
  })
  .refine((scope) => scope.projectId || scope.accountId, {
    message: 'projectId or accountId is required',
  });

type Scope = z.infer<typeof ScopeSchema>;

/**
 * ClickHouse queries are not covered by Postgres RLS, so every action
 * verifies the caller can see the scoped project/account through the
 * user-scoped Supabase client first.
 */
async function assertScopeAccess(scope: Scope): Promise<void> {
  const client = getSupabaseServerClient();

  if (scope.projectId) {
    const { data } = await client
      .from('projects')
      .select('id')
      .eq('id', scope.projectId)
      .maybeSingle();

    if (!data) {
      throw new Error('Project not found or access denied');
    }
    return;
  }

  const { data } = await client
    .from('accounts')
    .select('id')
    .eq('id', scope.accountId!)
    .maybeSingle();

  if (!data) {
    throw new Error('Account not found or access denied');
  }
}

function toDimScope(scope: Scope): DimScope {
  return {
    projectId: scope.projectId,
    accountId: scope.accountId,
    platform: scope.platform,
    contentType: scope.contentType,
    language: scope.language,
  };
}

/**
 * Median (p25/p75/mean alongside) views per video per bucket.
 * Default mode 'cohort_views_to_date': the headline "is channel authority
 * building" series.
 */
export const getMedianPerformanceAction = enhanceAction(
  async ({ scope, bucket, mode, from, to }) => {
    await assertScopeAccess(scope);

    return queryMedianViewsPerVideo({
      scope: toDimScope(scope),
      bucket,
      mode,
      startDate: from ? formatDate(from) : undefined,
      endDate: to ? formatDate(to) : undefined,
    });
  },
  {
    schema: z.object({
      scope: ScopeSchema,
      bucket: z.enum(['month', 'quarter']).default('month'),
      mode: z
        .enum(['cohort_views_to_date', 'views_in_period'])
        .default('cohort_views_to_date'),
      from: z.coerce.date().optional(),
      to: z.coerce.date().optional(),
    }),
    auth: true,
  },
);

/**
 * Rolling 90-day (configurable) view totals — the monthly-decision series
 * that raw monthly totals are too noisy to give.
 */
export const getRollingViewsAction = enhanceAction(
  async ({ scope, windowDays, from, to }) => {
    await assertScopeAccess(scope);

    const endDate = to ?? new Date();
    const startDate =
      from ??
      new Date(endDate.getTime() - (windowDays + 180) * 24 * 60 * 60 * 1000);

    return queryRollingViews({
      scope: toDimScope(scope),
      windowDays,
      startDate: formatDate(startDate),
      endDate: formatDate(endDate),
    });
  },
  {
    schema: z.object({
      scope: ScopeSchema,
      windowDays: z.number().int().min(7).max(365).default(90),
      from: z.coerce.date().optional(),
      to: z.coerce.date().optional(),
    }),
    auth: true,
  },
);

/**
 * Browse+Suggested share of views over time.
 */
export const getTrafficShareTrendAction = enhanceAction(
  async ({ scope, bucket, from, to }) => {
    await assertScopeAccess(scope);

    return queryTrafficShareTrend({
      scope: toDimScope(scope),
      bucket,
      startDate: from ? formatDate(from) : undefined,
      endDate: to ? formatDate(to) : undefined,
    });
  },
  {
    schema: z.object({
      scope: ScopeSchema,
      bucket: z.enum(['week', 'month']).default('week'),
      from: z.coerce.date().optional(),
      to: z.coerce.date().optional(),
    }),
    auth: true,
  },
);

/**
 * Back-catalog contribution: share of period views from videos older than
 * ageDays, monthly.
 */
export const getBackCatalogAction = enhanceAction(
  async ({ scope, ageDays, from, to }) => {
    await assertScopeAccess(scope);

    const endDate = to ?? new Date();
    const startDate =
      from ?? new Date(endDate.getTime() - 365 * 24 * 60 * 60 * 1000);

    return queryBackCatalogShare({
      scope: toDimScope(scope),
      ageDays,
      startDate: formatDate(startDate),
      endDate: formatDate(endDate),
    });
  },
  {
    schema: z.object({
      scope: ScopeSchema,
      ageDays: z.number().int().min(30).max(365).default(90),
      from: z.coerce.date().optional(),
      to: z.coerce.date().optional(),
    }),
    auth: true,
  },
);

/**
 * Quarterly upload cohorts, per-video normalized cumulative views at fixed
 * ages, with a maturity flag per checkpoint (a cohort younger than a
 * checkpoint has not finished accruing it).
 */
export const getCohortCurvesAction = enhanceAction(
  async ({ scope, checkpoints }) => {
    await assertScopeAccess(scope);

    const rows = await queryCohortCurves({
      scope: toDimScope(scope),
      checkpoints,
    });

    const now = Date.now();

    return rows.map((row) => {
      const cohortStart = new Date(row.cohort).getTime();
      const cohortAgeDays = Math.floor((now - cohortStart) / 86_400_000);

      return {
        cohort: row.cohort,
        videoCount: row.videoCount,
        cohortAgeDays,
        checkpoints: Object.entries(row.viewsAtCheckpoint).map(
          ([days, views]) => ({
            ageDays: Number(days),
            totalViews: views,
            viewsPerVideo:
              row.videoCount > 0 ? Math.round(views / row.videoCount) : 0,
            mature: cohortAgeDays >= Number(days),
          }),
        ),
      };
    });
  },
  {
    schema: z.object({
      scope: ScopeSchema,
      checkpoints: z
        .array(z.number().int().min(1).max(730))
        .max(8)
        .default([30, 90, 180, 365]),
    }),
    auth: true,
  },
);

/**
 * Watch-hours and subscriber progress toward the YPP gate over the
 * trailing 365 days. Channel-accurate: includes channel_daily watch time
 * from videos not published through the platform.
 */
export const getYppProgressAction = enhanceAction(
  async ({ accountId }) => {
    await assertScopeAccess({ accountId });

    const client = getSupabaseServerClient();

    const [{ data: settings }, { data: connections }] = await Promise.all([
      client
        .from('analytics_settings')
        .select('ypp_target_watch_hours, ypp_target_subscribers')
        .eq('account_id', accountId)
        .maybeSingle(),
      client
        .from('platform_connections')
        .select('id')
        .eq('account_id', accountId)
        .eq('platform', 'youtube')
        .eq('is_active', true),
    ]);

    const targetWatchHours = settings?.ypp_target_watch_hours ?? 4000;
    const targetSubscribers = settings?.ypp_target_subscribers ?? 1000;

    const [videoTotals, channelTotals] = await Promise.all([
      queryWatchWindowTotals({
        scope: { accountId, platform: 'youtube' },
        windowDays: 365,
      }),
      queryChannelWatchWindow({
        connectionIds: (connections ?? []).map((c) => c.id),
        windowDays: 365,
      }),
    ]);

    const watchHours =
      (videoTotals.watchTimeSeconds + channelTotals.watchTimeSeconds) / 3600;

    return {
      watchHours: Math.round(watchHours * 10) / 10,
      targetWatchHours,
      watchHoursProgress: Math.min(1, watchHours / targetWatchHours),
      netSubscribers: videoTotals.netSubscribers,
      targetSubscribers,
      subscriberProgress: Math.min(
        1,
        Math.max(0, videoTotals.netSubscribers) / targetSubscribers,
      ),
      windowDays: 365,
    };
  },
  {
    schema: z.object({ accountId: z.string().uuid() }),
    auth: true,
  },
);

/**
 * Returning-viewer proxy: subscribed vs non-subscribed share of views.
 * Neither the Analytics nor Reporting API exposes new-vs-returning
 * viewers (Studio-only); subscribed share is the best available signal of
 * owned audience vs rented algorithm attention.
 */
export const getReturningViewerProxyAction = enhanceAction(
  async ({ scope }) => {
    await assertScopeAccess(scope);

    const { queryAudienceRows } = await import('@kit/clickhouse/server');
    const { getSupabaseServerClient: getClient } = await import(
      '@kit/supabase/server-client'
    );

    const client = getClient();

    let publishQuery = client
      .from('publishes')
      .select('id, episodes!inner(project_id, projects!inner(account_id))')
      .eq('status', 'published');

    if (scope.projectId) {
      publishQuery = publishQuery.eq('episodes.project_id', scope.projectId);
    } else {
      publishQuery = publishQuery.eq(
        'episodes.projects.account_id',
        scope.accountId!,
      );
    }

    const { data: publishes } = await publishQuery;
    const publishIds = (publishes ?? []).map((p) => p.id);

    const rows = await queryAudienceRows({
      videoIds: publishIds,
      dimension: 'follower_status',
    });

    let subscribedViews = 0;
    let notSubscribedViews = 0;

    for (const row of rows) {
      if (row.key === 'subscribed') subscribedViews += row.views;
      else notSubscribedViews += row.views;
    }

    const total = subscribedViews + notSubscribedViews;

    return {
      subscribedViews,
      notSubscribedViews,
      subscribedShare: total > 0 ? subscribedViews / total : 0,
      isProxy: true as const,
    };
  },
  {
    schema: z.object({ scope: ScopeSchema }),
    auth: true,
  },
);
