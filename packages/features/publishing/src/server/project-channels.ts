import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import { ActionRefusal } from '@kit/next/action-result';
import type { Database } from '@kit/supabase/database';

export const OUTSIDE_PROJECT_CHANNEL_REFUSAL =
  "That channel isn't one of this project's channels. Add it under Choose channels first.";

/**
 * The channels a project publishes to: its enabled `project_publishing_configs`
 * rows. A project with none publishes nowhere; it is never "every channel on
 * the team" (owner, 2026-10-10).
 */
export async function getProjectChannelIds(
  client: SupabaseClient<Database>,
  projectId: string,
): Promise<Set<string>> {
  const { data, error } = await client
    .from('project_publishing_configs')
    .select('platform_connection_id')
    .eq('project_id', projectId)
    .eq('is_enabled', true);

  if (error) {
    throw new Error(`Could not read the project's channels: ${error.message}`);
  }

  return new Set(data.map((row) => row.platform_connection_id));
}

/**
 * The connection is one of the project's channels. Asked after
 * `assertConnectionOfAccount`, before any token is decrypted.
 */
export async function assertConnectionOfProject(
  client: SupabaseClient<Database>,
  connectionIds: Iterable<string>,
  projectId: string,
): Promise<void> {
  const channels = await getProjectChannelIds(client, projectId);

  for (const connectionId of connectionIds) {
    if (!channels.has(connectionId)) {
      throw new ActionRefusal(OUTSIDE_PROJECT_CHANNEL_REFUSAL);
    }
  }
}
