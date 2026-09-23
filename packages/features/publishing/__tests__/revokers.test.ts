import { type Server, createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import { VENDOR_REVOKES } from '../src/components/disconnect-copy';
import type { PlatformType } from '../src/types';

/**
 * KB-22 / KB-45. Each platform's revoke call is sent to a local listener
 * standing in for the vendor (FILM-1801's `VENDOR_URL_*`), so what is checked
 * is the request the real code makes and how it reads the answer — before
 * KB-22 the answer was never read, and a refusal looked like success.
 */

vi.mock('@kit/shared/crypto', () => ({
  decrypt: vi.fn(async (value: string) => {
    if (value === 'not-decryptable') throw new Error('bad ciphertext');
    return value.replace(/^enc:/, '');
  }),
}));

interface Seen {
  method: string;
  path: string;
  query: string;
  body: string;
}

const seen: Seen[] = [];
let answerStatus = 200;
let server: Server;
let origin: string;

beforeAll(async () => {
  server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://listener');
    let body = '';

    request.on('data', (chunk) => (body += chunk));
    request.on('end', () => {
      seen.push({
        method: request.method ?? '',
        path: url.pathname,
        query: url.search,
        body,
      });
      response.statusCode = answerStatus;
      response.end('{}');
    });
  });

  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise((done) => server.close(done));
});

afterEach(() => {
  seen.length = 0;
  answerStatus = 200;
  vi.unstubAllEnvs();
  vi.resetModules();
});

async function sandboxedRevokers(extraEnv: Record<string, string> = {}) {
  vi.stubEnv('NODE_ENV', 'test');
  vi.stubEnv('VENDOR_SANDBOX', '1');
  vi.stubEnv('VENDOR_URL_GOOGLE_TOKEN', origin);
  vi.stubEnv('VENDOR_URL_TIKTOK', origin);
  vi.stubEnv('VENDOR_URL_META_GRAPH', origin);
  // Anything that escapes to a real host is refused here instead of sent.
  vi.stubEnv('HTTPS_PROXY', origin);
  vi.stubEnv('NO_PROXY', '127.0.0.1');

  for (const [name, value] of Object.entries(extraEnv)) {
    vi.stubEnv(name, value);
  }

  vi.resetModules();

  return import('../src/oauth/revokers');
}

describe('revokeAtVendor', () => {
  it('revokes a YouTube grant at Google, and says so when Google agrees', async () => {
    const { revokeAtVendor } = await sandboxedRevokers();

    const outcome = await revokeAtVendor({
      platform: 'youtube',
      access_token_encrypted: 'enc:ya29.token',
    });

    expect(outcome).toEqual({ status: 'revoked', httpStatus: 200 });
    expect(seen).toEqual([
      { method: 'POST', path: '/revoke', query: '?token=ya29.token', body: '' },
    ]);
  });

  it('reports a refusal as a refusal, not as success (KB-45)', async () => {
    const { revokeAtVendor } = await sandboxedRevokers();
    answerStatus = 400;

    const outcome = await revokeAtVendor({
      platform: 'youtube',
      access_token_encrypted: 'enc:already-dead',
    });

    expect(outcome).toEqual({ status: 'vendor_refused', httpStatus: 400 });
  });

  it('removes the Facebook login’s permissions for Instagram and Facebook alike', async () => {
    const { revokeAtVendor } = await sandboxedRevokers();

    await revokeAtVendor({
      platform: 'instagram',
      access_token_encrypted: 'enc:page-token',
    });
    await revokeAtVendor({
      platform: 'facebook',
      access_token_encrypted: 'enc:page-token',
    });

    expect(seen.map((request) => `${request.method} ${request.path}`)).toEqual(
      [
        expect.stringMatching(/^DELETE \/v[\d.]+\/me\/permissions$/),
        expect.stringMatching(/^DELETE \/v[\d.]+\/me\/permissions$/),
      ],
    );
    expect(seen[0]?.query).toBe('?access_token=page-token');
  });

  it('sends TikTok the app credentials with the token', async () => {
    const { revokeAtVendor } = await sandboxedRevokers({
      TIKTOK_CLIENT_KEY: 'test-key',
      TIKTOK_CLIENT_SECRET: 'test-secret',
    });

    const outcome = await revokeAtVendor({
      platform: 'tiktok',
      access_token_encrypted: 'enc:act.token',
    });

    expect(outcome.status).toBe('revoked');
    expect(seen[0]?.path).toBe('/v2/oauth/revoke/');
    expect(Object.fromEntries(new URLSearchParams(seen[0]?.body))).toEqual({
      client_key: 'test-key',
      client_secret: 'test-secret',
      token: 'act.token',
    });
  });

  it('does not call TikTok without the app credentials, and says why', async () => {
    const { revokeAtVendor } = await sandboxedRevokers();

    const outcome = await revokeAtVendor({
      platform: 'tiktok',
      access_token_encrypted: 'enc:act.token',
    });

    expect(outcome).toEqual({ status: 'not_configured' });
    expect(seen).toEqual([]);
  });

  it('calls nobody for X and LinkedIn yet (KB-25)', async () => {
    const { revokeAtVendor } = await sandboxedRevokers();

    for (const platform of ['twitter', 'linkedin'] as const) {
      expect(
        await revokeAtVendor({ platform, access_token_encrypted: 'enc:t' }),
      ).toEqual({ status: 'not_implemented' });
    }

    expect(seen).toEqual([]);
  });

  it('reports an unreachable vendor instead of throwing', async () => {
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('VENDOR_SANDBOX', '1');
    // A port nothing listens on.
    vi.stubEnv('VENDOR_URL_GOOGLE_TOKEN', 'http://127.0.0.1:9');
    vi.resetModules();
    const { revokeAtVendor } = await import('../src/oauth/revokers');

    expect(
      await revokeAtVendor({
        platform: 'youtube',
        access_token_encrypted: 'enc:t',
      }),
    ).toEqual({ status: 'unreachable' });
  });

  it('has nothing to revoke without a token, or one it cannot read', async () => {
    const { revokeAtVendor } = await sandboxedRevokers();

    expect(
      await revokeAtVendor({ platform: 'youtube', access_token_encrypted: null }),
    ).toEqual({ status: 'no_token' });
    expect(
      await revokeAtVendor({
        platform: 'youtube',
        access_token_encrypted: 'not-decryptable',
      }),
    ).toEqual({ status: 'undecryptable' });
    expect(seen).toEqual([]);
  });
});

describe('the dialog and the behaviour agree about revocation', () => {
  it('VENDOR_REVOKES says "we ask the platform" exactly where REVOKERS does', async () => {
    const { REVOKERS, revokesAtVendor } = await sandboxedRevokers();

    const platforms = Object.keys(REVOKERS) as PlatformType[];

    expect(platforms.sort()).toEqual(
      (Object.keys(VENDOR_REVOKES) as PlatformType[]).sort(),
    );

    for (const platform of platforms) {
      expect({ platform, revokes: revokesAtVendor(platform) }).toEqual({
        platform,
        revokes: VENDOR_REVOKES[platform],
      });
    }
  });
});
