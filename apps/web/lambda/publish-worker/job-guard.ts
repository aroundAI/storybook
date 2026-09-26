/**
 * What the publish worker checks before it touches a platform (KB-47, KB-109).
 *
 * The worker holds the service-role key and every connection's token, so a
 * message is only a pointer: the publish row it names is re-read, and the
 * row, not the message, says which connection and which video. The checks:
 *
 * - the connection belongs to the account that owns the publish's episode
 *   (KB-109: a publish row could name another account's connection);
 * - a delete runs only on a row in 'deleting' — set by an unpublish action
 *   whose update passed `publishes_update` — and only for a user who may
 *   still take the project's videos down (`TAKEDOWN_ROLES`).
 */
import type { SupabaseClient } from '@supabase/supabase-js';

import {
  TAKEDOWN_REFUSAL,
  canTakeDown,
  projectRoleOf,
} from '@kit/publishing/lib/takedown';
import type { Database } from '@kit/supabase/database';

/** A job that must not run. Acknowledged, not retried: retrying asks again. */
export class PublishJobRefused extends Error {
  override readonly name = 'PublishJobRefused';
}

const PUBLISH_COLUMNS = `
  id, status, platform, platform_content_id, platform_connection_id,
  episode:episodes!inner(project_id, project:projects!inner(account_id)),
  connection:platform_connections(account_id)
`;

interface PublishRow {
  id: string;
  status: string;
  platform: string;
  platform_content_id: string | null;
  platform_connection_id: string | null;
  projectId: string;
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
