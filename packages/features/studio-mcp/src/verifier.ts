import type { McpScope } from './scopes';

/**
 * A connection, as the verifier resolves it from a presented credential.
 */
export interface McpConnectionRecord {
  id: string;
  userId: string;
  accountId: string;
  kind: 'oauth' | 'pat';
  /** The OAuth client's name, or the personal access token's name. */
  clientName: string;
  scopes: McpScope[];
}

export type McpTokenRefusal =
  /** Not a credential this verifier issues (wrong prefix, wrong shape). */
  | 'malformed'
  /** Well-formed, but no connection holds it. */
  | 'unknown'
  | 'expired'
  | 'revoked';

export type McpTokenVerification =
  | { ok: true; connection: McpConnectionRecord }
  | { ok: false; reason: McpTokenRefusal };

/**
 * Resolves a bearer token to a connection. `withMcpAuth` goes through this
 * interface and nothing else, so the authorization server can change
 * without a tool noticing (owner decision 2026-10-02, FILM-1907):
 *
 * - `own` (the default, `MCP_AUTH_SERVER=own`): opaque tokens whose SHA-256
 *   hashes live in `mcp_tokens` — personal access tokens today, FILM-1907's
 *   access and refresh tokens next.
 * - `supabase` (FILM-1907): JWTs from Supabase Auth's OAuth server, mapped
 *   to the same record.
 */
export interface McpTokenVerifier {
  readonly kind: 'own' | 'supabase';
  verify(token: string): Promise<McpTokenVerification>;
}
