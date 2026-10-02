import {
  decodeProtectedHeader,
  exportPKCS8,
  generateKeyPair,
  jwtVerify,
} from 'jose';
import { afterEach, describe, expect, it } from 'vitest';

import {
  MCP_USER_JWT_TTL_SECONDS,
  createAsymmetricSigner,
  createHs256Signer,
  createMcpJwtSigner,
} from '../src/server/jwt';

/**
 * FILM-1907 criterion 11: the RLS JWT is signed with the legacy shared
 * secret or with a private key imported into the project's JWT signing
 * keys, selected by env, with the kid set. The live half (PostgREST
 * accepting each) is the integration script; this proves what a unit test
 * can: the token verifies against the matching public key, carries the
 * header Supabase needs to pick the key, and the claims GoTrue's tokens
 * carry.
 */
const USER = '11111111-1111-4111-8111-111111111111';
const CONNECTION = '33333333-3333-4333-8333-333333333333';
const ISSUER = 'http://127.0.0.1:55321/auth/v1';

const ENV_KEYS = [
  'MCP_JWT_PRIVATE_KEY',
  'MCP_JWT_KID',
  'MCP_JWT_ALG',
  'SUPABASE_JWT_SECRET',
  'NEXT_PUBLIC_SUPABASE_URL',
] as const;
const saved = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

describe.each(['ES256', 'RS256'] as const)('asymmetric signer: %s', (alg) => {
  it('signs a 5-minute user token that verifies against the public key and names its kid', async () => {
    const { privateKey, publicKey } = await generateKeyPair(alg, { extractable: true });
    const pem = await exportPKCS8(privateKey);

    const signer = await createAsymmetricSigner({
      privateKeyPem: pem,
      kid: 'storybook-mcp-2026-10',
      alg,
      issuer: ISSUER,
    });

    expect(signer.kind).toBe('asymmetric-key');

    const jwt = await signer.sign({ userId: USER, connectionId: CONNECTION });
    const header = decodeProtectedHeader(jwt);

    expect(header).toMatchObject({ alg, kid: 'storybook-mcp-2026-10', typ: 'JWT' });

    const { payload } = await jwtVerify(jwt, publicKey, {
      issuer: ISSUER,
      audience: 'authenticated',
    });

    expect(payload.sub).toBe(USER);
    expect(payload.role).toBe('authenticated');
    expect(payload.app_metadata).toEqual({
      provider: 'mcp',
      mcp_connection_id: CONNECTION,
    });
    expect(payload.exp! - payload.iat!).toBe(MCP_USER_JWT_TTL_SECONDS);
  });

  it('refuses a key that does not match the algorithm', async () => {
    const other = alg === 'ES256' ? 'RS256' : 'ES256';
    const { privateKey } = await generateKeyPair(other, { extractable: true });

    await expect(
      createAsymmetricSigner({
        privateKeyPem: await exportPKCS8(privateKey),
        kid: 'k',
        alg,
        issuer: ISSUER,
      }),
    ).rejects.toThrow();
  });
});

describe('the signer the environment selects', () => {
  it('is HS256 with the shared secret when no private key is set', async () => {
    delete process.env.MCP_JWT_PRIVATE_KEY;
    process.env.SUPABASE_JWT_SECRET = 'super-secret-jwt-token-with-at-least-32-characters-long';
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:55321';

    const signer = createMcpJwtSigner();

    expect(signer.kind).toBe('hs256-secret');

    const jwt = await signer.sign({ userId: USER, connectionId: CONNECTION });
    expect(decodeProtectedHeader(jwt)).toMatchObject({ alg: 'HS256' });
    expect(decodeProtectedHeader(jwt).kid).toBeUndefined();
  });

  it('is the asymmetric signer when MCP_JWT_PRIVATE_KEY and MCP_JWT_KID are set, and the kid is required', async () => {
    const { privateKey, publicKey } = await generateKeyPair('ES256', { extractable: true });

    // The usual way a PEM lands in an env file: newlines escaped.
    process.env.MCP_JWT_PRIVATE_KEY = (await exportPKCS8(privateKey)).replace(/\n/g, '\\n');
    process.env.MCP_JWT_KID = 'imported-key';
    delete process.env.MCP_JWT_ALG;
    process.env.SUPABASE_JWT_SECRET = 'super-secret-jwt-token-with-at-least-32-characters-long';
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:55321';

    const signer = createMcpJwtSigner();

    expect(signer.kind).toBe('asymmetric-key');

    const jwt = await signer.sign({ userId: USER, connectionId: CONNECTION });
    expect(decodeProtectedHeader(jwt)).toMatchObject({ alg: 'ES256', kid: 'imported-key' });
    await expect(jwtVerify(jwt, publicKey, { issuer: ISSUER })).resolves.toBeDefined();

    delete process.env.MCP_JWT_KID;
    expect(() => createMcpJwtSigner()).toThrow(/MCP_JWT_KID/);
  });
});

describe('HS256 signer', () => {
  it('still signs with the shared secret', async () => {
    const signer = createHs256Signer({
      secret: 'super-secret-jwt-token-with-at-least-32-characters-long',
      issuer: ISSUER,
    });

    const jwt = await signer.sign({ userId: USER, connectionId: CONNECTION });

    const { payload } = await jwtVerify(
      jwt,
      new TextEncoder().encode('super-secret-jwt-token-with-at-least-32-characters-long'),
      { issuer: ISSUER, audience: 'authenticated' },
    );

    expect(payload.sub).toBe(USER);
  });
});
