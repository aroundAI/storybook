import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import { getSupabaseServerClient } from '@kit/supabase/server-client';

// Use generic SupabaseClient type to avoid strict type checking issues
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = SupabaseClient<any, any, any>;

/** A channel a project or account publishes to. */
export interface ChannelRef {
  connectionId: string;
  platform: string;
  name: string;
  thumbnailUrl: string | null;
  isActive: boolean;
}

interface ConnectionRow {
  id: string;
  platform: string;
  platform_account_name: string | null;
  is_active: boolean | null;
  metadata: { thumbnail_url?: string } | null;
}

function toChannelRef(row: ConnectionRow): ChannelRef {
  return {
    connectionId: row.id,
    platform: row.platform,
    name: row.platform_account_name ?? row.platform,
    thumbnailUrl: row.metadata?.thumbnail_url ?? null,
    isActive: row.is_active ?? false,
  };
}

/**
 * Channels a project actually publishes to.
 *
 * A project spans several channels — different platforms, and separate
 * per-language channels where multi-language audio is unavailable — so this
 * is derived from the project's published content rather than from the
 * account's full connection list, which would include channels this project
 * has never touched.
 */
export async function listProjectChannels(
  projectId: string,
  client: Client = getSupabaseServerClient(),
): Promise<ChannelRef[]> {
  const { data } = await client
    .from('publishes')
    .select(
      `platform_connection_id,
       episodes!inner(project_id),
       platform_connections!inner(
         id, platform, platform_account_name, is_active, metadata
       )`,
    )
    .eq('status', 'published')
    .eq('episodes.project_id', projectId)
    .not('platform_connection_id', 'is', null);

  const byId = new Map<string, ChannelRef>();

  for (const row of data ?? []) {
    const connection = (
      row as unknown as { platform_connections?: ConnectionRow }
    ).platform_connections;
    if (!connection) continue;
    byId.set(connection.id, toChannelRef(connection));
  }

  return Array.from(byId.values()).sort((a, b) =>
    a.name.localeCompare(b.name),
  );
}

/**
 * Every channel connected to an account, whether or not it has published
 * anything yet — the right list for settings and for YPP, which applies to
 * a channel regardless of what has been posted to it.
 */
export async function listAccountChannels(
  accountId: string,
  client: Client = getSupabaseServerClient(),
  options?: { platform?: string; activeOnly?: boolean },
): Promise<ChannelRef[]> {
  let query = client
    .from('platform_connections')
    .select('id, platform, platform_account_name, is_active, metadata')
    .eq('account_id', accountId);

  if (options?.platform) {
    query = query.eq('platform', options.platform);
  }
  if (options?.activeOnly) {
    query = query.eq('is_active', true);
  }

  const { data } = await query;

  return ((data ?? []) as ConnectionRow[])
    .map(toChannelRef)
    .sort((a, b) => a.name.localeCompare(b.name));
}
