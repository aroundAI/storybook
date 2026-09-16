'use server';

import 'server-only';

import { queryTotalsByVideoIds } from '@kit/clickhouse/server';
import { enhanceAction } from '@kit/next/actions';
import { fetchAllRows } from '@kit/shared/pagination';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

import {
  REVENUE_SUMMARY_SCHEMA_VERSION,
  effectiveRevenueCategory,
  payoutShare,
  splitRevenueByPayout,
} from '../lib/revenue-mix';
import {
  AddManualRevenueSchema,
  DeleteManualRevenueSchema,
  GenerateRevenueReportSchema,
  GetRevenueProjectionSchema,
  GetRevenueSummarySchema,
  GetRevenueTimeSeriesSchema,
  GetTopContentByRevenueSchema,
  SyncRevenueFromPlatformSchema,
} from '../lib/schemas/revenue.schema';
import type {
  RevenueDataPoint,
  RevenueProjection,
  RevenueRecord,
  RevenueSummary,
  TopRevenueContent,
} from '../lib/types/revenue';
import { forEachAccountRevenueRow } from './revenue-queries';

/**
 * All published publish ids for an account. Used as the RPM denominator so
 * views from content that earned nothing still count — otherwise RPM is
 * computed only over revenue-bearing videos and reads far too high.
 */
async function fetchAccountPublishIds(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client: any,
  accountId: string,
): Promise<string[]> {
  // Paged. This is the denominator itself, so a short read inflates every
  // RPM figure — the precise defect this function was added to remove.
  const rows = await fetchAllRows<{ id: string }>(
    (from, to) =>
      client
        .from('publishes')
        .select('id, episodes!inner(projects!inner(account_id))')
        .eq('status', 'published')
        .eq('episodes.projects.account_id', accountId)
        .order('id')
        .range(from, to),
    'account publish ids',
  );

  return rows.map((row) => row.id);
}

export const getRevenueSummaryAction = enhanceAction(
  async function (data): Promise<RevenueSummary> {
    const client = getSupabaseServerClient();
    const { accountId, startDate, endDate } = data;

    // Both publish-scoped and channel-scoped revenue
    // Calculate totals and group by platform/content/category in single
    // pass, streamed so the window never has to be held in memory.
    let totalRevenueCents = 0;
    const byPlatform: Record<string, number> = {};
    const byContent: Record<string, number> = {};
    const byType: Record<string, number> = {};
    const publishIds: string[] = [];

    await forEachAccountRevenueRow(
      client,
      accountId,
      startDate,
      endDate,
      (r) => {
        const revenueCents = r.revenue_cents || 0;
        totalRevenueCents += revenueCents;

        // Group by platform
        const platform = r.platform || 'unknown';
        byPlatform[platform] = (byPlatform[platform] || 0) + revenueCents;

        // Group by revenue category (the mix: ads vs sponsorship vs product).
        // Keyed on what the row counts as rather than what it says: a
        // hand-entered 'ads' row from before the form dropped that option is
        // not evidence of a platform payout, and counting it as one inflates
        // the ad-share signal for every account that has an old row.
        const category = effectiveRevenueCategory(
          r.category || 'ads',
          r.source,
        );
        byType[category] = (byType[category] || 0) + revenueCents;

        // Group by content (episode) — channel-level rows have no episode
        if (r.episode_id) {
          byContent[r.episode_id] =
            (byContent[r.episode_id] || 0) + revenueCents;
        }

        if (r.publish_id) {
          publishIds.push(r.publish_id);
        }
      },
    );

    // RPM denominator is every published video's views in the window, not
    // only the ones that earned — otherwise RPM is inflated by excluding
    // content that produced views but no revenue row.
    const denominatorPublishIds = await fetchAccountPublishIds(
      client,
      accountId,
    );

    let totalViews = 0;

    if (denominatorPublishIds.length > 0) {
      const perVideoTotals = await queryTotalsByVideoIds(
        denominatorPublishIds,
        { startDate, endDate },
      );

      for (const [, stats] of perVideoTotals) {
        totalViews += stats.views;
      }
    }

    // Revenue mix: ads + Premium are platform payouts; everything else is
    // income the channel built itself. A falling ads share is the health
    // signal, so both halves are returned rather than derived downstream.
    //
    // The split lives in lib/revenue-mix.ts so that "which side does a new
    // category fall on" is answered by a test rather than by re-reading
    // this line each time the vocabulary grows.
    const { adsRevenueCents, nonAdRevenueCents } = splitRevenueByPayout(
      byType,
      totalRevenueCents,
    );

    // The denominator the two share fields use: positive buckets only.
    const positiveRevenueCents = Object.values(byType).reduce(
      (sum, cents) => sum + (cents > 0 ? cents : 0),
      0,
    );
    const payoutSharePercent = payoutShare(byType) * 100;

    /** Cents per 1000 views. Display sites divide by 100 for dollars. */
    const allInRpmCents =
      totalViews > 0 ? (totalRevenueCents / totalViews) * 1000 : 0;
    const adsRpmCents =
      totalViews > 0 ? (adsRevenueCents / totalViews) * 1000 : 0;
    const rpm = allInRpmCents;

    // Calculate day count and average
    const startDateObj = new Date(startDate);
    const endDateObj = new Date(endDate);
    const dayCount = Math.max(
      1,
      Math.ceil(
        (endDateObj.getTime() - startDateObj.getTime()) / (1000 * 60 * 60 * 24),
      ) + 1,
    );
    const averageDailyRevenueCents = totalRevenueCents / dayCount;

    // Calculate trend by comparing to previous period
    const previousStartDate = new Date(startDateObj);
    previousStartDate.setDate(previousStartDate.getDate() - dayCount);

    // Single-pass sum for previous period, streamed.
    let previousTotal = 0;

    await forEachAccountRevenueRow(
      client,
      accountId,
      previousStartDate.toISOString().split('T')[0]!,
      startDate,
      (r) => {
        previousTotal += r.revenue_cents || 0;
      },
      { toExclusive: true },
    );
    const trendPercent =
      previousTotal > 0
        ? ((totalRevenueCents - previousTotal) / previousTotal) * 100
        : totalRevenueCents > 0
          ? 100
          : 0;

    return {
      totalRevenueCents,
      currency: 'USD',
      period: { start: startDate, end: endDate },
      byPlatform,
      byContent,
      byType,
      rpm,
      totalViews,
      adsRevenueCents,
      nonAdRevenueCents,
      // Over positive buckets, via the shared rule, and computed once.
      //
      // A signed total is not a denominator: `{ ads: 10000, sponsorship:
      // -8000 }` reported adsSharePercent as 500 while the card showed 100
      // for the same data. Fixing that dropped the old `total > 0` guard,
      // which made an account with no revenue at all report
      // `nonAdSharePercent: 100` — and that figure is persisted into
      // revenue_reports.summary_data, so it is not display-only.
      //
      // positiveRevenueCents travels with them because the cents fields
      // beside these are signed: without the denominator in the payload, a
      // consumer recomputing `adsRevenueCents / totalRevenueCents` gets a
      // different number than the percentage states.
      adsSharePercent: positiveRevenueCents > 0 ? payoutSharePercent : 0,
      nonAdSharePercent:
        positiveRevenueCents > 0 ? 100 - payoutSharePercent : 0,
      positiveRevenueCents,
      adsRpmCents,
      allInRpmCents,
      averageDailyRevenueCents,
      trend: trendPercent > 5 ? 'up' : trendPercent < -5 ? 'down' : 'stable',
      trendPercent,
    };
  },
  {
    auth: true,
    schema: GetRevenueSummarySchema,
  },
);

/**
 * Add or update a manual revenue entry.
 * Uses upsert to handle both create and update.
 */
/**
 * Why a manual entry was refused, in a form that survives a production
 * build.
 *
 * `not_yours` — a channel-level entry exists for this date and category, and
 * the caller neither wrote it nor owns the account.
 *
 * `project_role` — the same refusal on a per-video entry, where the blocker
 * is the caller's role on the publish's project and account ownership is
 * beside the point. Split because one sentence cannot be true of both, and
 * `deleteManualRevenueAction` already made this distinction.
 *
 * `no_access` — the caller may not record revenue against this scope at all,
 * as opposed to being blocked by an entry that already exists. Reached on a
 * date with no entry, where the other two cannot apply.
 *
 * `conflict` — an entry for this date and category appeared between this
 * call's lookup and its insert. Two members, or one person in two tabs
 * (`isSubmitting` only guards a single mount): both lookups miss, both
 * insert, and the loser hits `idx_revenue_records_unique_scope` with 23505.
 * Reported rather than retried — a retry would silently overwrite the figure
 * the other person just saved, and a lost update nobody is told about is
 * worse than a refusal they can act on.
 *
 * There is no `synced` case: `source` is part of the unique key, so a
 * platform figure occupies a different row and is never in the way.
 */
export type AddManualRevenueResult =
  | { ok: true; record: RevenueRecord }
  | {
      ok: false;
      reason: 'project_role' | 'not_yours' | 'no_access' | 'conflict';
    };

export const addManualRevenueAction = enhanceAction(
  async function (data, user): Promise<AddManualRevenueResult> {
    const client = getSupabaseServerClient();
    const {
      publishId,
      accountId,
      date,
      revenueCents,
      currency,
      category,
      notes,
    } = data;

    // Channel-level revenue (sponsorships, product sales) has no publish
    let platform = 'manual';

    if (publishId) {
      const { data: publish, error: publishError } = await client
        .from('publishes')
        .select('platform')
        .eq('id', publishId)
        .single();

      if (publishError || !publish) {
        throw new Error('Publish not found or access denied');
      }

      platform = publish.platform;
    }

    // The unique index is on coalesce(publish_id, account_id) and cannot be
    // named as an onConflict target, so replace any existing row explicitly.
    // Scoped to the manual slot, because `source` is part of the unique key
    // now: a synced figure for this date and category lives in its own row
    // and is none of this action's business.
    const existingQuery = client
      .from('revenue_records')
      .select('id')
      .eq('record_date', date)
      .eq('category', category)
      .eq('source', 'manual');

    const { data: existing, error: existingError } = await (
      publishId
        ? existingQuery.eq('publish_id', publishId)
        : // `is('publish_id', null)` matters: the unique index keys on
          // coalesce(publish_id, account_id), so a legacy row carrying
          // *both* ids coalesces to its publish and can sit beside a real
          // channel-level row for the same date and category. Without this,
          // the account branch could match that row and `update` it — which
          // sets publish_id null and quietly turns a per-video entry into a
          // channel-level one — or match two rows and fail permanently.
          existingQuery.eq('account_id', accountId!).is('publish_id', null)
    ).maybeSingle();

    // Not discarded: a legacy row carrying both publish_id and account_id
    // makes this match twice, and maybeSingle then returns an error with a
    // null row — which fell through to the INSERT and surfaced a raw
    // duplicate-key violation, which is what this lookup exists to avoid.
    if (existingError) throw existingError;

    // A manual entry replaces a manual entry and never a synced one, which
    // is a property of the lookup above rather than of a refusal: `source`
    // is part of the unique key, so the platform's figure for this date and
    // category lives in its own row and is none of this action's business.
    const values = {
      // Exactly one scope, enforced here rather than trusted from the
      // caller. The schema permits both, and a row carrying both ids makes
      // the lookup above match two rows for one date and category —
      // `maybeSingle` then fails, and channel entry for that pair is
      // blocked for good. A comment in the form used to assert this; the
      // form is not the only caller of a server action.
      publish_id: publishId ?? null,
      account_id: publishId ? null : (accountId ?? null),
      platform,
      record_date: date,
      revenue_cents: revenueCents,
      currency: currency || 'USD',
      source: 'manual' as const,
      category,
      metadata: notes ? { notes } : {},
      updated_at: new Date().toISOString(),
    };

    const { data: record, error } = existing
      ? await client
          .from('revenue_records')
          // `values` deliberately carries no `created_by`: it is set on
          // insert only. Stamping it on every correction transfers
          // authorship — an owner fixing a member's typo would become the
          // author, the member would lose the right to touch their own
          // entry, and the column would name the wrong person. Which is
          // the provenance the column was added to keep.
          .update(values)
          .eq('id', existing.id)
          .select()
          // maybeSingle, not single: a member may *read* a channel-level
          // row but not update it, so RLS filters the write to zero rows
          // rather than raising. `single()` turns that into PostgREST's
          // "JSON object requested, multiple (or no) rows returned", which
          // tells the user nothing about what actually happened.
          .maybeSingle()
      : await client
          .from('revenue_records')
          // Who may correct this later: the author, or an account owner.
          .insert({ ...values, created_by: user.id })
          .select()
          .single();

    // An insert the policy refuses raises 42501 rather than returning zero
    // rows, and a thrown error reaches the user as a Next digest in a
    // production build — the same masking that made every other refusal on
    // this path a return value. A caller who is an account member but not on
    // the publish's project hits this on any date that has no entry yet,
    // while the identical wall on a date that *does* have one gets a sentence.
    if (error?.code === '42501') {
      return { ok: false, reason: 'no_access' };
    }

    // 23505: the row this call's lookup did not find was created by someone
    // else before the insert landed. Rethrowing reaches the user as a Next
    // digest, which is the opaque failure this whole return-value shape
    // exists to avoid — and it is the one refusal on this path that is
    // nobody's fault and worth retrying by hand.
    if (error?.code === '23505') {
      return { ok: false, reason: 'conflict' };
    }

    if (error) throw error;

    if (existing && !record) {
      // Scope-specific, mirroring the delete path: the same zero-row result
      // arrives from either RLS branch, and a project member refused by the
      // publish branch was being told about account owners.
      return { ok: false, reason: publishId ? 'project_role' : 'not_yours' };
    }

    if (!record) throw new Error('Failed to create revenue record');

    return {
      ok: true,
      record: {
        id: record.id,
        publishId: record.publish_id ?? '',
        platform: record.platform as
          | 'youtube'
          | 'tiktok'
          | 'instagram'
          | 'facebook'
          | 'twitter'
          | 'linkedin'
          | 'manual',
        date: record.record_date,
        revenueCents: record.revenue_cents,
        currency: record.currency ?? 'USD',
        source: record.source as 'api' | 'manual',
        breakdown: record.breakdown as Record<string, number> | undefined,
        metadata: record.metadata as Record<string, unknown> | undefined,
        createdAt: new Date(record.created_at),
        updatedAt: new Date(record.updated_at),
      },
    };
  },
  {
    auth: true,
    schema: AddManualRevenueSchema,
  },
);

/**
 * Delete a manual revenue entry.
 */
/** Why a delete removed nothing, in a form that survives a prod build. */
export type DeleteManualRevenueResult =
  | { success: true }
  | {
      success: false;
      reason: 'project_role' | 'not_yours';
      /** Rows the caller did remove before the rest were refused. */
      removed: number;
    };

export const deleteManualRevenueAction = enhanceAction(
  async function (data): Promise<DeleteManualRevenueResult> {
    const client = getSupabaseServerClient();
    const { publishId, accountId, date, category } = data;

    // What the caller can *see*. Reading is open to any member, so this
    // says whether there was anything to delete — which the delete itself
    // cannot, since RLS filters rows out of a DELETE silently rather than
    // raising.
    let visible = client
      .from('revenue_records')
      .select('id')
      .eq('record_date', date)
      .eq('source', 'manual');

    let query = client
      .from('revenue_records')
      .delete()
      .eq('record_date', date)
      .eq('source', 'manual');

    if (publishId) {
      visible = visible.eq('publish_id', publishId);
      query = query.eq('publish_id', publishId);
    } else {
      // Same reasoning as the lookup above: a dual-scope row belongs to
      // its publish, not to the channel.
      visible = visible.eq('account_id', accountId!).is('publish_id', null);
      query = query.eq('account_id', accountId!).is('publish_id', null);
    }

    if (category) {
      visible = visible.eq('category', category);
      query = query.eq('category', category);
    }

    const { data: matched, error: matchError } = await visible;

    if (matchError) throw matchError;

    const { data: removed, error } = await query.select('id');

    if (error) throw error;

    // Rows exist, the caller can read them, and none were removed: the
    // delete policy refused. Returning `{ success: true }` here is the same
    // silent-no-op the update path already guards against — channel-level
    // delete is author-or-owner since 20260915190043, so a member can read
    // rows they may not remove.
    // Compared, not merely checked for zero. `category` is optional, so one
    // call can match several rows — and with the author-or-owner delete
    // policy a member deleting a whole date removes only their own. Some
    // rows removed and some refused is not success, and reporting it as
    // success leaves the survivors invisible.
    //
    // Two known limits, stated so the next reader need not re-derive them:
    //
    // - These are two round-trips, so a row deleted by someone else in
    //   between makes this report a permissions refusal that never happened,
    //   with an under-counted `removed`. Rare, and the fix is one statement
    //   rather than two — the RPC already planned as TODO(FILM-1614).
    // - `matched === 0` returns success, which also covers a scope the caller
    //   cannot see at all. That is deliberate: the alternative distinguishes
    //   "nothing there" from "not yours to see", which is a disclosure the
    //   read policy exists to prevent. Deleting nothing is not a failure.
    if ((matched?.length ?? 0) > (removed?.length ?? 0)) {
      // Scope-specific: the same condition fires for either RLS branch,
      // and a project member refused by the publish branch was being told
      // about account owners and channel-level entries — neither of which
      // described their situation.
      return {
        success: false,
        reason: publishId ? 'project_role' : 'not_yours',
        // What *was* removed. Without it a caller deleting a whole date is
        // told the operation failed while their own rows are already gone —
        // the refusal is true of the rest and false of what it destroyed.
        removed: removed?.length ?? 0,
      };
    }

    return { success: true };
  },
  {
    auth: true,
    schema: DeleteManualRevenueSchema,
  },
);

/**
 * Get revenue projection based on historical data.
 * Calculates estimated monthly and yearly revenue with confidence levels.
 */
export const getRevenueProjectionAction = enhanceAction(
  async function (data): Promise<RevenueProjection> {
    const client = getSupabaseServerClient();
    const { accountId } = data;

    // Get last 30 days of revenue
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    // Single-pass aggregation for total, unique dates, and trend
    // calculation, streamed.
    let totalRecent = 0;
    let firstHalfRevenue = 0;
    const uniqueDates = new Set<string>();
    const fifteenDaysAgo = new Date();
    fifteenDaysAgo.setDate(fifteenDaysAgo.getDate() - 15);

    await forEachAccountRevenueRow(
      client,
      accountId,
      thirtyDaysAgo.toISOString().split('T')[0]!,
      new Date().toISOString().split('T')[0]!,
      (r) => {
        const revenueCents = r.revenue_cents || 0;
        totalRecent += revenueCents;
        uniqueDates.add(r.record_date);

        // Check if in first half for trend
        const date = new Date(r.record_date);
        if (date < fifteenDaysAgo) {
          firstHalfRevenue += revenueCents;
        }
      },
    );

    const daysWithData = uniqueDates.size;

    // Calculate daily average
    const dailyAverage = daysWithData > 0 ? totalRecent / daysWithData : 0;

    // Project monthly and yearly
    const estimatedMonthlyRevenueCents = Math.round(dailyAverage * 30);
    const estimatedYearlyRevenueCents = Math.round(dailyAverage * 365);

    // Determine confidence level
    let confidenceLevel: 'high' | 'medium' | 'low' = 'low';
    if (daysWithData >= 25) confidenceLevel = 'high';
    else if (daysWithData >= 14) confidenceLevel = 'medium';

    // Calculate trend for impact factor
    const secondHalfRevenue = totalRecent - firstHalfRevenue;
    const trendImpact =
      firstHalfRevenue > 0
        ? Math.round(
            ((secondHalfRevenue - firstHalfRevenue) / firstHalfRevenue) * 50,
          )
        : 0;

    return {
      estimatedMonthlyRevenueCents,
      estimatedYearlyRevenueCents,
      confidenceLevel,
      basedOnDays: daysWithData,
      factors: [
        {
          factor: 'Historical Data',
          impact: daysWithData >= 14 ? 20 : -20,
          description:
            daysWithData >= 14
              ? 'Sufficient data for accurate projection'
              : 'Limited data may affect accuracy',
        },
        {
          factor: 'Trend Direction',
          impact: trendImpact,
          description:
            trendImpact > 0
              ? 'Revenue is trending upward'
              : trendImpact < 0
                ? 'Revenue is trending downward'
                : 'Revenue is stable',
        },
      ],
    };
  },
  {
    auth: true,
    schema: GetRevenueProjectionSchema,
  },
);

/**
 * Get revenue time series data for charts.
 */
export const getRevenueTimeSeriesAction = enhanceAction(
  async function (data): Promise<RevenueDataPoint[]> {
    const client = getSupabaseServerClient();
    const { accountId, startDate, endDate } = data;

    // Aggregate by date, streamed. The rows were sorted before folding,
    // which a map fold does not need — the series is built from the date
    // range below, in order, regardless of arrival order.
    const dateMap = new Map<string, number>();

    await forEachAccountRevenueRow(
      client,
      accountId,
      startDate,
      endDate,
      (r) => {
        const existing = dateMap.get(r.record_date) ?? 0;
        dateMap.set(r.record_date, existing + (r.revenue_cents || 0));
      },
    );

    // Fill in missing dates with 0
    const result: RevenueDataPoint[] = [];
    const currentDate = new Date(startDate);
    const endDateObj = new Date(endDate);

    while (currentDate <= endDateObj) {
      const dateStr = currentDate.toISOString().split('T')[0] ?? '';
      result.push({
        date: dateStr,
        revenueCents: dateMap.get(dateStr) ?? 0,
      });
      currentDate.setDate(currentDate.getDate() + 1);
    }

    return result;
  },
  {
    auth: true,
    schema: GetRevenueTimeSeriesSchema,
  },
);

/**
 * Get top content by revenue.
 */
export const getTopContentByRevenueAction = enhanceAction(
  async function (data): Promise<TopRevenueContent[]> {
    const client = getSupabaseServerClient();
    const { accountId, startDate, endDate, limit } = data;

    // Paged. `limit` is applied after aggregation, so truncation here would
    // not just shorten the list: a publish earning across many dates loses
    // some of them, understating its total and reordering the ranking.
    const records = await fetchAllRows<{
      publish_id: string | null;
      revenue_cents: number | null;
      platform: string | null;
      publishes?: {
        episode_id?: string | null;
        platform?: string | null;
        thumbnail_url?: string | null;
        episodes?: { title?: string | null } | null;
      } | null;
    }>(
      (from, to) =>
        client
          .from('revenue_records')
          .select(
            `
        publish_id,
        revenue_cents,
        platform,
        publishes!inner (
          id,
          episode_id,
          platform,
          thumbnail_url,
          episodes!inner (
            id,
            title,
            project_id,
            projects!inner (
              account_id
            )
          )
        )
      `,
          )
          .gte('record_date', startDate)
          .lte('record_date', endDate)
          .eq('publishes.episodes.projects.account_id', accountId)
          .order('id')
          .range(from, to),
      'top content by revenue',
    );

    // Aggregate by publish
    const publishMap = new Map<
      string,
      {
        publishId: string;
        episodeId: string;
        title: string;
        platform: string;
        revenueCents: number;
        thumbnailUrl?: string;
      }
    >();

    records?.forEach((r) => {
      // Channel-level revenue has no publish to attribute to
      const publishId = r.publish_id;
      if (!publishId) return;

      const existing = publishMap.get(publishId);
      if (existing) {
        existing.revenueCents += r.revenue_cents || 0;
      } else {
        publishMap.set(publishId, {
          publishId,
          episodeId: r.publishes?.episode_id ?? '',
          title: r.publishes?.episodes?.title ?? 'Untitled',
          platform: r.publishes?.platform ?? 'unknown',
          revenueCents: r.revenue_cents || 0,
          thumbnailUrl: r.publishes?.thumbnail_url ?? undefined,
        });
      }
    });

    // Get views for RPM calculation from ClickHouse
    const publishIds = Array.from(publishMap.keys());
    const viewsMap = new Map<string, number>();

    if (publishIds.length > 0) {
      const perVideoTotals = await queryTotalsByVideoIds(publishIds, {
        startDate,
        endDate,
      });

      for (const [videoId, stats] of perVideoTotals) {
        viewsMap.set(videoId, stats.views);
      }
    }

    // Sort by revenue and return top items
    const sortedContent = Array.from(publishMap.values())
      .map((item) => {
        const views = viewsMap.get(item.publishId) ?? 0;
        return {
          ...item,
          views,
          rpm: views > 0 ? (item.revenueCents / views) * 1000 : 0,
        };
      })
      .sort((a, b) => b.revenueCents - a.revenueCents)
      .slice(0, limit);

    return sortedContent;
  },
  {
    auth: true,
    schema: GetTopContentByRevenueSchema,
  },
);

/**
 * Generate a revenue report for the given period.
 */
export const generateRevenueReportAction = enhanceAction(
  async function (data) {
    const client = getSupabaseServerClient();
    const { accountId, periodType, startDate, endDate, format } = data;

    // Get summary data
    const summary = await getRevenueSummaryAction({
      accountId,
      startDate,
      endDate,
    });

    // Get top performers
    const topPerformers = await getTopContentByRevenueAction({
      accountId,
      startDate,
      endDate,
      limit: 10,
    });

    // Calculate platform breakdown
    const platformBreakdown = Object.entries(summary.byPlatform).map(
      ([platform, cents]) => ({
        platform,
        revenueCents: cents,
        percentOfTotal:
          summary.totalRevenueCents > 0
            ? (cents / summary.totalRevenueCents) * 100
            : 0,
        contentCount: 0, // Could be calculated if needed
      }),
    );

    // Create report record - cast to Json for JSONB columns
    type Json =
      | string
      | number
      | boolean
      | null
      | { [key: string]: Json | undefined }
      | Json[];

    const { data: report, error } = await client
      .from('revenue_reports')
      .insert({
        account_id: accountId,
        period_type: periodType,
        start_date: startDate,
        end_date: endDate,
        // Stamped so a reader can tell which definition of
        // adsSharePercent it is looking at; rows without it predate the
        // change from a signed denominator to a positive-only one.
        summary_data: JSON.parse(
          JSON.stringify({
            ...summary,
            schemaVersion: REVENUE_SUMMARY_SCHEMA_VERSION,
          }),
        ) as Json,
        top_performers: JSON.parse(JSON.stringify(topPerformers)) as Json,
        platform_breakdown: JSON.parse(
          JSON.stringify(platformBreakdown),
        ) as Json,
        file_format: format,
      })
      .select()
      .single();

    if (error) throw error;
    if (!report) throw new Error('Failed to create revenue report');

    return {
      id: report.id,
      accountId: report.account_id,
      period: report.period_type,
      startDate: report.start_date,
      endDate: report.end_date,
      summary,
      topPerformers,
      platformBreakdown,
      generatedAt: new Date(report.created_at),
      format,
    };
  },
  {
    auth: true,
    schema: GenerateRevenueReportSchema,
  },
);

/**
 * Sync revenue from platform API for a specific publish.
 * Currently supports YouTube.
 */
export const syncRevenueFromPlatformAction = enhanceAction(
  async function (data) {
    const client = getSupabaseServerClient();
    const { publishId } = data;

    // Get publish details with platform connection
    const { data: publish, error: publishError } = await client
      .from('publishes')
      .select(
        `
        id,
        platform,
        platform_content_id,
        platform_connection_id,
        episodes!inner (
          project_id,
          projects!inner (
            account_id
          )
        )
      `,
      )
      .eq('id', publishId)
      .single();

    if (publishError || !publish) {
      return {
        success: false,
        error: 'Publish not found or access denied',
      };
    }

    // Currently only YouTube supports revenue API
    if (publish.platform !== 'youtube') {
      return {
        success: false,
        error: `Revenue sync not supported for platform: ${publish.platform}`,
      };
    }

    if (!publish.platform_content_id) {
      return {
        success: false,
        error: 'No platform content ID found for this publish',
      };
    }

    // Get platform connection for access token
    if (!publish.platform_connection_id) {
      return {
        success: false,
        error: 'No platform connection found for this publish',
      };
    }

    const { data: connection, error: connectionError } = await client
      .from('platform_connections')
      .select('access_token_encrypted, is_active')
      .eq('id', publish.platform_connection_id)
      .single();

    if (connectionError || !connection) {
      return {
        success: false,
        error: 'Platform connection not found',
      };
    }

    if (!connection.is_active) {
      return {
        success: false,
        error: 'Platform connection is inactive',
      };
    }

    // Run the same sync path the cron uses, which fetches analytics and
    // writes the categorized revenue rows
    const { syncSinglePublishById } = await import('./analytics-sync-cron');
    const result = await syncSinglePublishById(publishId);

    if (!result.success) {
      return {
        success: false,
        error: result.error ?? 'Revenue sync failed',
      };
    }

    return {
      success: true,
      message: 'Revenue synced from the platform.',
    };
  },
  {
    auth: true,
    schema: SyncRevenueFromPlatformSchema,
  },
);
