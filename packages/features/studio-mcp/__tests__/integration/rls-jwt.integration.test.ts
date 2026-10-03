import { type JWK, exportPKCS8, generateKeyPair, importJWK } from 'jose';
import { createHash, randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import {
  createAsymmetricSigner,
  createHs256Signer,
} from '../../src/server/jwt';
import { createUserScopedClient } from '../../src/server/user-client';

/**
 * FILM-1907 criterion 11, the live half: a JWT minted by our signer is one
 * PostgREST accepts, and `auth.uid()` and RLS see the minted user. Runs
 * against a real Supabase stack, so it is skipped unless
 * `MCP_INTEGRATION_SUPABASE_URL` is set (run it under the db lock):
 *
 *   MCP_INTEGRATION_SUPABASE_URL=http://127.0.0.1:55421 \
 *     npx vitest run __tests__/integration
 *
 * The shared secret path is proven first. The signing-key path is proven
 * two ways: an ES256 key the stack does not hold is refused with the error
 * a wrong `kid` produces; and, when `MCP_INTEGRATION_SIGNING_JWK` carries
 * the private JWK of a key in the stack's signing set (the local CLI
 * generates one: `docker inspect supabase_auth_<project>` →
 * `GOTRUE_JWT_KEYS`; PostgREST verifies against the same set), a token our
 * asymmetric signer mints with that key and its `kid` runs the user under
 * RLS exactly as the HS256 one does.
 */
const SUPABASE_URL = process.env.MCP_INTEGRATION_SUPABASE_URL;

const ANON_KEY =
  process.env.MCP_INTEGRATION_ANON_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';
const SERVICE_ROLE_KEY =
  process.env.MCP_INTEGRATION_SERVICE_ROLE_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';
const JWT_SECRET =
  process.env.MCP_INTEGRATION_JWT_SECRET ??
  'super-secret-jwt-token-with-at-least-32-characters-long';

async function post(path: string, key: string, body: unknown, token?: string) {
  const response = await fetch(`${SUPABASE_URL}${path}`, {
    method: 'POST',
    headers: {
      apikey: key,
      Authorization: `Bearer ${token ?? key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const text = await response.text();

  if (!response.ok)
    throw new Error(`${path} failed (${response.status}): ${text}`);

  return text ? JSON.parse(text) : null;
}

/** A token hash no earlier run of this file left behind (token_hash is the key). */
function freshHash() {
  return createHash('sha256').update(randomUUID()).digest('hex');
}

async function seedUserWithTeam() {
  const email = `mcp-rls-${randomUUID()}@makerkit.dev`;
  const password = 'password';
  const user = await post('/auth/v1/admin/users', SERVICE_ROLE_KEY, {
    email,
    password,
    email_confirm: true,
  });
  const session = await post('/auth/v1/token?grant_type=password', ANON_KEY, {
    email,
    password,
  });
  const team = await post(
    '/rest/v1/rpc/create_team_account',
    ANON_KEY,
    { account_name: `RLS ${randomUUID().slice(0, 8)}` },
    session.access_token,
  );

  return { userId: user.id as string, teamId: team.id as string };
}

describe.skipIf(!SUPABASE_URL)('minted RLS JWT against local Supabase', () => {
  const issuer = `${SUPABASE_URL}/auth/v1`;

  function withEnv() {
    process.env.NEXT_PUBLIC_SUPABASE_URL = SUPABASE_URL;
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = ANON_KEY;
  }

  it('HS256 with the shared secret: PostgREST runs the minted user, auth.uid() is them, RLS shows their team only', async () => {
    withEnv();
    const me = await seedUserWithTeam();
    const other = await seedUserWithTeam();

    const signer = createHs256Signer({ secret: JWT_SECRET, issuer });
    const jwt = await signer.sign({
      userId: me.userId,
      connectionId: randomUUID(),
    });
    const client = createUserScopedClient(jwt);

    const membership = await client.rpc('has_role_on_account', {
      account_id: me.teamId,
    });
    expect(membership.error).toBeNull();
    expect(membership.data).toBe(true);

    const notMine = await client.rpc('has_role_on_account', {
      account_id: other.teamId,
    });
    expect(notMine.data).toBe(false);

    // user_accounts is `where membership.user_id = auth.uid()`
    const teams = await client.from('user_accounts').select('id');
    expect(teams.error).toBeNull();
    expect(teams.data?.map((row) => row.id)).toEqual([me.teamId]);

    // create_mcp_personal_access_token binds the row to auth.uid()
    const created = await client.rpc('create_mcp_personal_access_token', {
      p_account_id: me.teamId,
      p_name: 'rls proof',
      p_scopes: ['studio:read'],
      p_token_hash: freshHash(),
    });
    expect(created.error).toBeNull();
    expect(created.data?.user_id).toBe(me.userId);

    // and RLS on mcp_connections shows the minted user their own row only
    const mine = await client.from('mcp_connections').select('id, user_id');
    expect(mine.error).toBeNull();
    expect(mine.data?.every((row) => row.user_id === me.userId)).toBe(true);
    expect(mine.data?.length).toBe(1);
  });

  it('ES256 with a key the stack has not imported: PostgREST refuses the token, as it must', async () => {
    withEnv();
    const me = await seedUserWithTeam();
    const { privateKey } = await generateKeyPair('ES256', {
      extractable: true,
    });
    const signer = await createAsymmetricSigner({
      privateKeyPem: await exportPKCS8(privateKey),
      kid: 'not-imported',
      alg: 'ES256',
      issuer,
    });
    const jwt = await signer.sign({
      userId: me.userId,
      connectionId: randomUUID(),
    });
    const client = createUserScopedClient(jwt);

    const result = await client.rpc('has_role_on_account', {
      account_id: me.teamId,
    });

    expect(result.error).not.toBeNull();
    expect(result.error?.code).toBe('PGRST301');
  });

  const SIGNING_JWK = process.env.MCP_INTEGRATION_SIGNING_JWK;

  it.skipIf(!SIGNING_JWK)(
    "ES256 with a key in the stack's signing set and its kid: PostgREST runs the minted user under RLS",
    async () => {
      withEnv();
      const me = await seedUserWithTeam();
      const other = await seedUserWithTeam();
      const keys = JSON.parse(SIGNING_JWK!) as JWK | JWK[];
      const jwk = (Array.isArray(keys) ? keys[0] : keys)!;
      // GoTrue's JWK lists both usages; WebCrypto imports a private ECDSA
      // key for signing only
      const { key_ops: _keyOps, use: _use, ...privateJwk } = jwk;
      const privateKey = await importJWK(privateJwk, 'ES256', {
        extractable: true,
      });

      const signer = await createAsymmetricSigner({
        privateKeyPem: await exportPKCS8(privateKey as CryptoKey),
        kid: jwk.kid!,
        alg: 'ES256',
        issuer,
      });
      expect(signer.kind).toBe('asymmetric-key');

      const jwt = await signer.sign({
        userId: me.userId,
        connectionId: randomUUID(),
      });
      const client = createUserScopedClient(jwt);

      const membership = await client.rpc('has_role_on_account', {
        account_id: me.teamId,
      });
      expect(membership.error).toBeNull();
      expect(membership.data).toBe(true);

      const notMine = await client.rpc('has_role_on_account', {
        account_id: other.teamId,
      });
      expect(notMine.data).toBe(false);

      const teams = await client.from('user_accounts').select('id');
      expect(teams.error).toBeNull();
      expect(teams.data?.map((row) => row.id)).toEqual([me.teamId]);

      const created = await client.rpc('create_mcp_personal_access_token', {
        p_account_id: me.teamId,
        p_name: 'rls proof es256',
        p_scopes: ['studio:read'],
        p_token_hash: freshHash(),
      });
      expect(created.error).toBeNull();
      expect(created.data?.user_id).toBe(me.userId);
    },
  );
});
