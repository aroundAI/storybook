import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import { ActionRefusal } from '@kit/next/action-result';
import type { Database } from '@kit/supabase/database';

export const FOREIGN_CONNECTION_REFUSAL =
  "That channel isn't connected to this account.";

/**
 * The connection belongs to the account the content belongs to (KB-109).
 *
 * `getAccessToken` decrypts on the service-role key and may refresh the
 * token, so this is asked first. The caller's own client is used: a
 * connection they cannot see is refused the same way as one of another
 * account, and a user who belongs to two accounts cannot publish one
 * account's episode to the other's channel.
 */
export async function assertConnectionOfAccount(
  client: SupabaseClient<Database>,
  connectionId: string,
  accountId: string,
): Promise<void> {
  const { data, error } = await client
    .from('platform_connections')
    .select('account_id')
    .eq('id', connectionId)
    .maybeSingle();

  if (error) {
    throw new Error(`Could not read the channel: ${error.message}`);
  }

  if (data?.account_id !== accountId) {
    throw new ActionRefusal(FOREIGN_CONNECTION_REFUSAL);
  }
}
