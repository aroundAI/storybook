/**
 * What the publish worker checks before it touches a platform (KB-47, KB-109).
 *
 * The worker holds the service-role key and every connection's token, so a
 * message is only a pointer: the publish row it names is re-read, and the
 * row, not the message, says which connection and which video. The checks:
 *
 * - the connection belongs to the account that owns the publish's episode
 *   (KB-109: a publish row could name another account's connection);
 * - an upload's episode has not been deleted (KB-207: deleting an episode
 *   cancels its posts, and a job already on the queue is failed here);
 * - a delete runs only on a row in 'deleting' — set by an unpublish action
 *   whose update passed `publishes_update` — and only for a user who may
 *   still take the project's videos down (`TAKEDOWN_ROLES`);
 * - an upload is not a second post of a video the account already has
 *   (KB-213, `duplicatePostRefusal`), and its connection is not paused by
 *   Meta (KB-213, `publishBlockOf`): a paused connection's post waits.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

import { duplicatePostRefusal } from '@kit/publishing/lib/duplicate-post';
import { pausedConnectionIds } from '@kit/publishing/lib/publish-block';
import {
  TAKEDOWN_REFUSAL,
  canTakeDown,
  projectRoleOf,
} from '@kit/publishing/lib/takedown';
import type { Database } from '@kit/supabase/database';

export const EPISODE_DELETED_REFUSAL =
  'Its episode was deleted, so it was not posted.';

/** A job that must not run. Acknowledged, not retried: retrying asks again. */
export class PublishJobRefused extends Error {
  override readonly name = 'PublishJobRefused';
}

const PUBLISH_COLUMNS = `
  id, status, platform, platform_content_id, platform_connection_id,
  episode:episodes!inner(project_id, deleted_at, project:projects!inner(account_id)),
  connection:platform_connections(account_id)
`;

interface PublishRow {
  id: string;
  status: string;
  platform: string;
  platform_content_id: string | null;
  platform_connection_id: string | null;
  projectId: string;
  episodeDeleted: boolean;
}

async function readPublish(
  supabase: SupabaseClient<Database>,
  publishId: string,
): Promise<PublishRow | null> {
  const { data, error } = await supabase
    .from('publishes')
    .select(PUBLISH_COLUMNS)
    .eq('id', publishId)
    .maybeSingle();

  if (error) {
    throw new Error(`Could not read publish ${publishId}: ${error.message}`);
  }

  if (!data) return null;

  const episodeAccount = data.episode.project.account_id;
  const connectionAccount = data.connection?.account_id ?? null;

  if (connectionAccount !== null && connectionAccount !== episodeAccount) {
    throw new PublishJobRefused(
      'The publish names a connection of another account',
    );
  }

  return {
    id: data.id,
    status: data.status,
    platform: data.platform,
    platform_content_id: data.platform_content_id,
    platform_connection_id: data.platform_connection_id,
    projectId: data.episode.project_id,
    episodeDeleted: data.episode.deleted_at !== null,
  };
}

/**
 * The connection a publish job may upload with: the row's, and only when it
 * is the one the message names and belongs to the episode's account.
 */
export async function publishJobConnection(
  supabase: SupabaseClient<Database>,
  job: { publishId: string; platformConnectionId: string },
): Promise<string> {
  const row = await readPublish(supabase, job.publishId);

  if (!row) throw new PublishJobRefused('The publish no longer exists');

  if (row.episodeDeleted) throw new PublishJobRefused(EPISODE_DELETED_REFUSAL);

  if (row.platform_connection_id !== job.platformConnectionId) {
    throw new PublishJobRefused(
      "The job's connection is not the publish's connection",
    );
  }

  return job.platformConnectionId;
}

/**
 * What a delete job may remove: the row's platform, video and connection.
 * `null` when the row is already gone — a redelivered job with nothing left
 * to do.
 */
export async function deleteJobTarget(
  supabase: SupabaseClient<Database>,
  job: { publishId: string; userId: string },
): Promise<{
  platform: string;
  platformContentId: string;
  platformConnectionId: string | null;
} | null> {
  const row = await readPublish(supabase, job.publishId);

  if (!row) return null;

  if (row.status !== 'deleting') {
    throw new PublishJobRefused('The publish is not marked for deletion');
  }

  const role = await projectRoleOf(supabase, row.projectId, job.userId);

  if (!canTakeDown(role)) {
    throw new PublishJobRefused(TAKEDOWN_REFUSAL);
  }

  return {
    platform: row.platform,
    platformContentId: row.platform_content_id ?? '',
    platformConnectionId: row.platform_connection_id,
  };
}

/**
 * KB-213: the account already has this video, or is being sent it by
 * another upload that started first. Read after the row is marked
 * `publishing`, so of two uploads of one video in the same batch exactly
 * one goes. Returns the refusal, or null.
 */
export async function duplicateJobRefusal(
  supabase: SupabaseClient<Database>,
  publishId: string,
  now = new Date(),
): Promise<string | null> {
  const { data: row, error } = await supabase
    .from('publishes')
    .select(
      'id, episode_id, platform_connection_id, content_type, title, language, metadata',
    )
    .eq('id', publishId)
    .maybeSingle();

  if (error) {
    throw new Error(`Could not read publish ${publishId}: ${error.message}`);
  }

  if (!row?.platform_connection_id) return null;

  const metadata =
    row.metadata &&
    typeof row.metadata === 'object' &&
    !Array.isArray(row.metadata)
      ? (row.metadata as Record<string, unknown>)
      : {};

  return duplicatePostRefusal(
    supabase,
    {
      publishId: row.id,
      episodeId: row.episode_id,
      connectionId: row.platform_connection_id,
      contentType: row.content_type ?? 'full',
      title: row.title,
      language: row.language,
      shortsGroupId:
        typeof metadata.shortsGroupId === 'string'
          ? metadata.shortsGroupId
          : null,
      startedAt:
        typeof metadata.publishingStartedAt === 'string'
          ? metadata.publishingStartedAt
          : null,
    },
    now,
  );
}

/**
 * KB-213: a post for a connection Meta has paused goes back to `scheduled`
 * (now, when it had no time) and waits for the block to clear; it is
 * neither failed nor sent. True when the job was held.
 */
export async function holdPausedJob(
  supabase: SupabaseClient<Database>,
  job: { publishId: string; platformConnectionId: string },
  now = new Date(),
): Promise<boolean> {
  const paused = await pausedConnectionIds(supabase, [
    job.platformConnectionId,
  ]);

  if (!paused.has(job.platformConnectionId)) return false;

  const { data: row } = await supabase
    .from('publishes')
    .select('scheduled_at')
    .eq('id', job.publishId)
    .maybeSingle();

  await supabase
    .from('publishes')
    .update({
      status: 'scheduled',
      scheduled_at: row?.scheduled_at ?? now.toISOString(),
    })
    .eq('id', job.publishId)
    .in('status', ['queued', 'failed', 'scheduled']);

  return true;
}
