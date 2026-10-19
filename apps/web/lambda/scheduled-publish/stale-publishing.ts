/**
 * KB-206. A publish left 'publishing' is one whose upload stopped without
 * saying how it ended: the web request that ran it timed out (before KB-206
 * moved Publish Now to the worker), or the worker itself was cut off. Nobody
 * would ever move it on, so the scheduled job fails it once it is older than
 * any upload runs, with a reason that says the post may have gone out.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

import { fetchAllRows } from '@kit/shared/pagination';
import type { Database, Json } from '@kit/supabase/database';

/** Longer than the worker's 15-minute limit, with room to spare */
export const STALE_PUBLISHING_MINUTES = 30;

export const STALE_PUBLISHING_ERROR =
  'Timed out while publishing; check the platform before retrying, in case the post went out.';

interface PublishingRow {
  id: string;
  created_at: string;
  metadata: Json | null;
}

function metadataObject(metadata: Json | null): Record<string, Json> {
  return metadata && typeof metadata === 'object' && !Array.isArray(metadata)
    ? (metadata as Record<string, Json>)
    : {};
}

/** When the row's current attempt began: the worker stamps it, else creation */
export function publishingSince(row: PublishingRow): string {
  const startedAt = metadataObject(row.metadata).publishingStartedAt;

  return typeof startedAt === 'string' ? startedAt : row.created_at;
}

/** Fails every publish stuck in 'publishing'; returns how many it failed */
export async function failStalePublishing(
  supabase: SupabaseClient<Database>,
  now: Date,
): Promise<number> {
  const cutoff = now.getTime() - STALE_PUBLISHING_MINUTES * 60_000;

  const rows = await fetchAllRows<PublishingRow>(
    (from, to) =>
      supabase
        .from('publishes')
        .select('id, created_at, metadata')
        .eq('status', 'publishing')
        .order('id')
        .range(from, to),
    'publishing publishes',
  );

  const stale = rows.filter(
    (row) => new Date(publishingSince(row)).getTime() < cutoff,
  );

  let failed = 0;

  for (const row of stale) {
    const { data, error } = await supabase
      .from('publishes')
      .update({
        status: 'failed',
        metadata: {
          ...metadataObject(row.metadata),
          error: STALE_PUBLISHING_ERROR,
          failedAt: now.toISOString(),
        },
      })
      .eq('id', row.id)
      .eq('status', 'publishing')
      .select('id');

    if (error) {
      console.error(`[Cron] Could not fail stale publish ${row.id}:`, error);
      continue;
    }

    failed += data?.length ?? 0;
  }

  return failed;
}
