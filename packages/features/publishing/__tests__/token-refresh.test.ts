import { randomBytes } from 'node:crypto';
import { type Server, createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

/**
 * KB-29. Every refresh case runs the real `ensureValidToken` →
 * `refreshTokenForPlatform` path. Only two things are stood in for:
 *
 * - the vendors, by a local HTTP listener reached through the FILM-1801
 *   sandbox (`VENDOR_URL_*`), so the request the product code builds is the
 *   thing asserted - not a request this file made itself, which is what the
 *   YouTube and TikTok cases here used to do;
 * - the database, by `fakeDb`, which answers per table. A table it holds no
 *   rows for answers the way PostgREST does for a missing row. The old
 *   version of this file mocked the credential lookup to always succeed,
 *   which is how refresh reading a table nothing writes went unseen.
 *
 * `@kit/shared/crypto` is real, with a generated key.
 */

type Row = Record<string, unknown>;

const { fakeDb, logged } = vi.hoisted(() => {
  const tables: Record<string, Row[]> = {};
  const updates: Array<{ table: string; patch: Row }> = [];

  interface Result {
    data: unknown;
    error: unknown;
  }

  class Query {
    private op: 'select' | 'update' = 'select';
    private patch: Row = {};
    private returning = false;
    private readonly filters: Array<[string, unknown]> = [];

    constructor(private readonly table: string) {}

    select() {
      if (this.op === 'update') this.returning = true;
      return this;
    }

    update(patch: Row) {
      this.op = 'update';
      this.patch = patch;
      return this;
    }

    eq(column: string, value: unknown) {
      this.filters.push([column, value]);
      return this;
    }

    single() {
      return Promise.resolve(this.run('single'));
    }

    maybeSingle() {
      return Promise.resolve(this.run('maybeSingle'));
    }

    then<A = Result, B = never>(
      onfulfilled?: ((value: Result) => A | PromiseLike<A>) | null,
      onrejected?: ((reason: unknown) => B | PromiseLike<B>) | null,
    ): Promise<A | B> {
      return Promise.resolve(this.run('many')).then(onfulfilled, onrejected);
    }

    private run(mode: 'single' | 'maybeSingle' | 'many'): Result {
      const rows = (tables[this.table] ?? []).filter((row) =>
        this.filters.every(([column, value]) => row[column] === value),
      );

      if (this.op === 'update') {
        for (const row of rows) Object.assign(row, this.patch);
        updates.push({ table: this.table, patch: this.patch });
        return { data: this.returning ? rows : null, error: null };
      }

      if (mode === 'many') return { data: rows, error: null };
      if (rows[0]) return { data: { ...rows[0] }, error: null };
      if (mode === 'maybeSingle') return { data: null, error: null };

      return {
        data: null,
        error: { code: 'PGRST116', message: 'no rows returned' },
      };
    }
  }

  const logged = {
    error: [] as Array<[Row, string]>,
    warn: [] as Array<[Row, string]>,
    info: [] as Array<[Row, string]>,
  };

  return {
    fakeDb: {
      tables,
      updates,
      client: { from: (table: string) => new Query(table) },
      reset() {
        for (const key of Object.keys(tables)) delete tables[key];
        updates.length = 0;
      },
    },
    logged,
  };
});

vi.mock('@kit/supabase/server-admin-client', () => ({
  getSupabaseServerAdminClient: () => fakeDb.client,
}));

vi.mock('@kit/shared/logger', () => ({
  getLogger: async () => ({
    error: (ctx: Row, msg: string) => logged.error.push([ctx, msg]),
    warn: (ctx: Row, msg: string) => logged.warn.push([ctx, msg]),
    info: (ctx: Row, msg: string) => logged.info.push([ctx, msg]),
    debug: () => undefined,
  }),
}));

interface VendorRequest {
  method: string;
  path: string;
  query: URLSearchParams;
  form: URLSearchParams;
  authorization?: string;
}

const requests: VendorRequest[] = [];
let vendorStatus = 200;
let server: Server;
let origin: string;

function vendorResponse(path: string) {
  if (vendorStatus !== 200) {
    return { error: 'invalid_grant', error_description: 'Token revoked' };
  }

  if (path.endsWith('/me/accounts')) {
    return {
      data: [
        { id: 'page-0', access_token: 'other-page-token' },
        { id: 'page-1', access_token: 'new-page-token' },
      ],
    };
  }

  return {
    access_token: 'new-access-token',
    refresh_token: 'rotated-refresh-token',
    expires_in: 3600,
    refresh_expires_in: 31536000,
  };
}

beforeAll(async () => {
  server = createServer((request, response) => {
    let body = '';
    request.on('data', (chunk) => (body += chunk));
    request.on('end', () => {
      const url = new URL(request.url ?? '/', 'http://127.0.0.1');
      requests.push({
        method: request.method ?? '',
        path: url.pathname,
        query: url.searchParams,
        form: new URLSearchParams(body),
        authorization: request.headers.authorization,
      });
      response.statusCode = vendorStatus;
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify(vendorResponse(url.pathname)));
    });
  });

  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise((done) => server.close(done));
});

const realFetch = globalThis.fetch;
let tokenRefresh: typeof import('../src/lib/token-refresh');
let encrypt: (value: string) => Promise<string>;

beforeEach(async () => {
  fakeDb.reset();
  requests.length = 0;
  vendorStatus = 200;
  logged.error.length = 0;
  logged.warn.length = 0;
  logged.info.length = 0;

  vi.stubEnv('NODE_ENV', 'test');
  vi.stubEnv('VENDOR_SANDBOX', '1');
  for (const vendor of [
    'GOOGLE_TOKEN',
    'TIKTOK',
    'META_GRAPH',
    'LINKEDIN_OAUTH',
  ]) {
    vi.stubEnv(`VENDOR_URL_${vendor}`, origin);
  }
  vi.stubEnv('ENCRYPTION_KEY', randomBytes(32).toString('base64'));
  vi.stubEnv('TIKTOK_CLIENT_KEY', 'env-tiktok-client-key');
  vi.stubEnv('TIKTOK_CLIENT_SECRET', 'env-tiktok-client-secret');
  vi.stubEnv('LINKEDIN_CLIENT_ID', 'env-linkedin-client-id');
  vi.stubEnv('LINKEDIN_CLIENT_SECRET', 'env-linkedin-client-secret');

  // A request that escapes the sandbox fails here instead of reaching a vendor.
  vi.stubGlobal('fetch', (input: string | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    if (url.origin !== origin) {
      throw new Error(`escaped the vendor sandbox: ${url.origin}`);
    }
    return realFetch(input, init);
  });

  // The OAuth configs resolve their hosts at import, after the env above.
  vi.resetModules();
  tokenRefresh = await import('../src/lib/token-refresh');
  ({ encrypt } = await import('@kit/shared/crypto'));
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

/** A global row exactly as `/admin/platforms` writes it. */
async function seedGlobalCredentials(platform: 'youtube' | 'meta') {
  fakeDb.tables.oauth_app_credentials = [
    ...(fakeDb.tables.oauth_app_credentials ?? []),
    {
      platform,
      client_id: `global-${platform}-client-id`,
      client_secret_encrypted: await encrypt(
        `global-${platform}-client-secret`,
      ),
    },
  ];
}

async function seedExpiredConnection(platform: string, metadata: Row = {}) {
  const connection = {
    id: `conn-${platform}`,
    account_id: 'account-1',
    platform,
    platform_account_id: `${platform}-account`,
    access_token_encrypted: await encrypt('old-access-token'),
    refresh_token_encrypted: await encrypt('old-refresh-token'),
    is_active: true,
    token_expires_at: new Date(Date.now() - 60_000).toISOString(),
    metadata,
    updated_at: '2026-09-01T00:00:00.000Z',
  };

  fakeDb.tables.platform_connections = [connection];
  return connection;
}

function storedConnection() {
  return fakeDb.tables.platform_connections![0]!;
}

async function decrypted(field: string) {
  const { decrypt } = await import('@kit/shared/crypto');
  return decrypt(storedConnection()[field] as string);
}

describe('formatPlatformName', () => {
  it.each([
    ['youtube', 'YouTube'],
    ['tiktok', 'TikTok'],
    ['instagram', 'Instagram'],
    ['facebook', 'Facebook'],
    ['linkedin', 'LinkedIn'],
    ['unknown', 'unknown'],
  ])('formats %s as %s', (platform, name) => {
    expect(tokenRefresh.formatPlatformName(platform)).toBe(name);
  });
});

describe('getExpiryBuffer', () => {
  it('is 5 minutes', () => {
    expect(tokenRefresh.getExpiryBuffer()).toBe(5 * 60 * 1000);
  });
});

describe('ensureValidToken before any refresh', () => {
  it('returns NOT_FOUND when the connection does not exist', async () => {
    expect(await tokenRefresh.ensureValidToken('missing')).toEqual({
      valid: false,
      error: 'NOT_FOUND',
    });
  });

  it('returns CONNECTION_INACTIVE for an inactive connection', async () => {
    await seedExpiredConnection('youtube');
    storedConnection().is_active = false;

    expect(await tokenRefresh.ensureValidToken('conn-youtube')).toEqual({
      valid: false,
      error: 'CONNECTION_INACTIVE',
      requiresReauth: true,
    });
  });

  it('returns the stored token without calling the vendor while it is valid', async () => {
    await seedExpiredConnection('youtube');
    storedConnection().token_expires_at = new Date(
      Date.now() + 60 * 60 * 1000,
    ).toISOString();

    expect(await tokenRefresh.ensureValidToken('conn-youtube')).toEqual({
      valid: true,
      accessToken: 'old-access-token',
    });
    expect(requests).toHaveLength(0);
  });
});

/**
 * KB-29: an account connected after 2026-01-21 has no `account_oauth_apps`
 * row - nothing has written that table since - so refresh must use the
 * credentials connect used.
 */
describe('refresh uses the credentials connect uses (KB-29)', () => {
  it('YouTube refreshes with the global app, with no per-account row', async () => {
    await seedGlobalCredentials('youtube');
    await seedExpiredConnection('youtube');

    const result = await tokenRefresh.ensureValidToken('conn-youtube');

    expect(result).toEqual({ valid: true, accessToken: 'new-access-token' });
    expect(requests).toHaveLength(1);
    expect(requests[0]!.method).toBe('POST');
    expect(requests[0]!.path).toBe('/token');
    expect(Object.fromEntries(requests[0]!.form)).toEqual({
      client_id: 'global-youtube-client-id',
      client_secret: 'global-youtube-client-secret',
      refresh_token: 'old-refresh-token',
      grant_type: 'refresh_token',
    });
    expect(storedConnection().is_active).toBe(true);
    expect(await decrypted('access_token_encrypted')).toBe('new-access-token');
  });

  it('Instagram exchanges its user token with the global Meta app, then reads the page token', async () => {
    await seedGlobalCredentials('meta');
    await seedExpiredConnection('instagram', { linked_page_id: 'page-1' });

    const result = await tokenRefresh.ensureValidToken('conn-instagram');

    expect(result).toEqual({ valid: true, accessToken: 'new-page-token' });

    const [exchange, pages] = requests;
    const { META_GRAPH_VERSION } = await import('@kit/shared/vendors');

    expect(exchange!.path).toBe(`/${META_GRAPH_VERSION}/oauth/access_token`);
    expect(Object.fromEntries(exchange!.query)).toEqual({
      grant_type: 'fb_exchange_token',
      client_id: 'global-meta-client-id',
      client_secret: 'global-meta-client-secret',
      fb_exchange_token: 'old-refresh-token',
    });
    expect(pages!.path).toBe(`/${META_GRAPH_VERSION}/me/accounts`);
    expect(pages!.query.get('access_token')).toBe('new-access-token');

    // The refreshed user token is kept for the next cycle.
    expect(await decrypted('access_token_encrypted')).toBe('new-page-token');
    expect(await decrypted('refresh_token_encrypted')).toBe('new-access-token');
  });

  it('TikTok refreshes with the env app connect uses, and stores the rotated refresh token', async () => {
    await seedExpiredConnection('tiktok');

    const result = await tokenRefresh.ensureValidToken('conn-tiktok');

    expect(result).toEqual({ valid: true, accessToken: 'new-access-token' });
    expect(requests).toHaveLength(1);
    expect(requests[0]!.path).toBe('/v2/oauth/token/');
    expect(Object.fromEntries(requests[0]!.form)).toEqual({
      client_key: 'env-tiktok-client-key',
      client_secret: 'env-tiktok-client-secret',
      refresh_token: 'old-refresh-token',
      grant_type: 'refresh_token',
    });
    expect(await decrypted('refresh_token_encrypted')).toBe(
      'rotated-refresh-token',
    );
  });

  it('LinkedIn refreshes with the env app connect uses', async () => {
    await seedExpiredConnection('linkedin');

    const result = await tokenRefresh.ensureValidToken('conn-linkedin');

    expect(result).toEqual({ valid: true, accessToken: 'new-access-token' });
    expect(requests).toHaveLength(1);
    expect(requests[0]!.path).toBe('/oauth/v2/accessToken');
    expect(Object.fromEntries(requests[0]!.form)).toEqual({
      grant_type: 'refresh_token',
      refresh_token: 'old-refresh-token',
      client_id: 'env-linkedin-client-id',
      client_secret: 'env-linkedin-client-secret',
    });
  });
});

describe('a refresh that cannot happen', () => {
  it('leaves the connection active when the app is not configured, and says which source is missing', async () => {
    await seedExpiredConnection('youtube');

    const result = await tokenRefresh.ensureValidToken('conn-youtube');

    expect(result).toEqual({
      valid: false,
      error: 'APP_NOT_CONFIGURED',
      requiresReauth: false,
    });
    expect(requests).toHaveLength(0);
    expect(storedConnection().is_active).toBe(true);
    expect(storedConnection().metadata).not.toHaveProperty('is_refreshing');
    expect(storedConnection().metadata).not.toHaveProperty(
      'refresh_started_at',
    );

    const [context] = logged.error.at(-1)!;
    expect(context).toMatchObject({
      app: 'youtube',
      credentialSource: "oauth_app_credentials['youtube']",
    });
  });

  it('names the env variables when an env-backed app is not configured, and logs no secret', async () => {
    vi.stubEnv('TIKTOK_CLIENT_SECRET', '');
    await seedExpiredConnection('tiktok');

    const result = await tokenRefresh.ensureValidToken('conn-tiktok');

    expect(result.error).toBe('APP_NOT_CONFIGURED');
    expect(storedConnection().is_active).toBe(true);

    const [context, message] = logged.error.at(-1)!;
    expect(context).toMatchObject({
      app: 'tiktok',
      credentialSource: 'TIKTOK_CLIENT_KEY / TIKTOK_CLIENT_SECRET',
    });
    expect(JSON.stringify([context, message])).not.toContain(
      'env-tiktok-client-key',
    );
  });

  it('deactivates the connection when the vendor refuses the refresh token', async () => {
    await seedGlobalCredentials('youtube');
    await seedExpiredConnection('youtube');
    vendorStatus = 400;

    const result = await tokenRefresh.ensureValidToken('conn-youtube');

    expect(result).toEqual({
      valid: false,
      error: 'REFRESH_FAILED',
      requiresReauth: true,
    });
    expect(requests).toHaveLength(1);
    expect(storedConnection().is_active).toBe(false);
    expect(storedConnection().metadata).not.toHaveProperty('is_refreshing');
  });
});
