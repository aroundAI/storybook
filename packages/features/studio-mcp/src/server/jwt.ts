import 'server-only';

import { SignJWT } from 'jose';

/** How long a minted RLS token lives: one tool call, with slack. */
export const MCP_USER_JWT_TTL_SECONDS = 300;

export interface McpUserJwtClaims {
  userId: string;
  connectionId: string;
}

/**
 * Mints the Supabase JWT a tool call runs under. Behind an interface so
 * FILM-1907 can add signing with a private key imported into the project's
 * JWT signing keys (`kid` set) beside the legacy shared secret.
 */
export interface McpJwtSigner {
  readonly kind: 'hs256-secret' | 'asymmetric-key';
  sign(claims: McpUserJwtClaims): Promise<string>;
}

/**
 * HS256 with the project's JWT secret.
 *
 * `SUPABASE_JWT_SECRET` is the "JWT Secret" in the Supabase dashboard
 * (Settings → API), the same secret the anon and service-role keys are
 * signed with. Local Supabase's is the published default,
 * `super-secret-jwt-token-with-at-least-32-characters-long`
 * (`apps/web/.env.development`). It is never NEXT_PUBLIC_: with it anyone
 * can mint a token for any user.
 */
export function createHs256Signer(options: {
  secret: string;
  issuer: string;
  ttlSeconds?: number;
}): McpJwtSigner {
  if (options.secret.length < 32) {
    throw new Error('SUPABASE_JWT_SECRET must be at least 32 characters');
  }

  const key = new TextEncoder().encode(options.secret);
  const ttl = options.ttlSeconds ?? MCP_USER_JWT_TTL_SECONDS;

  return {
    kind: 'hs256-secret',
    async sign({ userId, connectionId }) {
      const now = Math.floor(Date.now() / 1000);

      return new SignJWT({
        role: 'authenticated',
        aal: 'aal1',
        is_anonymous: false,
        app_metadata: { provider: 'mcp', mcp_connection_id: connectionId },
        user_metadata: {},
      })
        .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
        .setIssuer(options.issuer)
        .setSubject(userId)
        .setAudience('authenticated')
        .setIssuedAt(now)
        .setExpirationTime(now + ttl)
        .sign(key);
    },
  };
}

/**
 * The signer the environment selects. Today only the shared secret; a
 * `MCP_JWT_PRIVATE_KEY` (FILM-1907) will select the asymmetric signer here.
 */
export function createMcpJwtSigner(): McpJwtSigner {
  if (process.env.MCP_JWT_PRIVATE_KEY) {
    throw new Error(
      'MCP_JWT_PRIVATE_KEY is set, but signing with an imported key is FILM-1907; unset it or use SUPABASE_JWT_SECRET',
    );
  }

  const secret = process.env.SUPABASE_JWT_SECRET;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;

  if (!secret) {
    throw new Error(
      'SUPABASE_JWT_SECRET is not set: the MCP endpoint cannot mint a user token',
    );
  }

  if (!supabaseUrl) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL is not set');
  }

  return createHs256Signer({ secret, issuer: `${supabaseUrl}/auth/v1` });
}
