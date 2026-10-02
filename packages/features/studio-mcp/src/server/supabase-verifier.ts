import 'server-only';

import {
  type CryptoKey,
  type JWTVerifyGetKey,
  type KeyObject,
  createRemoteJWKSet,
  errors,
  jwtVerify,
} from 'jose';

import { McpScopeSchema, type McpScope } from '../scopes';
import type {
  McpConnectionRecord,
  McpTokenVerification,
  McpTokenVerifier,
} from '../verifier';
import { resourceMatches } from './oauth/resource';

/**
 * The `supabase` verifier (`MCP_AUTH_SERVER=supabase`): the client holds a
 * JWT from Supabase Auth's OAuth server rather than one of our opaque
 * tokens. The JWT proves who the user is (`sub`), which client they
 * approved (`client_id`) and that it was issued for this MCP server
 * (`aud`); the grant itself (team, scopes, revocation) is still an
 * `mcp_connections` row, found by user and client, so a tool sees the
 * same `McpConnectionRecord` whichever server issued the credential.
 *
 * Supabase Auth's OAuth server is not used by StoryBook yet (owner,
 * 2026-10-02: our own server, Supabase-compatible); this is the seam that
 * makes the swap a configuration change. Its contract test runs against a
 * locally signed JWT.
 */
export interface SupabaseVerifierOptions {
  /** GoTrue's issuer: `<supabase url>/auth/v1`. */
  issuer: string;
  /** The MCP resource URL every token must name in `aud`. */
  audience: string;
  /** The public key, or a JWKS resolver such as `createRemoteJWKSet`. */
  key: CryptoKey | KeyObject | Uint8Array | JWTVerifyGetKey;
  /**
   * The grant this user made to this client, or null for none. `revokedAt`
   * set means the user revoked it in Connected apps.
   */
  resolveConnection(input: {
    userId: string;
    clientId: string;
  }): Promise<(McpConnectionRecord & { revokedAt: string | null }) | null>;
  now?: () => Date;
}

const JWT_SHAPE = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;

export function createSupabaseTokenVerifier(
  options: SupabaseVerifierOptions,
): McpTokenVerifier {
  const now = options.now ?? (() => new Date());

  return {
    kind: 'supabase',
    async verify(token): Promise<McpTokenVerification> {
      if (!JWT_SHAPE.test(token)) {
        return { ok: false, reason: 'malformed' };
      }

      let payload;

      try {
        const verified =
          typeof options.key === 'function'
            ? await jwtVerify(token, options.key, {
                issuer: options.issuer,
                currentDate: now(),
              })
            : await jwtVerify(token, options.key, {
                issuer: options.issuer,
                currentDate: now(),
              });

        payload = verified.payload;
      } catch (error) {
        if (error instanceof errors.JWTExpired) {
          return { ok: false, reason: 'expired' };
        }

        return { ok: false, reason: 'malformed' };
      }

      const audiences = Array.isArray(payload.aud)
        ? payload.aud
        : payload.aud
          ? [payload.aud]
          : [];

      if (!audiences.some((aud) => resourceMatches(aud, options.audience))) {
        return { ok: false, reason: 'unknown' };
      }

      const userId = payload.sub;
      const clientId =
        typeof payload.client_id === 'string' ? payload.client_id : null;

      if (!userId || !clientId) {
        return { ok: false, reason: 'malformed' };
      }

      const connection = await options.resolveConnection({ userId, clientId });

      if (!connection) {
        return { ok: false, reason: 'unknown' };
      }

      if (connection.revokedAt) {
        return { ok: false, reason: 'revoked' };
      }

      const { revokedAt: _revokedAt, ...record } = connection;

      return {
        ok: true,
        connection: {
          ...record,
          scopes: narrowToClaim(record.scopes, payload.scope),
        },
      };
    },
  };
}

/** The JWT's `scope` claim may narrow the grant, never widen it. */
function narrowToClaim(granted: McpScope[], claim: unknown): McpScope[] {
  if (typeof claim !== 'string') return granted;

  const claimed = claim
    .split(/\s+/)
    .flatMap((scope) => {
      const parsed = McpScopeSchema.safeParse(scope);

      return parsed.success ? [parsed.data] : [];
    });

  const narrowed = granted.filter((scope) => claimed.includes(scope));

  return narrowed.length > 0 ? narrowed : granted;
}

/** The JWKS GoTrue publishes for its signing keys. */
export function supabaseJwks(supabaseUrl: string) {
  return createRemoteJWKSet(
    new URL(`${supabaseUrl}/auth/v1/.well-known/jwks.json`),
  );
}
