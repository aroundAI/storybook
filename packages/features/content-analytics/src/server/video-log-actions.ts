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
  language: string;
  viewsAtAge: Record<number, number>;
  /** Whether each checkpoint has elapsed. False means "not yet knowable". */
  matureAt: Record<number, boolean>;
  /**
   * Checkpoints whose entire window closed before ingest began. Those
   * figures contain no data from their own window and should not be shown
   * as though they did.
   */
  predatesIngestAt: Record<number, boolean>;
  lifetimeViews: number;
  ingestLagDays: number | null;
  impressions: number;
  ctr: number;
  avgViewDurationSeconds: number;
  avgViewPercentage: number;
  revenueCents: number;
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
    const [quality, channels, revenueByPublish] = await Promise.all([
      // Lifetime, deliberately unbounded by the publish-date filter.
      // publishedFrom/To select *which videos* appear; passing them here
      // would have bounded *which metric days* count, so a row would carry
      // lifetime views next to CTR and view duration measured over only the
      // slice of the window that video happened to overlap — two different
      // windows in one row, with nothing saying so. A bounded quality
      // window would need its own explicitly named inputs.
      queryQualityMetricsForVideos({ videoIds }),
      input.projectId
        ? listProjectChannels(input.projectId, client)
        : listAccountChannels(input.accountId!, client),
      fetchRevenueByPublish(client, videoIds),
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
        avgViewDurationSeconds: metrics?.avgViewDurationSeconds ?? 0,
        avgViewPercentage: metrics?.avgViewPercentage ?? 0,
        revenueCents: revenueByPublish.get(row.videoId) ?? 0,
      };
    });
  },
  { schema: ScopedVideoLogSchema, auth: true },
);

/**
 * Lifetime revenue per publish, in cents.
 *
 * Publish-scoped only: channel-level revenue has no video to attribute to,
 * and spreading it across the log would invent per-video figures.
 */
async function fetchRevenueByPublish(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client: any,
  publishIds: string[],
): Promise<Map<string, number>> {
  const rows = await fetchAllByIds<{
    publish_id: string | null;
    revenue_cents: number | null;
  }>(
    publishIds,
    (chunk, from, to) =>
      client
        .from('revenue_records')
        .select('publish_id, revenue_cents')
        .in('publish_id', chunk)
        .order('id')
        .range(from, to),
    'video log revenue',
  );

  const byPublish = new Map<string, number>();

  for (const row of rows) {
    if (!row.publish_id) continue;
    byPublish.set(
      row.publish_id,
      (byPublish.get(row.publish_id) ?? 0) + (row.revenue_cents ?? 0),
    );
  }

  return byPublish;
}
