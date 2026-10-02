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
  /** Returned by the update that stores refreshed tokens, when set. */
  const failures: {
    tokenWrite: unknown;
    insert: unknown;
    /** A single-row read of this id fails with `error` (KB-161). */
    read: { id: string; error: unknown } | null;
  } = {
    tokenWrite: null,
    insert: null,
    read: null,
  };

  interface Result {
    data: unknown;
    error: unknown;
  }

  class Query {
    private op: 'select' | 'update' | 'insert' = 'select';
    private patch: Row = {};
    private returning = false;
    private readonly filters: Array<(row: Row) => boolean> = [];
    private sortColumn: string | null = null;
    private id: unknown;

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

    insert(row: Row) {
      this.op = 'insert';
      this.patch = row;
      return this;
    }

    eq(column: string, value: unknown) {
      if (column === 'id') this.id = value;
      this.filters.push((row) => row[column] === value);
      return this;
    }

    /** Only the `is null` form the cron job's select uses. */
    not(column: string, operator: 'is', value: null) {
      this.filters.push((row) => row[column] !== value);
      return this;
    }

    /** ISO timestamps, which compare correctly as strings. */
    lt(column: string, value: string) {
      this.filters.push((row) => String(row[column]) < value);
      return this;
    }

    order(column: string) {
      this.sortColumn = column;
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
        this.filters.every((matches) => matches(row)),
      );

      if (this.op === 'insert') {
        if (failures.insert) return { data: null, error: failures.insert };
        (tables[this.table] ??= []).push({ ...this.patch });
        return { data: null, error: null };
      }

      if (this.op === 'update') {
        if (failures.tokenWrite && 'access_token_encrypted' in this.patch) {
          return { data: null, error: failures.tokenWrite };
        }
        for (const row of rows) Object.assign(row, this.patch);
        updates.push({ table: this.table, patch: this.patch });
        return { data: this.returning ? rows : null, error: null };
      }

      if (this.sortColumn) {
        const column = this.sortColumn;
        rows.sort((a, b) => String(a[column]).localeCompare(String(b[column])));
      }

      if (mode === 'many') return { data: rows, error: null };
      if (failures.read && failures.read.id === this.id) {
        return { data: null, error: failures.read.error };
      }
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
      failures,
      client: { from: (table: string) => new Query(table) },
      reset() {
        for (const key of Object.keys(tables)) delete tables[key];
        updates.length = 0;
        failures.tokenWrite = null;
        failures.insert = null;
        failures.read = null;
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

/** X's token endpoint issues a new refresh token on every call. */
const x = { issued: 0, omitRefreshToken: false };

function vendorResponse(path: string) {
  if (vendorStatus !== 200) {
    return { error: 'invalid_grant', error_description: 'Token revoked' };
  }

  if (path === '/2/oauth2/token') {
    x.issued += 1;
    return {
      token_type: 'bearer',
      access_token: `x-access-token-${x.issued}`,
      ...(!x.omitRefreshToken && {
        refresh_token: `x-rotated-refresh-token-${x.issued}`,
      }),
      expires_in: 7200,
      scope: 'tweet.read tweet.write users.read offline.access',
    };
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
  x.issued = 0;
  x.omitRefreshToken = false;
  logged.error.length = 0;
  logged.warn.length = 0;
  logged.info.length = 0;

  vi.stubEnv('NODE_ENV', 'test');
  vi.stubEnv('VENDOR_SANDBOX', '1');
  for (const vendor of [
    'GOOGLE_TOKEN',
    'TIKTOK',
    'META_GRAPH',
    'X_API',
    'X_OAUTH',
  ]) {
    vi.stubEnv(`VENDOR_URL_${vendor}`, origin);
  }
  vi.stubEnv('ENCRYPTION_KEY', randomBytes(32).toString('base64'));
  vi.stubEnv('TIKTOK_CLIENT_KEY', 'env-tiktok-client-key');
  vi.stubEnv('TIKTOK_CLIENT_SECRET', 'env-tiktok-client-secret');
  vi.stubEnv('TWITTER_CLIENT_ID', 'env-x-client-id');
  vi.stubEnv('TWITTER_CLIENT_SECRET', 'env-x-client-secret');

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
async function seedGlobalCredentials(platform: 'youtube' | 'meta' | 'tiktok') {
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

/** Adds a connection beside any already seeded, `minutesLeft` from expiry. */
async function addConnection(platform: string, minutesLeft: number) {
  const connection = {
    id: `conn-${platform}-${minutesLeft}`,
    account_id: 'account-1',
    platform,
    platform_account_id: `${platform}-account`,
    access_token_encrypted: await encrypt('old-access-token'),
    refresh_token_encrypted: await encrypt('old-refresh-token'),
    is_active: true,
    token_expires_at: new Date(Date.now() + minutesLeft * 60_000).toISOString(),
    metadata: {},
    updated_at: '2026-09-01T00:00:00.000Z',
  };

  fakeDb.tables.platform_connections = [
    ...(fakeDb.tables.platform_connections ?? []),
    connection,
  ];
  return connection;
}

function storedConnection() {
  return fakeDb.tables.platform_connections![0]!;
}

async function decrypted(field: string, row: Row = storedConnection()) {
  const { decrypt } = await import('@kit/shared/crypto');
  return decrypt(row[field] as string);
}

describe('formatPlatformName', () => {
  it.each([
    ['youtube', 'YouTube'],
    ['tiktok', 'TikTok'],
    ['instagram', 'Instagram'],
    ['facebook', 'Facebook'],
    ['twitter', 'X'],
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

  /**
   * KB-161. `.single()` reports a missing row as PGRST116; anything else is a
   * read that failed, which says nothing about whether the connection exists.
   */
  it('throws a failed read rather than answering NOT_FOUND', async () => {
    await seedExpiredConnection('youtube');
    fakeDb.failures.read = {
      id: 'conn-youtube',
      error: {
        code: '57014',
        message: 'canceling statement due to statement timeout',
      },
    };

    await expect(tokenRefresh.ensureValidToken('conn-youtube')).rejects.toThrow(
      'Platform connection not found: the read failed (canceling statement due to statement timeout)',
    );
    expect(storedConnection().is_active).toBe(true);
    expect(fakeDb.updates).toHaveLength(0);
    expect(requests).toHaveLength(0);
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

  it('Instagram exchanges its user token with the global Meta app on the pinned Graph version, then reads the page token', async () => {
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
    // FILM-1728: the token rides in the header, never in the URL.
    expect(pages!.query.get('access_token')).toBeNull();
    expect(pages!.authorization).toBe('Bearer new-access-token');

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

  // FILM-717: LinkedIn is removed, and its rows are kept. Such a token is
  // never refreshed, the row is not torn down and nobody is told to reconnect.
  it('refuses a kept row on a removed platform, without a vendor call', async () => {
    await seedExpiredConnection('linkedin');

    const result = await tokenRefresh.ensureValidToken('conn-linkedin', true);

    expect(result).toEqual({ valid: false, error: 'PLATFORM_UNSUPPORTED' });
    expect(requests).toHaveLength(0);
    expect(storedConnection().is_active).toBe(true);
    expect(fakeDb.tables.notifications ?? []).toEqual([]);
  });
});

describe('a TikTok app saved at /admin/platforms (KB-36)', () => {
  const tiktokForm = (clientKey: string, clientSecret: string) => ({
    client_key: clientKey,
    client_secret: clientSecret,
    refresh_token: 'old-refresh-token',
    grant_type: 'refresh_token',
  });

  it('refreshes with the saved TikTok app when no env keys are set', async () => {
    vi.stubEnv('TIKTOK_CLIENT_KEY', '');
    vi.stubEnv('TIKTOK_CLIENT_SECRET', '');
    await seedGlobalCredentials('tiktok');
    await seedExpiredConnection('tiktok');

    const result = await tokenRefresh.ensureValidToken('conn-tiktok');

    expect(result).toEqual({ valid: true, accessToken: 'new-access-token' });
    expect(requests).toHaveLength(1);
    expect(Object.fromEntries(requests[0]!.form)).toEqual(
      tiktokForm('global-tiktok-client-id', 'global-tiktok-client-secret'),
    );
  });

  it('prefers the saved TikTok app to the env keys', async () => {
    await seedGlobalCredentials('tiktok');
    await seedExpiredConnection('tiktok');

    await tokenRefresh.ensureValidToken('conn-tiktok');

    expect(requests).toHaveLength(1);
    expect(Object.fromEntries(requests[0]!.form)).toEqual(
      tiktokForm('global-tiktok-client-id', 'global-tiktok-client-secret'),
    );
  });

  it('treats a saved TikTok app it cannot decrypt as not configured, without falling back to env', async () => {
    fakeDb.tables.oauth_app_credentials = [
      {
        platform: 'tiktok',
        client_id: 'global-tiktok-client-id',
        client_secret_encrypted: 'not-a-ciphertext',
      },
    ];
    await seedExpiredConnection('tiktok');

    const result = await tokenRefresh.ensureValidToken('conn-tiktok');

    expect(result).toEqual({
      valid: false,
      error: 'APP_NOT_CONFIGURED',
      requiresReauth: false,
    });
    expect(requests).toHaveLength(0);
    expect(storedConnection().is_active).toBe(true);
  });

  it('configures every app the admin page offers from a saved row alone', async () => {
    const { SAVED_CREDENTIAL_APPS } = await import('../src/oauth/apps');
    const { getOAuthAppCredentials } = await import(
      '../src/server/oauth-app-credentials'
    );
    vi.stubEnv('TIKTOK_CLIENT_KEY', '');
    vi.stubEnv('TIKTOK_CLIENT_SECRET', '');

    for (const app of SAVED_CREDENTIAL_APPS) {
      await seedGlobalCredentials(app);
      expect(await getOAuthAppCredentials(app), app).toEqual({
        clientId: `global-${app}-client-id`,
        clientSecret: `global-${app}-client-secret`,
      });
    }
  });

  it('tells the admin page where each app is configured from, without a secret', async () => {
    const { getSavedCredentialAppSources } = await import(
      '../src/server/oauth-app-credentials'
    );

    // tiktok: env only; meta: nothing; youtube: saved
    await seedGlobalCredentials('youtube');
    expect(await getSavedCredentialAppSources()).toEqual({
      youtube: 'saved',
      tiktok: 'env',
      meta: 'none',
    });

    await seedGlobalCredentials('tiktok');
    fakeDb.tables.oauth_app_credentials!.push({
      platform: 'meta',
      client_id: 'global-meta-client-id',
      client_secret_encrypted: 'not-a-ciphertext',
    });
    const sources = await getSavedCredentialAppSources();
    expect(sources).toEqual({
      youtube: 'saved',
      tiktok: 'saved',
      meta: 'unreadable',
    });
    expect(JSON.stringify(sources)).not.toContain('secret');
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
      credentialSource:
        "oauth_app_credentials['tiktok'] or TIKTOK_CLIENT_KEY / TIKTOK_CLIENT_SECRET",
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

/**
 * KB-15. X was missing from refresh altogether: every X connection hit
 * `Unknown platform: twitter` and was deactivated at its first expiry.
 */
describe('X refresh (KB-15)', () => {
  const xBasic = `Basic ${Buffer.from('env-x-client-id:env-x-client-secret').toString('base64')}`;

  it('refreshes an expired X connection with Basic auth from the env app connect uses', async () => {
    await seedExpiredConnection('twitter');

    const result = await tokenRefresh.ensureValidToken('conn-twitter');

    expect(result).toEqual({ valid: true, accessToken: 'x-access-token-1' });
    expect(requests).toHaveLength(1);
    expect(requests[0]!.method).toBe('POST');
    expect(requests[0]!.path).toBe('/2/oauth2/token');
    expect(requests[0]!.authorization).toBe(xBasic);
    // A confidential client sends no id or secret in the body.
    expect(Object.fromEntries(requests[0]!.form)).toEqual({
      grant_type: 'refresh_token',
      refresh_token: 'old-refresh-token',
    });

    expect(storedConnection().is_active).toBe(true);
    expect(await decrypted('access_token_encrypted')).toBe('x-access-token-1');
    const expiresInMs =
      Date.parse(storedConnection().token_expires_at as string) - Date.now();
    expect(expiresInMs).toBeGreaterThan(7190 * 1000);
    expect(expiresInMs).toBeLessThanOrEqual(7200 * 1000);
    expect(JSON.stringify(logged)).not.toContain('env-x-client-secret');
  });

  it('stores the rotated refresh token, and the next refresh sends it', async () => {
    await seedExpiredConnection('twitter');

    await tokenRefresh.ensureValidToken('conn-twitter');
    const second = await tokenRefresh.ensureValidToken('conn-twitter', true);

    expect(second).toEqual({ valid: true, accessToken: 'x-access-token-2' });
    expect(requests.map((r) => r.form.get('refresh_token'))).toEqual([
      'old-refresh-token',
      'x-rotated-refresh-token-1',
    ]);
    expect(await decrypted('refresh_token_encrypted')).toBe(
      'x-rotated-refresh-token-2',
    );
  });

  it('keeps the stored refresh token when X returns none', async () => {
    x.omitRefreshToken = true;
    await seedExpiredConnection('twitter');

    const result = await tokenRefresh.ensureValidToken('conn-twitter');

    expect(result.valid).toBe(true);
    expect(await decrypted('refresh_token_encrypted')).toBe(
      'old-refresh-token',
    );
  });

  it('deactivates the connection when X refuses the refresh token, and says so', async () => {
    await seedExpiredConnection('twitter');
    vendorStatus = 400;

    const result = await tokenRefresh.ensureValidToken('conn-twitter');

    expect(result).toEqual({
      valid: false,
      error: 'REFRESH_FAILED',
      requiresReauth: true,
    });
    expect(requests).toHaveLength(1);
    expect(storedConnection().is_active).toBe(false);

    const [context] = logged.error.at(-1)!;
    expect(String(context.error)).toContain('X refresh failed (400)');
    expect(context).toMatchObject({
      app: 'twitter',
      credentialSource: 'TWITTER_CLIENT_ID / TWITTER_CLIENT_SECRET',
    });
  });

  it('leaves the connection active when the X app is not configured', async () => {
    vi.stubEnv('TWITTER_CLIENT_SECRET', '');
    await seedExpiredConnection('twitter');

    const result = await tokenRefresh.ensureValidToken('conn-twitter');

    expect(result).toEqual({
      valid: false,
      error: 'APP_NOT_CONFIGURED',
      requiresReauth: false,
    });
    expect(requests).toHaveLength(0);
    expect(storedConnection().is_active).toBe(true);
  });

  it('refreshes an X token 4 minutes from expiry before handing it out', async () => {
    await seedExpiredConnection('twitter');
    storedConnection().token_expires_at = new Date(
      Date.now() + 4 * 60_000,
    ).toISOString();

    const result = await tokenRefresh.ensureValidToken('conn-twitter');

    expect(result).toEqual({ valid: true, accessToken: 'x-access-token-1' });
    expect(requests).toHaveLength(1);
  });
});

describe('a refresh whose tokens cannot be stored', () => {
  it('logs the lost rotated refresh token instead of dropping it silently', async () => {
    await seedExpiredConnection('tiktok');
    fakeDb.failures.tokenWrite = { message: 'connection reset' };

    const result = await tokenRefresh.ensureValidToken('conn-tiktok');

    // The new access token is valid whether or not it was stored.
    expect(result).toEqual({ valid: true, accessToken: 'new-access-token' });

    const entry = logged.error.find(
      ([, message]) => message === 'Refreshed tokens were not stored',
    );
    expect(entry?.[0]).toMatchObject({
      platform: 'tiktok',
      connectionId: 'conn-tiktok',
      refreshTokenRotated: true,
    });
  });
});

/**
 * KB-15, found reproducing it: the cron job selected tokens expiring within
 * an hour but only refreshed those within the 5-minute buffer, so it counted
 * untouched rows as refreshed and let tokens lapse for up to 25 minutes.
 */
describe('refreshExpiringTokens', () => {
  it('refreshes every connection it selects, on every platform', async () => {
    await seedGlobalCredentials('youtube');
    const youtube = await addConnection('youtube', 50);
    const twitter = await addConnection('twitter', 50);
    await addConnection('youtube', 24 * 60); // outside the window

    const { refreshExpiringTokens } = await import(
      '../src/jobs/refresh-expiring-tokens'
    );
    const result = await refreshExpiringTokens();

    expect(requests.map((r) => r.path).sort()).toEqual([
      '/2/oauth2/token',
      '/token',
    ]);
    expect(result).toEqual({ checked: 2, refreshed: 2, failed: 0 });

    for (const row of [youtube, twitter]) {
      const minutesLeft =
        (Date.parse(row.token_expires_at) - Date.now()) / 60_000;
      expect(minutesLeft).toBeGreaterThan(55);
      expect(row.is_active).toBe(true);
    }
    expect(await decrypted('refresh_token_encrypted', twitter)).toBe(
      'x-rotated-refresh-token-1',
    );
  });

  it('leaves a kept row on a removed platform out of the run (FILM-717)', async () => {
    await seedGlobalCredentials('youtube');
    await addConnection('youtube', 50);
    const linkedin = await addConnection('linkedin', 50);

    const { refreshExpiringTokens } = await import(
      '../src/jobs/refresh-expiring-tokens'
    );
    const result = await refreshExpiringTokens();

    expect(result).toEqual({ checked: 1, refreshed: 1, failed: 0 });
    expect(requests.map((r) => r.path)).toEqual(['/token']);
    expect(linkedin.is_active).toBe(true);
  });

  it('counts one failed read as one failure and refreshes the rest (KB-161)', async () => {
    await seedGlobalCredentials('youtube');
    const unread = await addConnection('twitter', 50);
    const youtube = await addConnection('youtube', 50);
    fakeDb.failures.read = {
      id: unread.id,
      error: { code: '08006', message: 'connection reset' },
    };

    const { refreshExpiringTokens } = await import(
      '../src/jobs/refresh-expiring-tokens'
    );
    const result = await refreshExpiringTokens();

    expect(result).toEqual({ checked: 2, refreshed: 1, failed: 1 });
    expect(requests.map((r) => r.path)).toEqual(['/token']);
    expect(Date.parse(youtube.token_expires_at)).toBeGreaterThan(
      Date.now() + 55 * 60_000,
    );
    expect(unread.is_active).toBe(true);
    expect(logged.error).toContainEqual([
      expect.objectContaining({
        platform: 'twitter',
        error:
          'Platform connection not found: the read failed (connection reset)',
      }),
      expect.stringContaining('Error refreshing twitter'),
    ]);
  });
});

/**
 * FILM-CC-03. A connection that needs reconnecting tells its team where to
 * do it, and a refresh that works is logged like one that fails.
 */
describe('a connection that needs reconnecting', () => {
  beforeEach(() => {
    fakeDb.tables.accounts = [{ id: 'account-1', slug: 'acme-films' }];
  });

  function notifications() {
    return fakeDb.tables.notifications ?? [];
  }

  it('notifies the team, with a link to its platforms page, when the vendor refuses the refresh token', async () => {
    await seedGlobalCredentials('youtube');
    await seedExpiredConnection('youtube');
    vendorStatus = 400;

    await tokenRefresh.ensureValidToken('conn-youtube');

    expect(notifications()).toEqual([
      {
        account_id: 'account-1',
        type: 'warning',
        body: 'Your YouTube connection has expired. Reconnect it to keep publishing.',
        link: '/home/acme-films/settings/platforms',
      },
    ]);
  });

  it('notifies the team when the connection has no refresh token to use', async () => {
    await seedExpiredConnection('twitter');
    storedConnection().refresh_token_encrypted = null;

    const result = await tokenRefresh.ensureValidToken('conn-twitter');

    expect(result).toMatchObject({ error: 'NO_REFRESH_TOKEN' });
    expect(storedConnection().is_active).toBe(false);
    expect(notifications()).toHaveLength(1);
    expect(notifications()[0]).toMatchObject({
      body: 'Your X connection has expired. Reconnect it to keep publishing.',
      link: '/home/acme-films/settings/platforms',
    });
  });

  it('does not ask the team to reconnect when the app is not configured', async () => {
    vi.stubEnv('TWITTER_CLIENT_SECRET', '');
    await seedExpiredConnection('twitter');

    await tokenRefresh.ensureValidToken('conn-twitter');

    expect(notifications()).toEqual([]);
  });

  it('still reports the failed refresh when the notification cannot be written', async () => {
    await seedExpiredConnection('twitter');
    vendorStatus = 400;
    fakeDb.failures.insert = { message: 'insert refused' };

    const result = await tokenRefresh.ensureValidToken('conn-twitter');

    expect(result).toMatchObject({ error: 'REFRESH_FAILED' });
    expect(
      logged.error.some(
        ([, message]) => message === 'Re-auth notification was not stored',
      ),
    ).toBe(true);
  });

  it('logs a refresh that succeeds', async () => {
    await seedExpiredConnection('tiktok');

    await tokenRefresh.ensureValidToken('conn-tiktok');

    const entry = logged.info.find(
      ([context]) => context.name === 'token-refresh',
    );
    expect(entry).toEqual([
      {
        name: 'token-refresh',
        platform: 'tiktok',
        connectionId: 'conn-tiktok',
        refreshTokenRotated: true,
      },
      'Refreshed tiktok token',
    ]);
    expect(notifications()).toEqual([]);
  });
});
