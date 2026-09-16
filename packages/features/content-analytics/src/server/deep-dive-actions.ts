'use server';

import { z } from 'zod';

import {
  queryBackCatalogShare,
  queryChannelWatchWindow,
  queryCohortMedians,
  queryMedianViewsPerVideo,
  queryRollingViews,
  queryTrafficSourceBreakdown,
  queryWatchWindowTotals,
} from '@kit/clickhouse/server';
import { computeCohortGrowth } from '@kit/clickhouse/server';
import type { DimScope } from '@kit/clickhouse/server';
import { enhanceAction } from '@kit/next/actions';
import { fetchAllRows } from '@kit/shared/pagination';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

// Out of this file because it is `'use server'`: every export of such a
// module must be an async function, so a schema with a synchronous
// `.refine` cannot live here and stay testable. See traffic.schema.ts.
import {
  type Scope,
  ScopeSchema,
  TrafficBreakdownSchema,
} from '../lib/schemas/traffic.schema';
import { formatDate } from '../lib/utils';
import { resolveYppTarget } from '../lib/ypp-targets';
import { listAccountChannels } from './channels';
import { assertScopeAccess } from './scope-access';
import { fetchAccountAnalyticsSettings } from './settings-queries';

function toDimScope(scope: Scope): DimScope {
  return {
    projectId: scope.projectId,
    accountId: scope.accountId,
    connectionId: scope.connectionId,
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
 * Views and watch time per traffic-source group, per bucket (FILM-1605).
 *
 * The share trend answers only "how much is Browse+Suggested"; this answers
 * where the rest came from. The query carries no tenant predicate beyond
 * the scope conditions, so `assertScopeAccess` is the boundary rather than
 * a formality.
 */
export const getTrafficBreakdownAction = enhanceAction(
  async ({ scope, bucket, from, to }) => {
    await assertScopeAccess(scope);

    return queryTrafficSourceBreakdown({
      scope: toDimScope(scope),
      bucket,
      // Not conditional: the schema requires both dates, which is what
      // makes MAX_BREAKDOWN_SPAN_DAYS a bound rather than a suggestion.
      startDate: formatDate(from),
      endDate: formatDate(to),
    });
  },
  {
    schema: TrafficBreakdownSchema,
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
 * Upload cohorts with the distribution of per-video views at fixed ages,
 * plus growth against the previous cohort.
 *
 * Medians, not means: this is the view whose purpose is controlling for
 * luck, and a mean lets one viral video move the whole cohort's line.
 *
 * Maturity is per video per checkpoint, resolved in the query. The previous
 * implementation derived one age from the cohort's *start*, so a cohort
 * containing a video published yesterday was still flagged mature at 30
 * days and that video's near-zero dragged the figure down.
 */
export const getCohortCurvesAction = enhanceAction(
  async ({ scope, checkpoints, bucket }) => {
    await assertScopeAccess(scope);

    const rows = await queryCohortMedians({
      scope: toDimScope(scope),
      checkpoints,
      bucket,
    });

    const growth = computeCohortGrowth(rows, checkpoints);

    return rows.map((row, index) => ({
      cohort: row.cohort,
      videoCount: row.videoCount,
      checkpoints: checkpoints.map((ageDays) => {
        const stats = row.checkpoints[ageDays];
        const change = growth[index]?.[ageDays];

        return {
          ageDays,
          medianViews: stats?.medianViews ?? 0,
          p25Views: stats?.p25Views ?? 0,
          p75Views: stats?.p75Views ?? 0,
          meanViews: stats?.meanViews ?? 0,
          matureVideoCount: stats?.matureVideoCount ?? 0,
          predatesIngestCount: stats?.predatesIngestCount ?? 0,
          // No mature videos means the cohort has not reached this age at
          // all — distinct from "reached it and scored zero".
          mature: (stats?.matureVideoCount ?? 0) > 0,
          growth: change?.growth ?? null,
          growthSuppressedBecause: change?.reason ?? null,
        };
      }),
    }));
  },
  {
    schema: z.object({
      scope: ScopeSchema,
      checkpoints: z
        .array(z.number().int().min(1).max(730))
        .max(8)
        .default([30, 90, 180, 365]),
      bucket: z.enum(['month', 'quarter']).default('quarter'),
    }),
    auth: true,
  },
);

/**
 * Watch-hours and subscriber progress toward the YPP gate, per channel.
 *
 * YPP is a per-channel gate, so this returns one row per channel and never
 * a pooled total — summing two channels' watch hours against one 4,000-hour
 * target would say a threshold is met when neither channel has met it.
 *
 * A channel's watch time is its videos published through this platform
 * (video_metrics, filtered by connection) plus channel_daily, which holds
 * exactly the residual for videos that never matched a publish. The two are
 * complementary halves, so adding them double-counts nothing.
 */
export const getYppProgressAction = enhanceAction(
  async ({ accountId, connectionId, windowDays }) => {
    await assertScopeAccess({ accountId, connectionId });

    const client = getSupabaseServerClient();

    const [accountSettings, channels, { data: overrides }] = await Promise.all([
      fetchAccountAnalyticsSettings(accountId, client),
      listAccountChannels(accountId, client, {
        platform: 'youtube',
        activeOnly: true,
      }),
      client
        .from('channel_analytics_settings')
        .select(
          'connection_id, ypp_target_watch_hours, ypp_target_subscribers, ypp_applicant_status, joined_ypp_at',
        )
        .eq('account_id', accountId),
    ]);

    // The targets used to be `?? 4000` / `?? 1000` right here, which applied
    // one account-wide pair to every channel of a gate that is per-channel.
    // Resolution now lives in `resolveYppTarget` — channel, then account,
    // then default — so this action and the taxonomy one cannot disagree
    // about what an unset setting means.
    const overrideByConnection = new Map(
      (overrides ?? []).map((row) => [row.connection_id, row]),
    );

    const selected = connectionId
      ? channels.filter((channel) => channel.connectionId === connectionId)
      : channels;

    // assertScopeAccess proves the channel belongs to this account, but this
    // list is additionally filtered to active YouTube channels — YPP applies
    // to neither a disconnected channel nor a TikTok one. Say so rather than
    // returning an empty array that reads as "no progress yet".
    if (connectionId && selected.length === 0) {
      throw new Error(
        'Channel is not an active YouTube connection, so it has no YPP progress',
      );
    }

    return Promise.all(
      selected.map(async (channel) => {
        const [videoTotals, channelTotals] = await Promise.all([
          queryWatchWindowTotals({
            scope: {
              accountId,
              connectionId: channel.connectionId,
              platform: 'youtube',
            },
            windowDays,
          }),
          queryChannelWatchWindow({
            connectionIds: [channel.connectionId],
            windowDays,
          }),
        ]);

        const watchHours =
          (videoTotals.watchTimeSeconds + channelTotals.watchTimeSeconds) /
          3600;

        const target = resolveYppTarget({
          channelSettings:
            overrideByConnection.get(channel.connectionId) ?? null,
          accountSettings,
        });

        return {
          connectionId: channel.connectionId,
          channelName: channel.name,
          watchHours: Math.round(watchHours * 10) / 10,
          targetWatchHours: target.watchHours,
          watchHoursProgress: Math.min(1, watchHours / target.watchHours),
          // Net movement, not an absolute count — the absolute figure needs
          // the channel snapshot introduced in FILM-1607.
          netSubscribers: videoTotals.netSubscribers,
          targetSubscribers: target.subscribers,
          subscriberProgress: Math.min(
            1,
            Math.max(0, videoTotals.netSubscribers) / target.subscribers,
          ),
          // Per metric, because the two override columns are independently
          // nullable: a channel can set a subscriber target and inherit its
          // watch-hours one, and a single basis would be wrong about one of
          // them.
          watchHoursBasis: target.watchHoursBasis,
          subscribersBasis: target.subscribersBasis,
          applicantStatus: target.applicantStatus,
          joinedYppAt: target.joinedYppAt,
          alreadyJoined: target.alreadyJoined,
          windowDays,
        };
      }),
    );
  },
  {
    schema: z.object({
      accountId: z.string().uuid(),
      connectionId: z.string().uuid().optional(),
      windowDays: z.number().int().min(90).max(400).default(365),
    }),
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

    // Paged: this list is a denominator, not a display list. Truncating it
    // biases both halves of the subscribed share, so the headline "owned vs
    // rented audience" ratio would be computed over an arbitrary subset.
    const publishes = await fetchAllRows<{ id: string }>((from, to) => {
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

      return publishQuery.order('id').range(from, to);
    }, 'returning-viewer publishes');

    const publishIds = publishes.map((p) => p.id);

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
