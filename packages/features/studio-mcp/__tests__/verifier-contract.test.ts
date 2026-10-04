import { SignJWT, exportJWK, generateKeyPair } from 'jose';
import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import type { McpConnectionRecord, McpTokenVerifier } from '../src';
import { createOwnTokenVerifier } from '../src/server/own-verifier';
import { createSupabaseTokenVerifier } from '../src/server/supabase-verifier';
import { hashToken } from '../src/server/token';

/**
 * FILM-1907 criterion 12: withMcpAuth resolves tokens through
 * McpTokenVerifier and nothing else, so the authorization server can be
 * swapped. This contract is what both implementations must satisfy: the
 * same user, team and scopes come out as the same connection record, and
 * expired, wrong-audience and revoked tokens are refused.
 */
const RESOURCE = 'http://localhost:3000/api/mcp';
const OTHER_RESOURCE = 'https://other.example/api/mcp';
const NOW = new Date('2026-10-03T10:00:00Z');

const USER = '11111111-1111-4111-8111-111111111111';
const TEAM = '22222222-2222-4222-8222-222222222222';
const CONNECTION = '33333333-3333-4333-8333-333333333333';

type TokenState = 'live' | 'expired' | 'revoked' | 'wrong-audience';

interface Harness {
  verifier: McpTokenVerifier;
  issue(state: TokenState): Promise<string>;
}

const expected: McpConnectionRecord = {
  id: CONNECTION,
  userId: USER,
  accountId: TEAM,
  kind: 'oauth',
  clientName: 'Claude',
  scopes: ['studio:read', 'studio:write'],
};

/**
 * A stand-in for the admin client: answers the one query the own verifier
 * makes (`mcp_tokens` by hash, joined to its connection) from a map.
 */
function fakeAdmin(rows: Map<string, Record<string, unknown>>) {
  let hash = '';

  const chain = {
    select: () => chain,
    eq: (_column: string, value: string) => {
      hash = value;
      return chain;
    },
    maybeSingle: async () => ({ data: rows.get(hash) ?? null, error: null }),
  };

  return { from: () => chain } as unknown as Parameters<
    typeof createOwnTokenVerifier
  >[0];
}

function ownHarness(): Harness {
  const rows = new Map<string, Record<string, unknown>>();
  const admin = fakeAdmin(rows);
  const verifier = createOwnTokenVerifier(admin, () => NOW, {
    resource: RESOURCE,
  });

  return {
    verifier,
    async issue(state) {
      const token = `sbk_at_${randomBytes(32).toString('base64url')}`;

      rows.set(hashToken(token), {
        token_hash: hashToken(token),
        kind: 'access',
        audience: state === 'wrong-audience' ? OTHER_RESOURCE : RESOURCE,
        expires_at: new Date(
          NOW.getTime() + (state === 'expired' ? -1 : 3600) * 1000,
        ).toISOString(),
        revoked_at: state === 'revoked' ? NOW.toISOString() : null,
        connection: {
          id: CONNECTION,
          user_id: USER,
          account_id: TEAM,
          kind: 'oauth',
          name: 'Claude',
          scopes: ['studio:read', 'studio:write'],
          revoked_at: null,
        },
      });

      return token;
    },
  };
}

async function supabaseHarness(): Promise<Harness> {
  const { privateKey, publicKey } = await generateKeyPair('ES256');
  const issuer = 'http://127.0.0.1:55321/auth/v1';
  const revoked = new Set<string>();

  const verifier = createSupabaseTokenVerifier({
    issuer,
    audience: RESOURCE,
    key: publicKey,
    now: () => NOW,
    async resolveConnection({ userId, clientId }) {
      if (userId !== USER || clientId !== 'claude-client') return null;

      return {
        ...expected,
        revokedAt: revoked.has(clientId) ? NOW.toISOString() : null,
      };
    },
  });

  return {
    verifier,
    async issue(state) {
      if (state === 'revoked') revoked.add('claude-client');

      const seconds = Math.floor(NOW.getTime() / 1000);

      return new SignJWT({
        role: 'authenticated',
        client_id: 'claude-client',
        scope: 'studio:read studio:write',
      })
        .setProtectedHeader({
          alg: 'ES256',
          kid: (await exportJWK(publicKey)).kid,
        })
        .setIssuer(issuer)
        .setSubject(USER)
        .setAudience(state === 'wrong-audience' ? OTHER_RESOURCE : RESOURCE)
        .setIssuedAt(seconds - 10)
        .setExpirationTime(seconds + (state === 'expired' ? -1 : 3600))
        .sign(privateKey);
    },
  };
}

describe.each([
  ['own', ownHarness],
  ['supabase', supabaseHarness],
] as const)('McpTokenVerifier contract: %s', (kind, makeHarness) => {
  it('names its kind', async () => {
    const { verifier } = await makeHarness();

    expect(verifier.kind).toBe(kind);
  });

  it('resolves a live token to the same connection record', async () => {
    const harness = await makeHarness();

    const result = await harness.verifier.verify(await harness.issue('live'));

    expect(result).toEqual({ ok: true, connection: expected });
  });

  it('refuses an expired token as expired', async () => {
    const harness = await makeHarness();

    expect(
      await harness.verifier.verify(await harness.issue('expired')),
    ).toEqual({
      ok: false,
      reason: 'expired',
    });
  });

  it('refuses a revoked grant as revoked', async () => {
    const harness = await makeHarness();

    expect(
      await harness.verifier.verify(await harness.issue('revoked')),
    ).toEqual({
      ok: false,
      reason: 'revoked',
    });
  });

  it('refuses a token issued for another resource', async () => {
    const harness = await makeHarness();

    expect(
      await harness.verifier.verify(await harness.issue('wrong-audience')),
    ).toEqual({ ok: false, reason: 'unknown' });
  });

  it('refuses something that is not its credential as malformed', async () => {
    const harness = await makeHarness();

    expect(await harness.verifier.verify('not-a-token')).toEqual({
      ok: false,
      reason: 'malformed',
    });
  });
});

describe('own verifier: only bearer credentials', () => {
  it('a refresh token presented as a bearer token is malformed, even when its hash is stored', async () => {
    const rows = new Map<string, Record<string, unknown>>();
    const admin = fakeAdmin(rows);
    const verifier = createOwnTokenVerifier(admin, () => NOW, {
      resource: RESOURCE,
    });
    const refresh = `sbk_rt_${randomBytes(32).toString('base64url')}`;

    rows.set(hashToken(refresh), {
      token_hash: hashToken(refresh),
      kind: 'refresh',
      audience: RESOURCE,
      expires_at: new Date(NOW.getTime() + 86400_000).toISOString(),
      revoked_at: null,
      connection: {
        id: CONNECTION,
        user_id: USER,
        account_id: TEAM,
        kind: 'oauth',
        name: 'Claude',
        scopes: ['studio:read'],
        revoked_at: null,
      },
    });

    expect(await verifier.verify(refresh)).toEqual({
      ok: false,
      reason: 'malformed',
    });
  });

  it('a personal access token has no audience and is accepted for any resource', async () => {
    const rows = new Map<string, Record<string, unknown>>();
    const admin = fakeAdmin(rows);
    const verifier = createOwnTokenVerifier(admin, () => NOW, {
      resource: RESOURCE,
    });
    const pat = `sbk_pat_${randomBytes(32).toString('base64url')}`;

    rows.set(hashToken(pat), {
      token_hash: hashToken(pat),
      kind: 'pat',
      audience: null,
      expires_at: null,
      revoked_at: null,
      connection: {
        id: CONNECTION,
        user_id: USER,
        account_id: TEAM,
        kind: 'pat',
        name: 'laptop',
        scopes: ['studio:read'],
        revoked_at: null,
      },
    });

    expect(await verifier.verify(pat)).toMatchObject({ ok: true });
  });

  it('a live token is refused as revoked once its connection is revoked', async () => {
    const rows = new Map<string, Record<string, unknown>>();
    const admin = fakeAdmin(rows);
    const verifier = createOwnTokenVerifier(admin, () => NOW, {
      resource: RESOURCE,
    });
    const token = `sbk_at_${randomBytes(32).toString('base64url')}`;

    rows.set(hashToken(token), {
      token_hash: hashToken(token),
      kind: 'access',
      audience: RESOURCE,
      expires_at: new Date(NOW.getTime() + 3600_000).toISOString(),
      revoked_at: null,
      connection: {
        id: CONNECTION,
        user_id: USER,
        account_id: TEAM,
        kind: 'oauth',
        name: 'Claude',
        scopes: ['studio:read'],
        revoked_at: NOW.toISOString(),
      },
    });

    expect(await verifier.verify(token)).toEqual({
      ok: false,
      reason: 'revoked',
    });
  });
});
