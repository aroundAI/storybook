import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '@kit/supabase/database';

import { McpScopeSchema } from '../scopes';
import type { McpTokenVerification, McpTokenVerifier } from '../verifier';
import { resourceMatches } from './oauth/resource';
import { hashToken, isBearerTokenShape } from './token';

/**
 * The `own` verifier: hashes the presented token and looks the hash up in
 * `mcp_tokens`, joined to its connection. Reads with the service role,
 * because `mcp_tokens` has no policy for anyone else; this is the one place
 * outside FILM-1907's endpoints that touches the table.
 *
 * Only bearer credentials resolve: a personal access token or an access
 * token. A refresh token is for `/oauth/token` alone, and is `malformed`
 * here even when its hash is stored. An access token carries the resource
 * it was issued for (RFC 8707); one issued for another deployment is
 * `unknown` to this one.
 *
 * Revocation of either the token or the connection refuses the next call;
 * nothing is cached.
 */
export function createOwnTokenVerifier(
  admin: SupabaseClient<Database>,
  now: () => Date = () => new Date(),
  options: { resource?: string } = {},
): McpTokenVerifier {
  return {
    kind: 'own',
    async verify(token): Promise<McpTokenVerification> {
      if (!isBearerTokenShape(token)) {
        return { ok: false, reason: 'malformed' };
      }

      const { data, error } = await admin
        .from('mcp_tokens')
        .select(
          'token_hash, audience, expires_at, revoked_at, connection:mcp_connections!inner(id, user_id, account_id, kind, name, scopes, revoked_at)',
        )
        .eq('token_hash', hashToken(token))
        .maybeSingle();

      if (error) {
        throw new Error(`mcp_tokens lookup failed: ${error.message}`);
      }

      if (!data) {
        return { ok: false, reason: 'unknown' };
      }

      if (
        data.audience &&
        options.resource &&
        !resourceMatches(data.audience, options.resource)
      ) {
        return { ok: false, reason: 'unknown' };
      }

      const connection = data.connection;

      if (data.revoked_at || connection.revoked_at) {
        return { ok: false, reason: 'revoked' };
      }

      if (data.expires_at && new Date(data.expires_at) <= now()) {
        return { ok: false, reason: 'expired' };
      }

      const kind = connection.kind === 'oauth' ? 'oauth' : 'pat';

      return {
        ok: true,
        connection: {
          id: connection.id,
          userId: connection.user_id,
          accountId: connection.account_id,
          kind,
          clientName: connection.name,
          scopes: McpScopeSchema.array().parse(connection.scopes),
        },
      };
    },
  };
}
