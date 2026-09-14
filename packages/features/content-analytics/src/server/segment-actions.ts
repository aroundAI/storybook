'use server';

import { z } from 'zod';

import type {
  SegmentKind,
  SegmentPerformanceRow,
} from '@kit/clickhouse/server';
import {
  querySegmentMembership,
  querySegmentPerformance,
} from '@kit/clickhouse/server';
import { enhanceAction } from '@kit/next/actions';
import { getLogger } from '@kit/shared/logger';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

import type { MembershipEntry } from '../lib/segment-revenue';
import {
  checkpointWindow,
  createSegmentRevenueFold,
  retainSurvivingSegments,
  revenueFetchWindow,
  segmentRpmCents,
  yearChunks,
} from '../lib/segment-revenue';
import { forEachAccountRevenueRow } from './revenue-queries';
import { assertScopeAccess } from './scope-access';

/**
 * One membership page.
 *
 * Large on purpose. Keyset paging removes the sort-and-discard but not the
 * CTE re-execution, so every extra page is another full pass over the
 * metrics history — a 1,000-row page meant up to 100 passes for a single
 * render. Two large pages cover the same ceiling in at most two.
 */
const MEMBERSHIP_PAGE_SIZE = 50_000;

/**
 * Membership pages read before giving up — 100k rows at the page size
 * above.
 *
 * A tag segment fans a video out per tag, so membership is larger than the
 * video count. An account past this ceiling has a data problem, and an
 * unbounded loop against ClickHouse is not the place to discover it;
 * hitting it suppresses the rate rather than understating it.
 */
const MEMBERSHIP_MAX_PAGES = 2;

const SegmentPerformanceSchema = z
  .object({
    projectId: z.string().uuid().optional(),
    accountId: z.string().uuid().optional(),
    connectionId: z.string().uuid().optional(),
    contentType: z.string().max(50).optional(),
    language: z.string().max(10).optional(),
    kind: z.enum(['tag', 'language', 'content_type', 'connection']),
    /** Tag dimension prefix — meaningful only when `kind` is 'tag'. */
    dimension: z.string().max(50).optional(),
    minVideos: z.number().int().min(1).max(1000).default(5),
    checkpointDays: z.number().int().min(1).max(730).default(30),
    includeRevenue: z.boolean().default(false),
  })
  .refine((input) => input.projectId || input.accountId, {
    message: 'projectId or accountId is required',
  });

export interface SegmentPerformanceEntry extends SegmentPerformanceRow {
  /**
   * Pooled revenue per thousand views. Absent when revenue was not
   * requested, and absent rather than zero when the segment has no views.
   */
  rpmCents?: number | null;
}

/** Why `rpmCents` is absent, when it is. */
export type RevenueStatus =
  | 'included'
  /** The caller did not ask for it. */
  | 'not_requested'
  /** The account has no revenue records at all in the measured window. */
  | 'no_data'
  /** No segment cleared `minVideos`, so there is nothing to rate. */
  | 'no_segments'
  /** Membership paging hit its bound; any rate would be understated. */
  | 'membership_truncated'
  /** The revenue read exceeded the pagination guard. */
  | 'read_failed';

export interface SegmentPerformanceResult {
  rows: SegmentPerformanceEntry[];
  /**
   * Whether the rate is present, and if not, why — so the UI can say
   * "no revenue recorded" rather than silently omitting a column the
   * caller asked for. The same disclosure discipline the two revenue
   * totals below exist for.
   */
  revenueStatus: RevenueStatus;
  /**
   * True whenever `rpmCents` is present. Revenue reaches a segment only
   * through a publish, and only within that video's own checkpoint window
   * — the UI must say so wherever the rate renders.
   */
  attributedRevenueOnly: boolean;
  /**
   * Revenue scoped to an account rather than a publish — income belonging
   * to no video, and so to no segment — **within `measuredWindow` only**.
   *
   * The window is derived from the videos' checkpoint spans, so on an
   * account whose newest publish is months old it ends months ago and
   * recent channel-level sponsorship is outside it. Named for the bound
   * rather than described as the account's channel-level total, which it
   * is not: a figure silently truncated is worse than one that says what
   * it covers.
   */
  channelLevelRevenueCentsInWindow: number;
  /**
   * Revenue on a publish outside the measured set — another project under
   * the same account, a video excluded as immature, or earnings after its
   * checkpoint window closed. Reported rather than dropped so the gap
   * against a total shown elsewhere can be explained.
   */
  unattributedRevenueCents: number;
  /**
   * The span both revenue figures cover, across the measured videos:
   * earliest checkpoint window start, to the exclusive end of the latest.
   * `toExclusive` is named for what it is — rendering it as the last day
   * of a range would overstate the span by one day. Null when no rate was
   * computed.
   */
  measuredWindow: { from: string; toExclusive: string } | null;
}

/**
 * Every video in each segment, as (segment, videoId, views).
 *
 * Paged because this is the one unbounded-by-nature result in the feature:
 * segment cardinality is small, but membership is one row per video per
 * segment it belongs to.
 */
async function collectMembership(input: {
  scope: Parameters<typeof querySegmentMembership>[0]['scope'];
  segment: { kind: SegmentKind; dimension?: string };
  checkpointDays: number;
  asOf: string;
}) {
  const membership = new Map<string, MembershipEntry>();
  let truncated = true;
  let after: { segment: string; videoId: string } | undefined;

  for (let page = 0; page < MEMBERSHIP_MAX_PAGES; page++) {
    const rows = await querySegmentMembership({
      ...input,
      limit: MEMBERSHIP_PAGE_SIZE,
      after,
    });

    const last = rows[rows.length - 1];

    if (last) after = { segment: last.segment, videoId: last.videoId };

    for (const row of rows) {
      const existing = membership.get(row.videoId);

      if (existing) {
        existing.segments.push(row.segment);
        continue;
      }

      membership.set(row.videoId, {
        segments: [row.segment],
        ...checkpointWindow(row.publishedAt, input.checkpointDays),
      });
    }

    if (rows.length < MEMBERSHIP_PAGE_SIZE) {
      truncated = false;
      break;
    }
  }

  // A final page that came back full says nothing about whether more
  // exists — a membership of exactly the page budget would otherwise be
  // reported truncated and have its rate suppressed on a complete read.
  // One row settles it.
  if (truncated && after) {
    const probe = await querySegmentMembership({
      ...input,
      limit: 1,
      after,
    });

    truncated = probe.length > 0;
  }

  return { membership, truncated };
}

/**
 * Per-segment view distribution at a checkpoint age, optionally with a
 * pooled revenue rate.
 *
 * Revenue forces a cross-store composition. `video_metrics.revenue_cents`
 * is written as literal 0 by every ingest path, so a ClickHouse-only RPM
 * would be exactly zero for every segment, forever, with no error. Real
 * revenue lives only in Postgres `revenue_records`, which is why the
 * membership query exists at all.
 *
 * Channel-level revenue rows (`publish_id is null`) belong to a channel,
 * not to any video, so they cannot be attributed to a tag or a language.
 * They are excluded from the rate and returned separately rather than
 * dropped, because silently dropping them understates every segment's RPM
 * against a total the user can see on another screen.
 *
 * The membership pass is skipped entirely when revenue is not requested,
 * so the common render costs one query.
 */
export const getSegmentPerformanceAction = enhanceAction(
  async (input): Promise<SegmentPerformanceResult> => {
    // One of project or account, never both. buildDimConditions ANDs every
    // key it is given, and assertScopeAccess verifies only the project — so
    // a project the caller owns plus any other account id would AND to zero
    // ClickHouse rows and report as an empty result. getMedianByTagAction
    // makes the same choice for the same reason.
    const scope = {
      ...(input.projectId
        ? { projectId: input.projectId }
        : { accountId: input.accountId }),
      connectionId: input.connectionId,
      contentType: input.contentType,
      language: input.language,
    };

    // ClickHouse is outside Postgres RLS, so access is proven here or not
    // at all.
    const scopeAccountId = await assertScopeAccess(scope);

    const segment = { kind: input.kind, dimension: input.dimension };

    // Resolved once and passed to every query. Each call would otherwise
    // evaluate its own `now`, and across a UTC midnight `age_days` shifts
    // mid-pagination — a video crossing into eligibility between pages is
    // then skipped or repeated by the OFFSET, and the rate's numerator
    // covers a video set its denominator does not.
    const asOf = new Date().toISOString().slice(0, 19).replace('T', ' ');

    const withoutRevenue = (revenueStatus: RevenueStatus) => ({
      revenueStatus,
      attributedRevenueOnly: false,
      channelLevelRevenueCentsInWindow: 0,
      unattributedRevenueCents: 0,
      measuredWindow: null,
    });

    const rows = await querySegmentPerformance({
      scope,
      segment,
      minVideos: input.minVideos,
      checkpointDays: input.checkpointDays,
      asOf,
    });

    if (!input.includeRevenue) {
      return { rows, ...withoutRevenue('not_requested') };
    }

    // Revenue *was* asked for, so each absence gets its own reason. Reusing
    // 'no_data' here would have a UI say "no revenue recorded" off a fact
    // the code never checked — the silent substitution revenueStatus
    // exists to stop.
    if (rows.length === 0) {
      return { rows, ...withoutRevenue('no_segments') };
    }

    // projects.account_id is NOT NULL and accountId is required when no
    // project is given, so assertScopeAccess always resolves one. Guarded
    // rather than asserted because the alternative is reading another
    // account's revenue if that ever stops being true.
    if (!scopeAccountId) {
      throw new Error('Scope resolved to no account; cannot read revenue');
    }

    const { membership, truncated } = await collectMembership({
      scope,
      segment,
      checkpointDays: input.checkpointDays,
      asOf,
    });

    // querySegmentPerformance trims segments below minVideos; membership
    // does not, so a trimmed segment's revenue would otherwise be
    // attributed to a key no returned row carries — displayed nowhere and
    // counted in no total, breaking the result's own guarantee that every
    // cent lands in exactly one of three buckets.
    //
    // Narrowing each video's segment list to the surviving set (rather
    // than reconciling per segment afterwards) is what keeps a video in
    // two trimmed tags from being counted as unattributed twice.
    retainSurvivingSegments(membership, new Set(rows.map((r) => r.segment)));

    // A partial membership understates every segment's rate by an unknown
    // amount, and an RPM quietly too low is worse than none: it reads as a
    // finding about the content. Figures without revenue still stand.
    if (truncated) return { rows, ...withoutRevenue('membership_truncated') };

    const window = revenueFetchWindow(membership);

    if (!window) return { rows, ...withoutRevenue('no_data') };

    const fold = createSegmentRevenueFold(membership);
    const client = getSupabaseServerClient();

    // The window is derived from the data, not asked for: it spans every
    // video's own checkpoint window, so each video's revenue is bounded to
    // exactly the days its views were counted over. Streamed, not
    // collected — revenue_records holds a row per publish per day per
    // category.
    let rowsSeen = 0;

    try {
      for (const chunk of yearChunks(window.from, window.toExclusive)) {
        await forEachAccountRevenueRow(
          client,
          scopeAccountId,
          chunk.from,
          chunk.toExclusive,
          (row) => {
            rowsSeen++;
            fold.add(row);
          },
          { toExclusive: true },
        );
      }
    } catch (error) {
      // The window spans the account's whole publish history, so this is
      // the one revenue read whose span is unbounded by construction and
      // the likeliest to trip the 100k pagination guard. Losing the whole
      // response to that would throw away the distribution figures, which
      // are correct and were the point of the request — degrade the way a
      // truncated membership does instead.
      const logger = await getLogger();

      logger.warn(
        { name: 'segment-performance', accountId: scopeAccountId, error },
        'Revenue read failed; returning segment figures without a rate',
      );

      return { rows, ...withoutRevenue('read_failed') };
    }

    // No revenue rows anywhere in the window means the account records no
    // revenue, not that every segment earned nothing. Reporting "$0.00
    // RPM" on each row would state a finding about the content that the
    // data cannot support — the same zero-versus-absent distinction
    // pooledRpmCents itself is built around.
    if (rowsSeen === 0) return { rows, ...withoutRevenue('no_data') };

    const { revenueBySegment, channelLevelCents, unattributedCents } =
      fold.result();

    return {
      rows: rows.map((row) => ({
        ...row,
        rpmCents: segmentRpmCents(
          revenueBySegment,
          row.segment,
          row.totalViews,
        ),
      })),
      revenueStatus: 'included' as const,
      attributedRevenueOnly: true,
      channelLevelRevenueCentsInWindow: channelLevelCents,
      unattributedRevenueCents: unattributedCents,
      measuredWindow: window,
    };
  },
  { schema: SegmentPerformanceSchema, auth: true },
);
