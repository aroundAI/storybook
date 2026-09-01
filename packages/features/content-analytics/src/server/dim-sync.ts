import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import { insertVideoDims } from '@kit/clickhouse/server';
import type { VideoDim } from '@kit/clickhouse/server';
import { getLogger } from '@kit/shared/logger';
import { chunkIds, fetchAllByIds, forEachPage } from '@kit/shared/pagination';
import { getSupabaseServerAdminClient } from '@kit/supabase/server-admin-client';

// Use generic SupabaseClient type to avoid strict type checking issues
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = SupabaseClient<any, any, any>;

/**
 * ClickHouse UUID columns are non-nullable, so publishes with no connection
 * (legacy rows, manual uploads) get a zero UUID rather than being dropped
 * from the dimension entirely. It reads as "unattributed" in a channel
 * filter instead of silently vanishing from every metric.
 */
export const UNATTRIBUTED_CONNECTION_ID =
  '00000000-0000-0000-0000-000000000000';

interface PublishDimRow {
  id: string;
  episode_id: string;
  platform: string;
  platform_connection_id: string | null;
  content_type: string | null;
  language: string | null;
  title: string | null;
  published_at: string | null;
  episodes: {
    project_id: string | null;
    duration_seconds: number | null;
    target_duration_seconds: number | null;
    projects: { account_id: string | null } | null;
  } | null;
}

const PUBLISH_DIM_COLUMNS = `
  id,
  episode_id,
  platform,
  platform_connection_id,
  content_type,
  language,
  title,
  published_at,
  episodes!inner(
    project_id,
    duration_seconds,
    target_duration_seconds,
    projects!inner(account_id)
  )
`;

/**
 * Syncs the ClickHouse video_dim dimension table from Postgres.
 *
 * Called for each sync batch (keeps new publishes queryable within the
 * hour), nightly as a full reconcile (publishes has no updated_at column,
 * so drift heals via full upsert — ReplacingMergeTree dedups), and from
 * taxonomy actions after tagging (FILM-1507).
 *
 * Every read here is paged. An unbounded select stops at PostgREST's
 * `max_rows`, and a publish past that boundary would never receive a
 * dimension row — leaving it absent from every ClickHouse aggregate, with
 * each following reconcile reading the same truncated slice and so never
 * repairing it. Ordering by `id` keeps the pages disjoint.
 *
 * Rows are pushed to ClickHouse per page rather than accumulated, so a
 * full reconcile costs the same memory whatever the library size.
 *
 * duration_seconds uses the episode's actual duration, falling back to its
 * target duration when the render has not reported one.
 */
export async function upsertVideoDims(publishIds?: string[]): Promise<number> {
  const logger = await getLogger();
  const client: Client = getSupabaseServerAdminClient();

  const publishedQuery = () =>
    client
      .from('publishes')
      .select(PUBLISH_DIM_COLUMNS)
      .eq('status', 'published')
      .not('published_at', 'is', null)
      .order('id');

  let synced = 0;

  const syncBatch = async (batch: unknown[]) => {
    const rows = await buildVideoDims(client, batch as PublishDimRow[]);

    if (rows.length === 0) return;

    await insertVideoDims(rows);
    synced += rows.length;
  };

  try {
    if (publishIds && publishIds.length > 0) {
      for (const chunk of chunkIds(publishIds)) {
        await forEachPage(
          (from, to) => publishedQuery().in('id', chunk).range(from, to),
          syncBatch,
          'publishes (scoped)',
        );
      }
    } else {
      await forEachPage(
        (from, to) => publishedQuery().range(from, to),
        syncBatch,
        'publishes (reconcile)',
      );
    }
  } catch (error) {
    logger.error(
      {
        name: 'video-dim-sync',
        error: error instanceof Error ? error.message : String(error),
        synced,
      },
      'Failed to load publishes for dim sync',
    );
    return synced;
  }

  logger.info(
    { name: 'video-dim-sync', count: synced, scoped: !!publishIds },
    'Video dims upserted',
  );

  return synced;
}

/** Maps one page of publishes to dimension rows, resolving their tags. */
async function buildVideoDims(
  client: Client,
  batch: PublishDimRow[],
): Promise<VideoDim[]> {
  const tagsByPublish = await fetchPublishTags(
    client,
    batch.map((row) => row.id),
  );

  const rows: VideoDim[] = [];

  for (const row of batch) {
    const projectId = row.episodes?.project_id;
    const accountId = row.episodes?.projects?.account_id;

    if (!projectId || !accountId || !row.published_at) continue;

    rows.push({
      video_id: row.id,
      project_id: projectId,
      account_id: accountId,
      episode_id: row.episode_id,
      connection_id: row.platform_connection_id ?? UNATTRIBUTED_CONNECTION_ID,
      platform: row.platform,
      content_type: row.content_type ?? 'full',
      language: row.language ?? 'en',
      title: row.title ?? '',
      published_at: toClickHouseDateTime(row.published_at),
      duration_seconds:
        row.episodes?.duration_seconds ??
        row.episodes?.target_duration_seconds ??
        0,
      tags: tagsByPublish.get(row.id) ?? [],
    });
  }

  return rows;
}

/**
 * Taxonomy tags per publish as 'dimension:slug' strings. The tables land
 * in FILM-1507 — until then (or on query failure) publishes carry no tags.
 *
 * Paged and chunked: publish_tags holds one row per assignment, so a page
 * of publishes carrying several tags each exceeds the row cap long before
 * the publish count does, and a partial map would write `video_dim.tags`
 * with tags silently missing.
 */
async function fetchPublishTags(
  client: Client,
  publishIds: string[],
): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>();

  if (publishIds.length === 0) return map;

  let data: unknown[];

  try {
    data = await fetchAllByIds(
      publishIds,
      (chunk, from, to) =>
        client
          .from('publish_tags')
          .select('publish_id, content_tags!inner(dimension, slug)')
          .in('publish_id', chunk)
          .order('publish_id')
          .order('tag_id')
          .range(from, to),
      'publish_tags',
    );
  } catch {
    return map;
  }

  for (const row of data as unknown as Array<{
    publish_id: string;
    content_tags: { dimension: string; slug: string } | null;
  }>) {
    if (!row.content_tags) continue;
    const tag = `${row.content_tags.dimension}:${row.content_tags.slug}`;
    const existing = map.get(row.publish_id) ?? [];
    existing.push(tag);
    map.set(row.publish_id, existing);
  }

  return map;
}

/** ClickHouse DateTime wants 'YYYY-MM-DD HH:MM:SS' (UTC). */
function toClickHouseDateTime(iso: string): string {
  return new Date(iso).toISOString().slice(0, 19).replace('T', ' ');
}
