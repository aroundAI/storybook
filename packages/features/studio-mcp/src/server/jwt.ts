import 'server-only';

import { type CryptoKey, type KeyObject, SignJWT, importPKCS8 } from 'jose';

/** How long a minted RLS token lives: one tool call, with slack. */
export const MCP_USER_JWT_TTL_SECONDS = 300;

export interface McpUserJwtClaims {
  userId: string;
  connectionId: string;
}

/**
 * Mints the Supabase JWT a tool call runs under. Two implementations, one
 * per Supabase key setup (FILM-1907 criterion 11): the legacy shared JWT
 * secret (HS256), or a private key imported into the project's JWT signing
 * keys (ES256 or RS256, with the `kid` Supabase lists for it).
 */
export interface McpJwtSigner {
  readonly kind: 'hs256-secret' | 'asymmetric-key';
  sign(claims: McpUserJwtClaims): Promise<string>;
}

export type McpJwtAsymmetricAlg = 'ES256' | 'RS256';

const ASYMMETRIC_ALGS: readonly McpJwtAsymmetricAlg[] = ['ES256', 'RS256'];

function userClaims(
  { userId, connectionId }: McpUserJwtClaims,
  issuer: string,
  ttl: number,
) {
  const now = Math.floor(Date.now() / 1000);

  return new SignJWT({
    role: 'authenticated',
    // The connection was approved at aal2 (consent and token creation pass
    // requireUser's MFA check), and the restrictive restrict_mfa_* policies
    // hide an MFA user's own team from an aal1 token. is_super_admin()
    // refuses provider 'mcp', so aal2 grants no super-admin access.
    aal: 'aal2',
    is_anonymous: false,
    app_metadata: { provider: 'mcp', mcp_connection_id: connectionId },
    user_metadata: {},
  })
    .setIssuer(issuer)
    .setSubject(userId)
    .setAudience('authenticated')
    .setIssuedAt(now)
    .setExpirationTime(now + ttl);
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
    async sign(claims) {
      return userClaims(claims, options.issuer, ttl)
        .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
        .sign(key);
    },
  };
}

/**
 * ES256 or RS256 with a private key whose public half was imported into
 * the project's JWT signing keys (Supabase dashboard → Authentication →
 * JWT Signing Keys → Import). `kid` must be the key id Supabase shows for
 * it: PostgREST and GoTrue pick the verification key by `kid`, and a token
 * without the right one is refused however well it is signed.
 *
 * The PEM is PKCS#8 (`-----BEGIN PRIVATE KEY-----`); the key is imported
 * once, here, so a wrong key or algorithm fails at startup rather than on
 * the first tool call.
 */
export async function createAsymmetricSigner(options: {
  privateKeyPem: string;
  kid: string;
  alg: McpJwtAsymmetricAlg;
  issuer: string;
  ttlSeconds?: number;
}): Promise<McpJwtSigner> {
  if (!ASYMMETRIC_ALGS.includes(options.alg)) {
    throw new Error(`MCP_JWT_ALG must be one of ${ASYMMETRIC_ALGS.join(', ')}`);
  }

  if (!options.kid) {
    throw new Error('MCP_JWT_KID is required with an imported signing key');
  }

  const key = await importPKCS8(
    normalisePem(options.privateKeyPem),
    options.alg,
  );
  const ttl = options.ttlSeconds ?? MCP_USER_JWT_TTL_SECONDS;

  return signerFor(key, options.kid, options.alg, options.issuer, ttl);
}

function signerFor(
  key: CryptoKey | KeyObject,
  kid: string,
  alg: McpJwtAsymmetricAlg,
  issuer: string,
  ttl: number,
): McpJwtSigner {
  return {
    kind: 'asymmetric-key',
    async sign(claims) {
      return userClaims(claims, issuer, ttl)
        .setProtectedHeader({ alg, typ: 'JWT', kid })
        .sign(key);
    },
  };
}

/** An env file usually carries the PEM on one line with `\n` escaped. */
function normalisePem(pem: string) {
  return pem.replace(/\\n/g, '\n').trim();
}

/**
 * The signer the environment selects:
 *
 * - `MCP_JWT_PRIVATE_KEY` (PKCS#8 PEM) with `MCP_JWT_KID` and, optionally,
 *   `MCP_JWT_ALG` (`ES256` default, or `RS256`): the asymmetric signer.
 *   The key is imported on the first signature and kept.
 * - otherwise `SUPABASE_JWT_SECRET`: the HS256 signer.
 *
 * Both need `NEXT_PUBLIC_SUPABASE_URL` for the issuer GoTrue's tokens
 * carry (`<supabase url>/auth/v1`).
 */
export function createMcpJwtSigner(): McpJwtSigner {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;

  if (!supabaseUrl) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL is not set');
  }

  const issuer = `${supabaseUrl}/auth/v1`;
  const privateKeyPem = process.env.MCP_JWT_PRIVATE_KEY;

  if (privateKeyPem) {
    const kid = process.env.MCP_JWT_KID;
    const alg = (process.env.MCP_JWT_ALG ?? 'ES256') as McpJwtAsymmetricAlg;

    if (!kid) {
      throw new Error(
        'MCP_JWT_KID is required with MCP_JWT_PRIVATE_KEY: the key id Supabase lists for the imported signing key',
      );
    }

    if (!ASYMMETRIC_ALGS.includes(alg)) {
      throw new Error(
        `MCP_JWT_ALG must be one of ${ASYMMETRIC_ALGS.join(', ')}`,
      );
    }

    let signer: Promise<McpJwtSigner> | undefined;

    return {
      kind: 'asymmetric-key',
      sign(claims) {
        signer ??= createAsymmetricSigner({ privateKeyPem, kid, alg, issuer });

        return signer.then((ready) => ready.sign(claims));
      },
    };
  }

  const secret = process.env.SUPABASE_JWT_SECRET;

  if (!secret) {
    throw new Error(
      'SUPABASE_JWT_SECRET is not set: the MCP endpoint cannot mint a user token',
    );
  }

  return createHs256Signer({ secret, issuer });
}
