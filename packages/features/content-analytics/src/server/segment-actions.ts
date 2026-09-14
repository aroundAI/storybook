'use server';

import { z } from 'zod';

import type {
  SegmentKind,
  SegmentPerformanceRow,
} from '@kit/clickhouse/server';
import {
  pooledRpmCents,
  querySegmentMembership,
  querySegmentPerformance,
} from '@kit/clickhouse/server';
import { enhanceAction } from '@kit/next/actions';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

import type { MembershipEntry } from '../lib/segment-revenue';
import {
  checkpointWindow,
  createSegmentRevenueFold,
} from '../lib/segment-revenue';
import { forEachAccountRevenueRow } from './revenue-queries';
import { assertScopeAccess } from './scope-access';

/** One membership page. The query clamps to this too. */
const MEMBERSHIP_PAGE_SIZE = 1000;

/**
 * Membership pages read before giving up.
 *
 * A tag segment fans a video out per tag, so membership is larger than the
 * video count — but an account that reaches a million rows here has a data
 * problem, and an unbounded loop against ClickHouse is not the place to
 * discover it.
 */
const MEMBERSHIP_MAX_PAGES = 100;

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

export interface SegmentPerformanceResult {
  rows: SegmentPerformanceEntry[];
  /**
   * True whenever `rpmCents` is present. Revenue reaches a segment only
   * through a publish, and only within that video's own checkpoint window
   * — the UI must say so wherever the rate renders.
   */
  attributedRevenueOnly: boolean;
  /**
   * Revenue scoped to an account rather than a publish: real income
   * belonging to no video, and so to no segment.
   */
  channelLevelRevenueCents: number;
  /**
   * Revenue on a publish outside the measured set — another project under
   * the same account, a video excluded as immature, or earnings after its
   * checkpoint window closed. Reported rather than dropped so the gap
   * against a total shown elsewhere can be explained.
   */
  unattributedRevenueCents: number;
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

  for (let page = 0; page < MEMBERSHIP_MAX_PAGES; page++) {
    const rows = await querySegmentMembership({
      ...input,
      limit: MEMBERSHIP_PAGE_SIZE,
      offset: page * MEMBERSHIP_PAGE_SIZE,
    });

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

  return { membership, truncated };
}

/** Earliest and latest day any video checkpoint window touches. */
function revenueFetchWindow(membership: Map<string, MembershipEntry>) {
  let from: string | undefined;
  let to: string | undefined;

  for (const entry of membership.values()) {
    if (!from || entry.windowStart < from) from = entry.windowStart;
    if (!to || entry.windowEnd > to) to = entry.windowEnd;
  }

  return from && to ? { from, to } : null;
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
    const scope = {
      projectId: input.projectId,
      accountId: input.accountId,
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

    const empty = {
      attributedRevenueOnly: false,
      channelLevelRevenueCents: 0,
      unattributedRevenueCents: 0,
    };

    const rows = await querySegmentPerformance({
      scope,
      segment,
      minVideos: input.minVideos,
      checkpointDays: input.checkpointDays,
      asOf,
    });

    if (!input.includeRevenue || rows.length === 0 || !scopeAccountId) {
      return { rows, ...empty };
    }

    const { membership, truncated } = await collectMembership({
      scope,
      segment,
      checkpointDays: input.checkpointDays,
      asOf,
    });

    // A partial membership understates every segment's rate by an unknown
    // amount, and an RPM quietly too low is worse than none: it reads as a
    // finding about the content. Figures without revenue still stand.
    if (truncated) return { rows, ...empty };

    const window = revenueFetchWindow(membership);

    if (!window) return { rows, ...empty };

    const fold = createSegmentRevenueFold(membership);
    const client = getSupabaseServerClient();

    // The window is derived from the data, not asked for: it spans every
    // video's own checkpoint window, so each video's revenue is bounded to
    // exactly the days its views were counted over. Streamed, not
    // collected — revenue_records holds a row per publish per day per
    // category.
    await forEachAccountRevenueRow(
      client,
      scopeAccountId,
      window.from,
      window.to,
      (row) => fold.add(row),
      { toExclusive: true },
    );

    const { revenueBySegment, channelLevelCents, unattributedCents } =
      fold.result();

    return {
      rows: rows.map((row) => ({
        ...row,
        rpmCents: pooledRpmCents(
          revenueBySegment.get(row.segment) ?? 0,
          row.totalViews,
        ),
      })),
      attributedRevenueOnly: true,
      channelLevelRevenueCents: channelLevelCents,
      unattributedRevenueCents: unattributedCents,
    };
  },
  { schema: SegmentPerformanceSchema, auth: true },
);
