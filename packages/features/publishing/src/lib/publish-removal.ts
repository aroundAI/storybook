/**
 * A published video taken down on its platform (KB-207).
 *
 * StoryBook does not hear when a video is deleted on YouTube or Facebook,
 * so its row stayed `published`: it kept its channel's cadence slot and the
 * reports kept reading it. A row is marked `deleted`, with when and why in
 * `metadata.removedAt` / `metadata.removedReason`, by the hourly analytics
 * sync when the platform answers that the video does not exist, or by hand
 * from the Schedule tab or MCP `mark_publish_removed`.
 *
 * Only a `published` row moves, so a row that changed meanwhile is left as
 * it is. No `server-only` import: the analytics sync and the web actions
 * both write through it.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database, Json } from '@kit/supabase/database';

import { PLATFORM_NAMES, isPlatform } from './platforms';
import { canTakeDown, projectRoleOf } from './takedown';

type Client = SupabaseClient<Database>;

type Result<T> = { ok: true; data: T } | { ok: false; refusal: string };

export const MARK_REMOVED_REFUSAL =
  'Only project owners and admins can mark a video as removed.';

export const REMOVED_BY_HAND = 'marked as removed in StoryBook';

/** `removedReason` for a video the platform says does not exist */
export function notFoundOn(platform: string): string {
  return `not found on ${isPlatform(platform) ? PLATFORM_NAMES[platform] : platform}`;
}

/**
 * Marks one `published` row `deleted`. False when the row is not
 * `published` (any more), so nothing changed.
 */
export async function recordPublishRemoved(
  client: Client,
  publishId: string,
  reason: string,
  at = new Date(),
): Promise<boolean> {
  const { data: row, error } = await client
    .from('publishes')
    .select('status, metadata')
    .eq('id', publishId)
    .maybeSingle();

  if (error) {
    throw new Error(`Could not read the publish: ${error.message}`);
  }

  if (row?.status !== 'published') return false;

  const metadata = (
    row.metadata &&
    typeof row.metadata === 'object' &&
    !Array.isArray(row.metadata)
      ? row.metadata
      : {}
  ) as Record<string, Json>;

  const { data: updated, error: updateError } = await client
    .from('publishes')
    .update({
      status: 'deleted',
      metadata: {
        ...metadata,
        removedAt: at.toISOString(),
        removedReason: reason,
      },
    })
    .eq('id', publishId)
    .eq('status', 'published')
    .select('id');

  if (updateError) {
    throw new Error(
      `Could not mark the publish removed: ${updateError.message}`,
    );
  }

  return (updated?.length ?? 0) > 0;
}

/**
 * The person's "Mark as removed": a published video they took down on the
 * platform themselves. Project owners and admins, as for a takedown.
 */
export async function markPublishRemoved(
  client: Client,
  userId: string,
  publishId: string,
): Promise<Result<{ publishId: string; episodeId: string }>> {
  const { data: publish, error } = await client
    .from('publishes')
    .select('id, episode_id, status, episodes!inner(project_id)')
    .eq('id', publishId)
    .maybeSingle();

  if (error) {
    throw new Error(`Could not read the publish: ${error.message}`);
  }

  if (!publish) {
    return { ok: false, refusal: 'Publish record not found' };
  }

  if (publish.status !== 'published') {
    return {
      ok: false,
      refusal: `That publish is ${publish.status}, not published, so it can't be marked as removed.`,
    };
  }

  const role = await projectRoleOf(client, publish.episodes.project_id, userId);

  if (!canTakeDown(role)) {
    return { ok: false, refusal: MARK_REMOVED_REFUSAL };
  }

  const marked = await recordPublishRemoved(client, publishId, REMOVED_BY_HAND);

  if (!marked) {
    return {
      ok: false,
      refusal: 'That publish changed just now; refresh and try again.',
    };
  }

  return { ok: true, data: { publishId, episodeId: publish.episode_id } };
}
