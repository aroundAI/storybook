import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import { insertVideoDims } from '@kit/clickhouse/server';
import type { VideoDim } from '@kit/clickhouse/server';
import { getLogger } from '@kit/shared/logger';
import { getSupabaseServerAdminClient } from '@kit/supabase/server-admin-client';

// Use generic SupabaseClient type to avoid strict type checking issues
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = SupabaseClient<any, any, any>;

interface PublishDimRow {
  id: string;
  episode_id: string;
  platform: string;
  content_type: string | null;
  language: string | null;
  title: string | null;
  published_at: string | null;
  episodes: {
    project_id: string | null;
    target_duration_seconds: number | null;
    projects: { account_id: string | null } | null;
  } | null;
}

/**
 * Syncs the ClickHouse video_dim dimension table from Postgres.
 *
 * Called for each sync batch (keeps new publishes queryable within the
 * hour), nightly as a full reconcile (publishes has no updated_at column,
 * so drift heals via full upsert — ReplacingMergeTree dedups), and from
 * taxonomy actions after tagging (FILM-1507).
 *
 * duration_seconds is seeded from the episode's target duration; consumers
 * needing exact durations (Hook Lab retention interpolation) refine it via
 * the platform's video info API.
 */
export async function upsertVideoDims(publishIds?: string[]): Promise<number> {
  const logger = await getLogger();
  const client: Client = getSupabaseServerAdminClient();

  let query = client
    .from('publishes')
    .select(
      `
      id,
      episode_id,
      platform,
      content_type,
      language,
      title,
      published_at,
      episodes!inner(
        project_id,
        target_duration_seconds,
        projects!inner(account_id)
      )
    `,
    )
    .eq('status', 'published')
    .not('published_at', 'is', null);

  if (publishIds && publishIds.length > 0) {
    query = query.in('id', publishIds);
  }

  const { data, error } = await query;

  if (error) {
    logger.error(
      { name: 'video-dim-sync', error: error.message },
      'Failed to load publishes for dim sync',
    );
    return 0;
  }

  const tagsByPublish = await fetchPublishTags(
    client,
    (data ?? []).map((row) => row.id),
  );

  const rows: VideoDim[] = [];

  for (const row of (data ?? []) as unknown as PublishDimRow[]) {
    const projectId = row.episodes?.project_id;
    const accountId = row.episodes?.projects?.account_id;

    if (!projectId || !accountId || !row.published_at) continue;

    rows.push({
      video_id: row.id,
      project_id: projectId,
      account_id: accountId,
      episode_id: row.episode_id,
      platform: row.platform,
      content_type: row.content_type ?? 'full',
      language: row.language ?? 'en',
      title: row.title ?? '',
      published_at: toClickHouseDateTime(row.published_at),
      duration_seconds: row.episodes?.target_duration_seconds ?? 0,
      tags: tagsByPublish.get(row.id) ?? [],
    });
  }

  await insertVideoDims(rows);

  logger.info(
    { name: 'video-dim-sync', count: rows.length, scoped: !!publishIds },
    'Video dims upserted',
  );

  return rows.length;
}

/**
 * Taxonomy tags per publish as 'dimension:slug' strings. The tables land
 * in FILM-1507 — until then (or on query failure) publishes carry no tags.
 */
async function fetchPublishTags(
  client: Client,
  publishIds: string[],
): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>();

  if (publishIds.length === 0) return map;

  const { data, error } = await client
    .from('publish_tags')
    .select('publish_id, content_tags!inner(dimension, slug)')
    .in('publish_id', publishIds);

  if (error || !data) return map;

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
