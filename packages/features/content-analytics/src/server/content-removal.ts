import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import {
  notFoundOn,
  recordPublishRemoved,
} from '@kit/publishing/lib/publish-removal';
import { metaFetch } from '@kit/shared/vendors';
import type { Database } from '@kit/supabase/database';

/**
 * KB-207. Meta answers code 100 / subcode 33 both for an object that does
 * not exist and for one the token "cannot load due to missing permissions",
 * so a Facebook or Instagram not-found marks a publish removed only once
 * the same token is shown to still read the channel itself: the Page or
 * Instagram user, `GET /{id}?fields=id`. A probe that fails for any reason
 * marks nothing, and the row is asked about again on its next visit.
 *
 * One probe per channel per sync run: `probes` is the run's, shared by its
 * publishes.
 */

type Client = SupabaseClient<Database>;

export type ChannelProbes = Map<string, Promise<boolean>>;

async function channelStillReadable(
  client: Client,
  connectionId: string,
  accessToken: string,
): Promise<boolean> {
  try {
    const { data: connection } = await client
      .from('platform_connections')
      .select('platform_account_id')
      .eq('id', connectionId)
      .maybeSingle();

    const accountId = connection?.platform_account_id;
    if (!accountId) return false;

    const response = await metaFetch(
      `/${encodeURIComponent(accountId)}?fields=id`,
      { token: accessToken },
    );
    if (!response.ok) return false;

    const body = (await response.json().catch(() => null)) as {
      id?: string;
      error?: unknown;
    } | null;

    return !body?.error && body?.id === accountId;
  } catch {
    return false;
  }
}

/**
 * Marks a Facebook or Instagram publish removed after its not-found, when
 * the probe confirms the token still reads the channel. True when the
 * not-found is confirmed (the row is marked, unless it changed meanwhile).
 */
export async function markMetaPublishRemoved(
  client: Client,
  publish: { id: string; platform_connection_id: string },
  platform: string,
  accessToken: string,
  probes: ChannelProbes,
): Promise<boolean> {
  let probe = probes.get(publish.platform_connection_id);

  if (!probe) {
    probe = channelStillReadable(
      client,
      publish.platform_connection_id,
      accessToken,
    );
    probes.set(publish.platform_connection_id, probe);
  }

  if (!(await probe)) return false;

  await recordPublishRemoved(client, publish.id, notFoundOn(platform));
  return true;
}
