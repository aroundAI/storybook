import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import { insertVideoMetrics } from '@kit/clickhouse/server';
import { getLogger } from '@kit/shared/logger';
import { getSupabaseServerAdminClient } from '@kit/supabase/server-admin-client';

import { createYouTubeAnalyticsProvider } from '../../providers/youtube';
import type { YouTubeDailyMetrics } from '../../providers/youtube/types';
import { buildYouTubeDailyRows, latestDataDate } from '../ingest';
import type { PublishMetadata } from '../types';

/**
 * One Analytics API day-dimension query covers at most this many days —
 * long ranges are chunked so responses stay under the API's row limits.
 */
const CHUNK_DAYS = 180;

const DEFAULT_MAX_VIDEOS = 50;
const DEFAULT_MAX_QUERIES = 150;

// Use generic SupabaseClient type to avoid strict type checking issues
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = SupabaseClient<any, any, any>;

export interface BackfillBatchResult {
  processed: number;
  succeeded: number;
  failed: number;
  queriesUsed: number;
  /** Publishes still awaiting backfill after this batch. */
  remaining: number;
  dryRun: boolean;
  errors: Array<{ publishId: string; error: string }>;
}

interface BackfillPublish {
  id: string;
  episode_id: string;
  platform_connection_id: string;
  platform_content_id: string;
  published_at: string;
  metadata: PublishMetadata | null;
}

/**
 * Re-populates per-day YouTube history after the FILM-1501 wipe.
 *
 * For each published YouTube video whose backfill has not completed, runs
 * day-dimension Analytics API queries over [published_at, today] (chunked)
 * and inserts rows tagged metric_source 'backfill'. Quota-capped and
 * resumable: repeated invocations drain the queue over days.
 */
export async function runYouTubeBackfillBatch(options?: {
  maxVideos?: number;
  maxQueries?: number;
  dryRun?: boolean;
}): Promise<BackfillBatchResult> {
  const logger = await getLogger();
  const ctx = { name: 'youtube-backfill' };

  const maxVideos = options?.maxVideos ?? DEFAULT_MAX_VIDEOS;
  const maxQueries = options?.maxQueries ?? DEFAULT_MAX_QUERIES;
  const dryRun = options?.dryRun ?? false;

  const client = getSupabaseServerAdminClient();

  const result: BackfillBatchResult = {
    processed: 0,
    succeeded: 0,
    failed: 0,
    queriesUsed: 0,
    remaining: 0,
    dryRun,
    errors: [],
  };

  // Count first, then read only the batch this run will process. The count
  // is what `remaining` reports; the read is the work set.
  result.remaining = await countPendingPublishes(client);

  if (result.remaining === 0) {
    logger.info(ctx, 'YouTube backfill complete — nothing pending');
    return result;
  }

  const pending = await fetchPendingPublishes(client, maxVideos);

  // Dimension rows must exist before backfilled metrics are queryable
  if (!dryRun) {
    const { upsertVideoDims } = await import('../dim-sync');
    await upsertVideoDims();
  }

  const { ensureValidToken } = await import('@kit/publishing/token-refresh');

  for (const publish of pending) {
    if (result.processed >= maxVideos || result.queriesUsed >= maxQueries) {
      break;
    }

    const chunks = buildDateChunks(new Date(publish.published_at), new Date());

    if (result.queriesUsed + chunks.length > maxQueries) {
      break;
    }

    if (dryRun) {
      logger.info(
        {
          ...ctx,
          publishId: publish.id,
          publishedAt: publish.published_at,
          plannedQueries: chunks.length,
        },
        'Dry run: would backfill publish',
      );
      result.processed++;
      result.queriesUsed += chunks.length;
      continue;
    }

    result.processed++;

    try {
      const tokenResult = await ensureValidToken(
        publish.platform_connection_id,
      );

      if (!tokenResult.valid || !tokenResult.accessToken) {
        throw new Error(tokenResult.error ?? 'Token validation failed');
      }

      const projectId = await resolveProjectId(client, publish.episode_id);

      if (!projectId) {
        throw new Error('Could not resolve project_id');
      }

      const provider = createYouTubeAnalyticsProvider(tokenResult.accessToken);
      const allDays: YouTubeDailyMetrics[] = [];

      for (const chunk of chunks) {
        const days = await provider.getDailyMetrics(
          publish.platform_content_id,
          chunk.start,
          chunk.end,
        );
        allDays.push(...days);
        result.queriesUsed++;
      }

      const rows = buildYouTubeDailyRows({
        projectId,
        videoId: publish.id,
        dailyData: allDays,
        metricSource: 'backfill',
      });

      await insertVideoMetrics(rows);

      await markBackfillComplete(
        client,
        publish,
        latestDataDate(allDays) ?? undefined,
      );

      result.succeeded++;
      result.remaining--;

      logger.info(
        { ...ctx, publishId: publish.id, days: rows.length },
        'Backfilled publish',
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      result.failed++;
      result.errors.push({ publishId: publish.id, error: message });
      logger.error(
        { ...ctx, publishId: publish.id, error: message },
        'Backfill failed for publish',
      );
    }
  }

  logger.info({ ...ctx, ...result, errors: undefined }, 'Backfill batch done');

  return result;
}

const PENDING_COLUMNS =
  'id, episode_id, platform_connection_id, platform_content_id, published_at, metadata';

/**
 * The predicate defining "pending backfill", shared by the count and the
 * read so the progress figure can never drift from the work set.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function pendingFilters(query: any) {
  return query
    .eq('status', 'published')
    .eq('platform', 'youtube')
    .not('platform_content_id', 'is', null)
    .not('platform_connection_id', 'is', null)
    .is('metadata->sync->>backfill_completed_at', null);
}

/**
 * How many publishes are still awaiting backfill.
 *
 * An exact head count is not subject to the row cap, so this needs no
 * pagination — and it is the only thing the full backlog was ever read for.
 */
async function countPendingPublishes(client: Client): Promise<number> {
  const { count, error } = await pendingFilters(
    client.from('publishes').select('id', { count: 'exact', head: true }),
  );

  if (error) {
    throw new Error(`Pending backfill count failed: ${error.message}`);
  }

  return count ?? 0;
}

/**
 * Published YouTube videos that have not completed backfill, oldest first
 * so the back-catalog series completes from the beginning.
 *
 * Bounded by `limit`, which is the batch size the caller will actually
 * process — previously this drained the entire backlog to hand back a list
 * the caller broke out of after 50 rows, so everything past the batch was
 * fetched, deserialized and discarded. Past the pagination guard it would
 * have thrown on every invocation and stalled the backfill for good.
 *
 * `.limit()` is safe here, unlike the reads this sweep replaced, precisely
 * because the batch size is far below the server's 1,000-row cap: the cap
 * cannot silently truncate a request for 50 rows.
 *
 * Deliberately not wrapped in a try/catch — returning [] on failure is
 * indistinguishable from an empty backlog, and the caller treats that as
 * "nothing pending" and does no work.
 */
async function fetchPendingPublishes(
  client: Client,
  limit: number,
): Promise<BackfillPublish[]> {
  const { data, error } = await pendingFilters(
    client.from('publishes').select(PENDING_COLUMNS),
  )
    .order('published_at', { ascending: true })
    .order('id')
    .limit(limit);

  if (error) {
    throw new Error(`Pending backfill read failed: ${error.message}`);
  }

  return ((data ?? []) as BackfillPublish[]).filter((row) => row.published_at);
}

function buildDateChunks(
  start: Date,
  end: Date,
): Array<{ start: Date; end: Date }> {
  const chunks: Array<{ start: Date; end: Date }> = [];
  const chunkMs = CHUNK_DAYS * 24 * 60 * 60 * 1000;

  let cursor = start;

  while (cursor < end) {
    const chunkEnd = new Date(
      Math.min(cursor.getTime() + chunkMs, end.getTime()),
    );
    chunks.push({ start: cursor, end: chunkEnd });
    cursor = new Date(chunkEnd.getTime() + 24 * 60 * 60 * 1000);
  }

  return chunks.length > 0 ? chunks : [{ start, end }];
}

async function markBackfillComplete(
  client: Client,
  publish: BackfillPublish,
  lastDataDate: string | undefined,
): Promise<void> {
  const currentMetadata = publish.metadata ?? {};

  const { error } = await client
    .from('publishes')
    .update({
      metadata: {
        ...currentMetadata,
        sync: {
          ...currentMetadata.sync,
          backfill_completed_at: new Date().toISOString(),
          ...(lastDataDate ? { last_data_date: lastDataDate } : {}),
        },
      },
    })
    .eq('id', publish.id);

  if (error) {
    throw new Error(`Failed to mark backfill complete: ${error.message}`);
  }
}

async function resolveProjectId(
  client: Client,
  episodeId: string,
): Promise<string | null> {
  const { data, error } = await client
    .from('episodes')
    .select('project_id')
    .eq('id', episodeId)
    .single();

  if (error || !data?.project_id) {
    return null;
  }

  return data.project_id;
}
