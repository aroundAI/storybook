import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import { getSupabaseServerAdminClient } from './clients/server-admin-client';
import type { Database } from './database.types';

type ApiKeyTable = Database['public']['Tables']['external_api_keys'];

export type StoredApiKey = Pick<
  ApiKeyTable['Row'],
  'provider' | 'encrypted_key' | 'is_active'
>;

export interface ApiKeyWriteFailure {
  branch:
    | 'api_key_owner_check'
    | 'api_key_upsert'
    | 'api_key_delete'
    | 'api_key_delete_none';
  cause: unknown;
}

/**
 * The one way to read or store a BYOK vendor key (KB-84).
 *
 * Members may not read `external_api_keys.encrypted_key`, so reads go
 * through the admin client — which skips RLS, and RLS
 * (`has_account_access(account_id)`) was the only check on an account id
 * that several actions take from the browser. So the caller's own client
 * first asks `has_account_access`, the predicate those policies apply.
 * No path here reaches the admin client without it.
 */
async function hasAccountAccess(
  client: SupabaseClient<Database>,
  accountId: string,
) {
  const { data, error } = await client.rpc('has_account_access', {
    p_account_id: accountId,
  });

  if (error) {
    throw new Error(`api_key_access_check failed: ${error.message}`);
  }

  return data === true;
}

/**
 * The account's stored keys, ciphertext included, for the server to decrypt.
 * A caller without access to the account gets `[]`, exactly as the RLS
 * read policy answered before — an absent key and a hidden one look alike.
 */
export async function readExternalApiKeys(
  client: SupabaseClient<Database>,
  accountId: string,
  filter: { provider?: string; activeOnly?: boolean } = {},
): Promise<StoredApiKey[]> {
  if (!(await hasAccountAccess(client, accountId))) {
    return [];
  }

  let query = getSupabaseServerAdminClient()
    .from('external_api_keys')
    .select('provider, encrypted_key, is_active')
    .eq('account_id', accountId);

  if (filter.provider) {
    query = query.eq('provider', filter.provider);
  }

  if (filter.activeOnly) {
    query = query.eq('is_active', true);
  }

  const { data, error } = await query.order('provider');

  if (error) {
    throw error;
  }

  return data;
}

/**
 * Whether the caller may add, replace or remove the account's keys: its
 * primary owner (a personal account has no membership row) or a member with
 * the `owner` role. The owner's decision, 2026-09-25 (KB-84). Any other role
 * on the account still sees which providers are configured.
 */
export async function canManageExternalApiKeys(
  client: SupabaseClient<Database>,
  accountId: string,
) {
  const [primary, role] = await Promise.all([
    client.rpc('is_account_owner', { account_id: accountId }),
    client.rpc('has_role_on_account', {
      account_id: accountId,
      account_role: 'owner',
    }),
  ]);

  const error = primary.error ?? role.error;

  if (error) {
    throw new Error(`api_key_owner_check failed: ${error.message}`);
  }

  return primary.data === true || role.data === true;
}

/** One provider's key (`unique(account_id, provider)`), active only by default. */
export async function readExternalApiKey(
  client: SupabaseClient<Database>,
  accountId: string,
  provider: string,
  { activeOnly = true }: { activeOnly?: boolean } = {},
): Promise<StoredApiKey | null> {
  const [key] = await readExternalApiKeys(client, accountId, {
    provider,
    activeOnly,
  });

  if (key) {
    await recordExternalApiKeyUse(accountId, provider);
  }

  return key ?? null;
}

/**
 * Stamp `last_used_at` when a key is handed out for use (FILM-101n). Best
 * effort: a failed stamp must not fail the call the key was fetched for.
 */
async function recordExternalApiKeyUse(accountId: string, provider: string) {
  const { error } = await getSupabaseServerAdminClient()
    .from('external_api_keys')
    .update({ last_used_at: new Date().toISOString() })
    .eq('account_id', accountId)
    .eq('provider', provider);

  if (error) {
    console.warn(`api_key_last_used failed: ${error.message}`);
  }
}

async function ownerCheckFailure(
  client: SupabaseClient<Database>,
  accountId: string,
): Promise<ApiKeyWriteFailure | null> {
  try {
    return (await canManageExternalApiKeys(client, accountId))
      ? null
      : { branch: 'api_key_owner_check', cause: null };
  } catch (cause) {
    return { branch: 'api_key_owner_check', cause };
  }
}

/**
 * Save or replace a key; account owners only. An upsert reads
 * `encrypted_key` back through EXCLUDED, which members may not, so the write
 * goes through the admin client after the owner check.
 */
export async function storeExternalApiKey(
  client: SupabaseClient<Database>,
  row: ApiKeyTable['Insert'],
): Promise<{ error: ApiKeyWriteFailure | null }> {
  const refused = await ownerCheckFailure(client, row.account_id);

  if (refused) {
    return { error: refused };
  }

  const { error } = await getSupabaseServerAdminClient()
    .from('external_api_keys')
    .upsert(row, { onConflict: 'account_id,provider' });

  return { error: error ? { branch: 'api_key_upsert', cause: error } : null };
}

/**
 * Remove a provider's key; account owners only. The delete runs on the
 * caller's own client, so the table's delete policy applies as well.
 */
export async function removeExternalApiKey(
  client: SupabaseClient<Database>,
  accountId: string,
  provider: string,
): Promise<{ error: ApiKeyWriteFailure | null }> {
  const refused = await ownerCheckFailure(client, accountId);

  if (refused) {
    return { error: refused };
  }

  const { data: deleted, error } = await client
    .from('external_api_keys')
    .delete()
    .eq('account_id', accountId)
    .eq('provider', provider)
    .select('provider');

  if (error) {
    return { error: { branch: 'api_key_delete', cause: error } };
  }

  // RLS filters a delete it refuses to nothing, with no error (KB-61)
  return {
    error: deleted?.length
      ? null
      : { branch: 'api_key_delete_none', cause: null },
  };
}
