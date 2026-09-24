import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '@kit/supabase/database';
import { getSupabaseServerAdminClient } from '@kit/supabase/server-admin-client';

type ConnectionRow =
  Database['public']['Tables']['platform_connections']['Insert'];

export interface StoreConnectionFailure {
  branch: 'connection_access_check' | 'connection_upsert';
  cause: unknown;
}

/**
 * The one way an OAuth callback stores a connection (KB-43).
 *
 * Members may not read a connection's token columns, and an upsert reads
 * them back through EXCLUDED, so the write goes through the admin client.
 * That skips RLS — which was the only check on `account_id`, a value the
 * callbacks take from the browser-supplied `state` parameter. So the user's
 * own client first asks `has_account_access`, the predicate the RLS insert
 * and update policies apply, for every account the rows name.
 */
export async function storePlatformConnections(
  client: SupabaseClient<Database>,
  rows: ConnectionRow[],
): Promise<{ error: StoreConnectionFailure | null }> {
  for (const accountId of new Set(rows.map((row) => row.account_id))) {
    const { data, error } = await client.rpc('has_account_access', {
      p_account_id: accountId,
    });

    if (error || data !== true) {
      return { error: { branch: 'connection_access_check', cause: error } };
    }
  }

  const { error } = await getSupabaseServerAdminClient()
    .from('platform_connections')
    .upsert(rows, { onConflict: 'account_id,platform,platform_account_id' });

  return {
    error: error ? { branch: 'connection_upsert', cause: error } : null,
  };
}
