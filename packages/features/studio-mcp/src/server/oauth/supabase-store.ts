import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '@kit/supabase/database';

import { McpScopeSchema } from '../../scopes';
import type {
  AuthorizationCodeRecord,
  ConnectionRecord,
  OAuthClientRecord,
  OAuthStore,
  TokenRecord,
} from './store';

type Tables = Database['public']['Tables'];

/**
 * The OAuth store over Supabase, with the service role: `mcp_oauth_clients`,
 * `mcp_authorization_codes` and `mcp_tokens` have no policy for anyone
 * else, and `mcp_connections` is written here on behalf of a user who is
 * not signed in to the app at the moment the token endpoint runs.
 */
export function createSupabaseOAuthStore(
  admin: SupabaseClient<Database>,
): OAuthStore {
  return {
    async getClient(clientId) {
      const { data, error } = await admin
        .from('mcp_oauth_clients')
        .select('*')
        .eq('client_id', clientId)
        .maybeSingle();

      if (error) throw new Error(`mcp_oauth_clients read failed: ${error.message}`);

      return data ? toClient(data) : null;
    },

    async saveClient(client) {
      const { error } = await admin.from('mcp_oauth_clients').upsert(
        {
          client_id: client.clientId,
          client_name: client.clientName,
          redirect_uris: client.redirectUris,
          metadata_url: client.metadataUrl,
          created_at: client.createdAt,
        },
        { onConflict: 'client_id' },
      );

      if (error) throw new Error(`mcp_oauth_clients write failed: ${error.message}`);
    },

    async saveCode(code) {
      const { error } = await admin.from('mcp_authorization_codes').insert({
        code_hash: code.codeHash,
        client_id: code.clientId,
        user_id: code.userId,
        account_id: code.accountId,
        scopes: code.scopes,
        code_challenge: code.codeChallenge,
        redirect_uri: code.redirectUri,
        resource: code.resource,
        expires_at: code.expiresAt,
        used_at: code.usedAt,
      });

      if (error) throw new Error(`mcp_authorization_codes write failed: ${error.message}`);
    },

    async consumeCode(codeHash, now) {
      // One UPDATE guarded by `used_at is null`: two concurrent redemptions
      // of the same code cannot both see a row come back.
      const { data, error } = await admin
        .from('mcp_authorization_codes')
        .update({ used_at: now.toISOString() })
        .eq('code_hash', codeHash)
        .is('used_at', null)
        .select('*')
        .maybeSingle();

      if (error) throw new Error(`mcp_authorization_codes consume failed: ${error.message}`);

      if (data) return { ok: true, code: toCode(data) };

      const { data: existing, error: lookupError } = await admin
        .from('mcp_authorization_codes')
        .select('code_hash')
        .eq('code_hash', codeHash)
        .maybeSingle();

      if (lookupError) {
        throw new Error(`mcp_authorization_codes read failed: ${lookupError.message}`);
      }

      return { ok: false, reason: existing ? 'used' : 'unknown' };
    },

    async createConnection(input) {
      const { data, error } = await admin
        .from('mcp_connections')
        .insert({
          user_id: input.userId,
          account_id: input.accountId,
          client_id: input.clientId,
          kind: 'oauth',
          name: input.name,
          scopes: input.scopes,
        })
        .select('*')
        .single();

      if (error) throw new Error(`mcp_connections write failed: ${error.message}`);

      return toConnection(data);
    },

    async getConnection(connectionId) {
      const { data, error } = await admin
        .from('mcp_connections')
        .select('*')
        .eq('id', connectionId)
        .maybeSingle();

      if (error) throw new Error(`mcp_connections read failed: ${error.message}`);

      return data ? toConnection(data) : null;
    },

    async revokeConnection(connectionId, now) {
      const at = now.toISOString();

      const { error } = await admin
        .from('mcp_connections')
        .update({ revoked_at: at })
        .eq('id', connectionId)
        .is('revoked_at', null);

      if (error) throw new Error(`mcp_connections revoke failed: ${error.message}`);

      const { error: tokensError } = await admin
        .from('mcp_tokens')
        .update({ revoked_at: at })
        .eq('connection_id', connectionId)
        .is('revoked_at', null);

      if (tokensError) throw new Error(`mcp_tokens revoke failed: ${tokensError.message}`);
    },

    async saveTokens(tokens) {
      const { error } = await admin.from('mcp_tokens').insert(
        tokens.map((token) => ({
          token_hash: token.tokenHash,
          connection_id: token.connectionId,
          kind: token.kind,
          expires_at: token.expiresAt,
          rotated_from: token.rotatedFrom,
          revoked_at: token.revokedAt,
          audience: token.audience,
        })),
      );

      if (error) throw new Error(`mcp_tokens write failed: ${error.message}`);
    },

    async getToken(tokenHash) {
      const { data, error } = await admin
        .from('mcp_tokens')
        .select('*')
        .eq('token_hash', tokenHash)
        .maybeSingle();

      if (error) throw new Error(`mcp_tokens read failed: ${error.message}`);

      return data ? toToken(data) : null;
    },

    async revokeToken(tokenHash, now) {
      const { error } = await admin
        .from('mcp_tokens')
        .update({ revoked_at: now.toISOString() })
        .eq('token_hash', tokenHash)
        .is('revoked_at', null);

      if (error) throw new Error(`mcp_tokens revoke failed: ${error.message}`);
    },

    async hasRotatedChild(tokenHash) {
      const { count, error } = await admin
        .from('mcp_tokens')
        .select('token_hash', { count: 'exact', head: true })
        .eq('rotated_from', tokenHash);

      if (error) throw new Error(`mcp_tokens read failed: ${error.message}`);

      return (count ?? 0) > 0;
    },
  };
}

function toClient(row: Tables['mcp_oauth_clients']['Row']): OAuthClientRecord {
  return {
    clientId: row.client_id,
    clientName: row.client_name,
    redirectUris: row.redirect_uris,
    metadataUrl: row.metadata_url,
    createdAt: row.created_at,
  };
}

function toCode(
  row: Tables['mcp_authorization_codes']['Row'],
): AuthorizationCodeRecord {
  return {
    codeHash: row.code_hash,
    clientId: row.client_id,
    userId: row.user_id,
    accountId: row.account_id,
    scopes: McpScopeSchema.array().parse(row.scopes),
    codeChallenge: row.code_challenge,
    redirectUri: row.redirect_uri,
    resource: row.resource,
    expiresAt: row.expires_at,
    usedAt: row.used_at,
  };
}

function toConnection(row: Tables['mcp_connections']['Row']): ConnectionRecord {
  return {
    id: row.id,
    userId: row.user_id,
    accountId: row.account_id,
    clientId: row.client_id,
    kind: row.kind === 'oauth' ? 'oauth' : 'pat',
    name: row.name,
    scopes: McpScopeSchema.array().parse(row.scopes),
    revokedAt: row.revoked_at,
  };
}

function toToken(row: Tables['mcp_tokens']['Row']): TokenRecord {
  return {
    tokenHash: row.token_hash,
    connectionId: row.connection_id,
    kind: row.kind === 'access' ? 'access' : row.kind === 'refresh' ? 'refresh' : 'pat',
    expiresAt: row.expires_at,
    rotatedFrom: row.rotated_from,
    revokedAt: row.revoked_at,
    audience: row.audience,
  };
}
