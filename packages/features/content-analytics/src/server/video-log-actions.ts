'use server';

import { z } from 'zod';

import {
  checkpointPredatesIngest,
  queryQualityMetricsForVideos,
  queryVideoViewsAtAge,
} from '@kit/clickhouse/server';
import { enhanceAction } from '@kit/next/actions';
import { fetchAllByIds } from '@kit/shared/pagination';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

import type { MoneyByCurrency } from '../lib/money';
import { createMoneyFold } from '../lib/money';
import { listAccountChannels, listProjectChannels } from './channels';
import { assertScopeAccess } from './scope-access';

/** Default checkpoint ages, matching the workbook's Sheet 1 columns. */
const DEFAULT_CHECKPOINTS = [30, 90, 180, 365];

const VideoLogSchema = z.object({
  projectId: z.string().uuid().optional(),
  accountId: z.string().uuid().optional(),
  connectionId: z.string().uuid().optional(),
  contentType: z.string().max(50).optional(),
  language: z.string().max(10).optional(),
  checkpoints: z
    .array(z.number().int().min(1).max(730))
    .max(6)
    .default(DEFAULT_CHECKPOINTS),
  // Date-only, pinned: the underlying query binds these as DateTime while
  // the quality query binds Date, and a bare z.string() let either format
  // through to whichever bind could not take it.
  publishedFrom: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  publishedTo: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  limit: z.number().int().min(1).max(500).default(200),
  offset: z.number().int().min(0).default(0),
  orderBy: z
    .enum(['published_at', 'lifetime_views', 'title'])
    .default('published_at'),
  orderDirection: z.enum(['asc', 'desc']).default('desc'),
});

/**
 * A channel is a filter, not a scope: the underlying query refuses an
 * unscoped read to prevent full-table scans, so one of project or account
 * must be present before the channel narrows it.
 */
const ScopedVideoLogSchema = VideoLogSchema.refine(
  (input) => input.projectId || input.accountId,
  { message: 'projectId or accountId is required' },
);

/** One row of the Video Log — the workbook's Sheet 1. */
export interface VideoLogRow {
  videoId: string;
  title: string;
  publishedAt: string;
  channelName: string;
  platform: string;
  contentType: string;
  /** Null when nobody set one — never a defaulted code (FILM-1702). */
  language: string | null;
  /** Null on a platform with no single view (Facebook, KB-153). */
  viewsAtAge: Record<number, number | null>;
  /** Whether each checkpoint has elapsed. False means "not yet knowable". */
  matureAt: Record<number, boolean>;
  /**
   * Checkpoints whose entire window closed before ingest began. Those
   * figures contain no data from their own window and should not be shown
   * as though they did.
   */
  predatesIngestAt: Record<number, boolean>;
  lifetimeViews: number | null;
  ingestLagDays: number | null;
  impressions: number;
  ctr: number;
  /** Null when the platform does not measure it (KB-111). */
  avgViewDurationSeconds: number | null;
  avgViewPercentage: number | null;
  /**
   * Lifetime revenue per currency, largest first (FILM-1615). Never one
   * summed figure: revenue can be recorded in any currency, and adding
   * dollars to euros produces a number that is neither (EDD F-2). Empty when
   * nothing is recorded. `currency` is null only for a row written without
   * one. The same `MoneyByCurrency` every other revenue total now is
   * (KB-12) — this was the first of them.
   */
  revenue: MoneyByCurrency;
  /**
   * The video's analytics note (FILM-1610), from Postgres. Never synced to
   * ClickHouse: free text does not belong in a store that cannot delete it.
   */
  analyticsNote: string | null;
  /**
   * When the note last changed, exactly as Postgres returned it. The note
   * editor sends it back so a save can tell whether someone else changed
   * the note in between (FILM-1615) — passed through untouched, because a
   * `Date` would drop the microseconds and every save would look stale.
   */
  analyticsNoteUpdatedAt: string | null;
  /**
   * Whether the caller may write this video's note: the `publishes_update`
   * rule, an owner, admin or member of its project. A note is readable more
   * widely than it is writable, so the table (FILM-1615) needs to know which.
   */
  canEditNote: boolean;
}

/**
 * The per-video Video Log.
 *
 * Sheet 1 of the workbook, and the sheet the rest of it derives from: views
 * at fixed ages, so videos published months apart can be compared at all,
 * with the quality columns alongside.
 *
 * Two fields exist to stop the numbers being read as more solid than they
 * are. `matureAt` separates "zero views" from "not yet knowable" for a
 * video younger than the checkpoint. `predatesIngestAt` marks a checkpoint
 * whose window closed before any metric was ingested for that channel —
 * unrecoverable, since the Reporting API backfills only ~30 days from job
 * creation.
 */
export const getVideoLogAction = enhanceAction(
  async (input): Promise<VideoLogRow[]> => {
    const { checkpoints, limit, offset, orderBy, orderDirection } = input;

    const scope = {
      projectId: input.projectId,
      accountId: input.accountId,
      connectionId: input.connectionId,
      contentType: input.contentType,
      language: input.language,
    };

    await assertScopeAccess(scope);

    const rows = await queryVideoViewsAtAge({
      scope,
      checkpoints,
      publishedFrom: input.publishedFrom,
      publishedTo: input.publishedTo,
      limit,
      offset,
      orderBy,
      orderDirection,
    });

    if (rows.length === 0) return [];

    const videoIds = rows.map((row) => row.videoId);
    const client = getSupabaseServerClient();

    // The id list is one page wide, so these stay well inside the limits
    // that made FILM-1612 necessary — but revenue is one row per publish
    // per day per category, so it is still chunked and paged.
    const [quality, channels, revenueByPublish, notesByPublish] =
      await Promise.all([
        // Lifetime, deliberately unbounded by the publish-date filter.
        // publishedFrom/To select *which videos* appear; passing them here
        // would have bounded *which metric days* count, so a row would carry
        // lifetime views next to CTR and view duration measured over only the
        // slice of the window that video happened to overlap — two different
        // windows in one row, with nothing saying so. A bounded quality
        // window would need its own explicitly named inputs.
        queryQualityMetricsForVideos({
          videoIds,
          // The rows above came from this project, so bounding the read to
          // it changes nothing about what comes back and stops the scan
          // covering every other tenant's metrics. Omitted for an
          // account-wide scope, which has no single project to name.
          ...(input.projectId ? { projectIds: [input.projectId] } : {}),
        }),
        input.projectId
          ? listProjectChannels(input.projectId, client)
          : listAccountChannels(input.accountId!, client),
        fetchRevenueByPublish(client, videoIds),
        fetchNotesByPublish(client, videoIds),
      ]);

    const channelNameById = new Map(
      channels.map((channel) => [channel.connectionId, channel.name]),
    );

    return rows.map((row) => {
      const metrics = quality.get(row.videoId);

      const predatesIngestAt: Record<number, boolean> = {};
      for (const days of checkpoints) {
        predatesIngestAt[days] = checkpointPredatesIngest(
          row.ingestLagDays,
          days,
        );
      }

      return {
        videoId: row.videoId,
        title: row.title,
        publishedAt: row.publishedAt,
        channelName: channelNameById.get(row.connectionId) ?? 'Unattributed',
        platform: row.platform,
        contentType: row.contentType,
        language: row.language,
        viewsAtAge: row.viewsAtAge,
        matureAt: row.matureAt,
        predatesIngestAt,
        lifetimeViews: row.lifetimeViews,
        ingestLagDays: row.ingestLagDays,
        impressions: metrics?.impressions ?? 0,
        ctr: metrics?.impressionsCtr ?? 0,
        avgViewDurationSeconds: metrics?.avgViewDurationSeconds ?? null,
        avgViewPercentage: metrics?.avgViewPercentage ?? null,
        revenue: revenueByPublish.get(row.videoId) ?? [],
        analyticsNote: notesByPublish.get(row.videoId)?.note ?? null,
        analyticsNoteUpdatedAt:
          notesByPublish.get(row.videoId)?.updatedAt ?? null,
        canEditNote: notesByPublish.get(row.videoId)?.canEdit ?? false,
      };
    });
  },
  { schema: ScopedVideoLogSchema, auth: true },
);

/**
 * Lifetime revenue per publish, per currency, in cents.
 *
 * Publish-scoped only: channel-level revenue has no video to attribute to,
 * and spreading it across the log would invent per-video figures. Grouped
 * by currency rather than summed (EDD F-2): there are no exchange rates to
 * convert with, and a sum across currencies is not an amount of anything.
 *
 * Summed in the database, which is not a micro-optimisation. Revenue is a
 * row per publish per day per category, so a page of 100 videos with a
 * year of daily revenue is 36,500 rows — and read a page at a time through
 * PostgREST that measured **98.5 seconds** for one page of the log. The
 * same rows group in ~1.1s inside Postgres and come back as ~200. The
 * function runs as the caller, so `revenue_records` RLS still decides
 * which rows are in each sum.
 */
async function fetchRevenueByPublish(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client: any,
  publishIds: string[],
): Promise<Map<string, MoneyByCurrency>> {
  const rows = await fetchAllByIds<{
    publish_id: string | null;
    currency: string | null;
    cents: number | null;
  }>(
    publishIds,
    (chunk, from, to) =>
      client
        .rpc('revenue_cents_by_publish', { p_publish_ids: chunk })
        .select('publish_id, currency, cents')
        // (publish_id, currency) is the group key, so it is unique here —
        // which is what range paging needs to neither skip nor repeat.
        .order('publish_id')
        .order('currency')
        .range(from, to),
    'video log revenue',
  );

  const byPublish = new Map<string, ReturnType<typeof createMoneyFold>>();

  for (const row of rows) {
    if (!row.publish_id) continue;

    const fold = byPublish.get(row.publish_id) ?? createMoneyFold();

    // Already one row per currency; the fold keeps the total correct if a
    // publish were ever split across chunks, and is the one every other
    // revenue total uses (lib/money.ts).
    fold.add({ currency: row.currency, cents: row.cents ?? 0 });
    byPublish.set(row.publish_id, fold);
  }

  return new Map(
    [...byPublish].map(([publishId, fold]) => [publishId, fold.result()]),
  );
}

/**
 * Each video's analytics note, and whether the caller may edit it, for one
 * page of videos. One row per publish, bounded by the page, but read through
 * the same chunked pager as revenue so a raised page size cannot outgrow it.
 *
 * Editability is the database's answer (`editable_publish_ids`), not a role
 * list restated here: the function carries the `publishes_update` rule, and
 * experiments-integrity.test.sql checks the two agree for every kind of user.
 */
async function fetchNotesByPublish(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client: any,
  publishIds: string[],
): Promise<
  Map<
    string,
    { note: string | null; updatedAt: string | null; canEdit: boolean }
  >
> {
  const [rows, editable] = await Promise.all([
    fetchAllByIds<{
      id: string;
      analytics_note: string | null;
      analytics_note_updated_at: string | null;
    }>(
      publishIds,
      (chunk, from, to) =>
        client
          .from('publishes')
          .select('id, analytics_note, analytics_note_updated_at')
          .in('id', chunk)
          .order('id')
          .range(from, to),
      'video log notes',
    ),
    client.rpc('editable_publish_ids', { p_publish_ids: publishIds }),
  ]);

  if (editable.error) {
    throw new Error(
      `Failed to read note permissions: ${editable.error.message}`,
    );
  }

  const editableIds = new Set<string>(editable.data ?? []);

  return new Map(
    rows.map((row) => [
      row.id,
      {
        note: row.analytics_note,
        updatedAt: row.analytics_note_updated_at,
        canEdit: editableIds.has(row.id),
      },
    ]),
  );
}
