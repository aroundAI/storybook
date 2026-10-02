import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '@kit/supabase/database';

import { McpScopeSchema, type McpScope } from '../scopes';
import { generatePersonalAccessToken, hashToken } from './token';

export type McpConnectionRow =
  Database['public']['Tables']['mcp_connections']['Row'];

export interface McpConnectionSummary {
  id: string;
  kind: 'oauth' | 'pat';
  name: string;
  scopes: McpScope[];
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

/**
 * Mints a personal access token for the signed-in user on one team. The
 * database gets the hash through `create_mcp_personal_access_token`, which
 * checks the caller's membership; the plaintext is returned once, for the
 * page to show, and exists nowhere else.
 */
export async function createPersonalAccessToken(
  client: SupabaseClient<Database>,
  input: { accountId: string; name: string; scopes: McpScope[] },
) {
  const token = generatePersonalAccessToken();

  const { data, error } = await client.rpc(
    'create_mcp_personal_access_token',
    {
      p_account_id: input.accountId,
      p_name: input.name,
      p_scopes: input.scopes,
      p_token_hash: hashToken(token),
    },
  );

  if (error) {
    return { ok: false as const, error };
  }

  return { ok: true as const, token, connection: toSummary(data) };
}

/**
 * The signed-in user's connections on a team. RLS already limits the rows
 * to the caller's own; the account filter picks the team the page shows.
 */
export async function listMcpConnections(
  client: SupabaseClient<Database>,
  accountId: string,
): Promise<McpConnectionSummary[]> {
  const { data, error } = await client
    .from('mcp_connections')
    .select('*')
    .eq('account_id', accountId)
    .order('created_at', { ascending: false })
    .order('id')
    .limit(200);

  if (error) {
    throw error;
  }

  return data.map(toSummary);
}

/**
 * Sets `revoked_at` on one of the caller's connections. The next call with
 * any of its tokens is refused. Returns how many rows changed: zero means
 * the connection is not the caller's or was already revoked.
 */
export async function revokeMcpConnection(
  client: SupabaseClient<Database>,
  connectionId: string,
) {
  const { data, error } = await client
    .from('mcp_connections')
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', connectionId)
    .is('revoked_at', null)
    .select('id');

  if (error) {
    throw error;
  }

  return data.length;
}

function toSummary(row: McpConnectionRow): McpConnectionSummary {
  return {
    id: row.id,
    kind: row.kind === 'oauth' ? 'oauth' : 'pat',
    name: row.name,
    scopes: McpScopeSchema.array().parse(row.scopes),
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
    revokedAt: row.revoked_at,
  };
}
