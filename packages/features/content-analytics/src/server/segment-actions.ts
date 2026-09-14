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

import { createSegmentRevenueFold } from '../lib/segment-revenue';
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
    revenueFrom: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    revenueTo: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
  })
  .refine((input) => input.projectId || input.accountId, {
    message: 'projectId or accountId is required',
  })
  .refine(
    (input) => !input.includeRevenue || (input.revenueFrom && input.revenueTo),
    {
      message: 'revenueFrom and revenueTo are required when including revenue',
    },
  );

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
   * True whenever `rpmCents` is present. Revenue can only be attributed to
   * a segment through a publish, so channel-level rows are never in it —
   * the UI must say so wherever the rate renders.
   */
  attributedRevenueOnly: boolean;
  /**
   * Channel-level revenue in the same window: real income that belongs to
   * no segment. Surfaced so the gap against a total the user can see
   * elsewhere is stated rather than discovered.
   */
  excludedRevenueCents: number;
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
}) {
  const segmentsByVideo = new Map<string, string[]>();

  for (let page = 0; page < MEMBERSHIP_MAX_PAGES; page++) {
    const rows = await querySegmentMembership({
      ...input,
      limit: MEMBERSHIP_PAGE_SIZE,
      offset: page * MEMBERSHIP_PAGE_SIZE,
    });

    for (const row of rows) {
      const existing = segmentsByVideo.get(row.videoId);

      if (existing) {
        existing.push(row.segment);
      } else {
        segmentsByVideo.set(row.videoId, [row.segment]);
      }
    }

    if (rows.length < MEMBERSHIP_PAGE_SIZE) break;
  }

  return segmentsByVideo;
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

    const rows = await querySegmentPerformance({
      scope,
      segment,
      minVideos: input.minVideos,
      checkpointDays: input.checkpointDays,
    });

    if (!input.includeRevenue || rows.length === 0 || !scopeAccountId) {
      return { rows, attributedRevenueOnly: false, excludedRevenueCents: 0 };
    }

    const segmentsByVideo = await collectMembership({
      scope,
      segment,
      checkpointDays: input.checkpointDays,
    });

    const fold = createSegmentRevenueFold(segmentsByVideo);
    const client = getSupabaseServerClient();

    // Streamed, not collected: revenue_records holds a row per publish per
    // day per category, so a yearly window on a busy account reaches six
    // figures.
    await forEachAccountRevenueRow(
      client,
      scopeAccountId,
      input.revenueFrom!,
      input.revenueTo!,
      (row) => fold.add(row),
    );

    const { revenueBySegment, excludedRevenueCents } = fold.result();

    return {
      rows: rows.map((row) => ({
        ...row,
        rpmCents: pooledRpmCents(
          revenueBySegment.get(row.segment) ?? 0,
          row.totalViews,
        ),
      })),
      attributedRevenueOnly: true,
      excludedRevenueCents,
    };
  },
  { schema: SegmentPerformanceSchema, auth: true },
);
