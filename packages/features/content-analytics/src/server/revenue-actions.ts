'use server';

import 'server-only';

import { recordViewsDenominator } from '@kit/clickhouse';
import { queryTotalsByVideoIds } from '@kit/clickhouse/server';
import { enhanceAction } from '@kit/next/actions';
import { returnRefusals } from '@kit/next/refusals';
import { fetchAllRows } from '@kit/shared/pagination';
import { readFailed, whyNoRow } from '@kit/shared/rows';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

import { addCalendarDays, callerTodayOr } from '../lib/caller-date';
import {
  createRevenueProjectionFold,
  createRevenueSeriesFold,
  createRevenueSummaryFold,
  createTopContentFold,
  inclusiveDayCount,
} from '../lib/revenue-by-currency';
import { REVENUE_SUMMARY_SCHEMA_VERSION } from '../lib/revenue-mix';
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
  RevenueProjection,
  RevenueRecord,
  RevenueSeries,
  RevenueSummary,
  TopRevenueContentByCurrency,
} from '../lib/types/revenue';
import { viewsToAdd } from '../lib/views';
import { forEachAccountRevenueRow } from './revenue-queries';

/**
 * All published publish ids for an account. Used as the RPM denominator so
 * views from content that earned nothing still count — otherwise RPM is
 * computed only over revenue-bearing videos and reads far too high.
 */
async function fetchAccountPublishes(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client: any,
  accountId: string,
): Promise<{ id: string; platform: string }[]> {
  // Paged. This is the denominator itself, so a short read inflates every
  // RPM figure — the precise defect this function was added to remove.
  const rows = await fetchAllRows<{ id: string; platform: string }>(
    (from, to) =>
      client
        .from('publishes')
        .select('id, platform, episodes!inner(projects!inner(account_id))')
        .eq('status', 'published')
        .eq('episodes.projects.account_id', accountId)
        .order('id')
        .range(from, to),
    'account publish ids',
  );

  return rows.map(({ id, platform }) => ({ id, platform }));
}

/**
 * The revenue summary, **one per currency** (KB-12), largest total first.
 *
 * `revenue_records.currency` is a column and there are no exchange rates,
 * so an account paid $12.00 and €5.00 has two totals, two mixes and two
 * RPMs — never 1700 cents of nothing in particular. The arithmetic lives in
 * `createRevenueSummaryFold`, where it is tested without a database. Empty
 * when nothing was recorded in this period or the one before.
 */
export const getRevenueSummaryAction = enhanceAction(
  async function (data): Promise<RevenueSummary[]> {
    const client = getSupabaseServerClient();
    const { accountId, startDate, endDate } = data;

    // Both publish-scoped and channel-scoped revenue, folded in a single
    // pass and streamed so the window never has to be held in memory.
    const fold = createRevenueSummaryFold();

    await forEachAccountRevenueRow(
      client,
      accountId,
      startDate,
      endDate,
      (row) => fold.add(row),
    );

    // RPM denominator is every published video's views in the window, not
    // only the ones that earned — otherwise RPM is inflated by excluding
    // content that produced views but no revenue row.
    const denominatorPublishes = await fetchAccountPublishes(client, accountId);

    let totalViews = 0;
    const pooledPlatforms = new Set<string>();

    if (denominatorPublishes.length > 0) {
      const perVideoTotals = await queryTotalsByVideoIds(
        denominatorPublishes.map(({ id }) => id),
        { startDate, endDate },
      );

      for (const [, stats] of perVideoTotals) {
        totalViews += viewsToAdd(stats.views);
      }

      for (const { id, platform } of denominatorPublishes) {
        if (perVideoTotals.has(id)) pooledPlatforms.add(platform);
      }
    }

    // Trend: the same number of days immediately before, streamed.
    const previousStartDate = new Date(startDate);
    previousStartDate.setDate(
      previousStartDate.getDate() - inclusiveDayCount(startDate, endDate),
    );

    await forEachAccountRevenueRow(
      client,
      accountId,
      previousStartDate.toISOString().split('T')[0]!,
      startDate,
      (row) => fold.addPrevious(row.amount),
      { toExclusive: true },
    );

    return fold.result({
      period: { start: startDate, end: endDate },
      totalViews,
      denominator: recordViewsDenominator({
        platforms: pooledPlatforms,
        window: { from: startDate, to: endDate },
      }),
    });
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
 * `conflict` — an entry for this date, category and currency appeared between this
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
  /**
   * `replaced`: an entry for this scope, date, category and currency already
   * existed and now holds this figure. Said to the user, because "added"
   * over a correction reads as two figures where there is one.
   */
  | { ok: true; replaced: boolean; record: RevenueRecord }
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
        throw new Error(
          whyNoRow(publishError, 'Publish not found or access denied'),
        );
      }

      platform = publish.platform;
    }

    // One value for the lookup and the write, so the two cannot disagree
    // about which currency this entry is in. The schema already upper-cases
    // and defaults it; this is what gets stored.
    const entryCurrency = currency || 'USD';

    // The unique index is on coalesce(publish_id, account_id) and cannot be
    // named as an onConflict target, so replace any existing row explicitly.
    // Scoped to the manual slot, because `source` is part of the unique key
    // now: a synced figure for this date and category lives in its own row
    // and is none of this action's business.
    //
    // And to this currency (KB-23). Currency is in the key too: a €50 and a
    // $100 sponsorship on one day are two figures, and this lookup used to
    // find the euro row and overwrite it with the dollars.
    const existingQuery = client
      .from('revenue_records')
      .select('id')
      .eq('record_date', date)
      .eq('category', category)
      .eq('source', 'manual')
      .eq('currency', entryCurrency);

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
      currency: entryCurrency,
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
      replaced: Boolean(existing),
      record: {
        id: record.id,
        publishId: record.publish_id ?? '',
        platform: record.platform as
          | 'youtube'
          | 'tiktok'
          | 'instagram'
          | 'facebook'
          | 'twitter'
          | 'manual',
        date: record.record_date,
        // A manual row always has a figure (revenue_records_manual_has_amount).
        revenueCents: record.revenue_cents ?? revenueCents,
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
    const { publishId, accountId, date, category, currency } = data;

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

    // Two currencies can share a date and category since KB-23; without
    // this, deleting one entry took the other with it.
    if (currency) {
      visible = visible.eq('currency', currency);
      query = query.eq('currency', currency);
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
const getRevenueProjection = enhanceAction(
  async function (data): Promise<RevenueProjection[]> {
    const client = getSupabaseServerClient();
    const { accountId, asOf } = data;

    // The window ends on the caller's own date (KB-24). A manual entry is
    // dated in the browser's calendar; ending at the server's UTC date left
    // a just-saved entry out of the projection from local midnight until
    // UTC's — 00:00 to 05:30 in India. Calendar arithmetic throughout: the
    // trend split used to be "now minus 15 days" as an instant, so which
    // half a day fell in depended on the hour the server ran.
    const end = callerTodayOr(asOf);

    // One projection per currency (KB-12), streamed in a single pass.
    const fold = createRevenueProjectionFold(addCalendarDays(end, -15));

    await forEachAccountRevenueRow(
      client,
      accountId,
      addCalendarDays(end, -30),
      end,
      (row) => fold.add(row),
    );

    return fold.result();
  },
  {
    auth: true,
    schema: GetRevenueProjectionSchema,
  },
);

export const getRevenueProjectionAction = returnRefusals(getRevenueProjection);

/**
 * Get revenue time series data for charts.
 */
export const getRevenueTimeSeriesAction = enhanceAction(
  async function (data): Promise<RevenueSeries[]> {
    const client = getSupabaseServerClient();
    const { accountId, startDate, endDate } = data;

    // One series per currency (KB-12): two currencies cannot share an axis
    // without a rate. Streamed; the fold zero-fills the range in order,
    // whatever order the rows arrive in.
    const fold = createRevenueSeriesFold();

    await forEachAccountRevenueRow(
      client,
      accountId,
      startDate,
      endDate,
      (row) => fold.add(row),
    );

    return fold.result(startDate, endDate);
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
  async function (data): Promise<TopRevenueContentByCurrency[]> {
    const client = getSupabaseServerClient();
    const { accountId, startDate, endDate, limit } = data;

    // Paged. `limit` is applied after aggregation, so truncation here would
    // not just shorten the list: a publish earning across many dates loses
    // some of them, understating its total and reordering the ranking.
    const records = await fetchAllRows<{
      publish_id: string | null;
      revenue_cents: number | null;
      currency: string | null;
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
        currency,
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
          // Not measured is not revenue (FILM-1726).
          .not('revenue_cents', 'is', null)
          .eq('publishes.episodes.projects.account_id', accountId)
          .order('id')
          .range(from, to),
      'top content by revenue',
    );

    // Aggregate by publish, within a currency (KB-12): a ranking across
    // currencies orders nothing, so each currency ranks its own.
    const fold = createTopContentFold();

    for (const r of records) {
      // Channel-level revenue has no publish to attribute to
      if (!r.publish_id) continue;

      fold.add(
        {
          publishId: r.publish_id,
          episodeId: r.publishes?.episode_id ?? '',
          title: r.publishes?.episodes?.title ?? 'Untitled',
          platform: r.publishes?.platform ?? 'unknown',
          thumbnailUrl: r.publishes?.thumbnail_url ?? undefined,
        },
        { currency: r.currency, cents: r.revenue_cents || 0 },
      );
    }

    // Get views for RPM calculation from ClickHouse
    const publishIds = fold.publishIds();
    const viewsMap = new Map<string, number>();

    if (publishIds.length > 0) {
      const perVideoTotals = await queryTotalsByVideoIds(publishIds, {
        startDate,
        endDate,
      });

      // A Facebook video has no views to divide by: no RPM (KB-153).
      for (const [videoId, stats] of perVideoTotals) {
        if (stats.views !== null) viewsMap.set(videoId, stats.views);
      }
    }

    return fold.result(viewsMap, limit, { from: startDate, to: endDate });
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

    // Get summary data, one per currency
    const summaries = await getRevenueSummaryAction({
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

    // Platform breakdown, each a share of its own currency's total
    const platformBreakdown = summaries.flatMap((summary) =>
      Object.entries(summary.byPlatform).map(([platform, cents]) => ({
        currency: summary.currency,
        platform,
        revenueCents: cents,
        percentOfTotal:
          summary.totalRevenueCents > 0
            ? (cents / summary.totalRevenueCents) * 100
            : 0,
        contentCount: 0, // Could be calculated if needed
      })),
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
        // Stamped so a reader can tell which shape it is looking at: see
        // REVENUE_SUMMARY_SCHEMA_VERSION for what each version means.
        summary_data: JSON.parse(
          JSON.stringify({
            summaries,
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
      summaries,
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

    if (readFailed(publishError)) {
      throw new Error(
        whyNoRow(publishError, 'Publish not found or access denied'),
      );
    }

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
      .select('is_active')
      .eq('id', publish.platform_connection_id)
      .single();

    if (readFailed(connectionError)) {
      throw new Error(
        whyNoRow(connectionError, 'Platform connection not found'),
      );
    }

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
