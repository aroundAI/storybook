import { NextRequest } from 'next/server';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * FILM-706, FILM-707. The failure branches of every OAuth callback
 * are driven in a browser (`connect-failure.spec.ts`); these drive the
 * success branch of TikTok's and Meta's against mocked vendor endpoints and
 * read what each writes to `platform_connections` and where it lands. Meta's includes the Instagram-to-Page link (FILM-707).
 */

const state = vi.hoisted(() => ({
  stored: [] as Array<Record<string, unknown>>,
  storeResult: { error: null } as { error: unknown },
  deletedNonces: [] as string[],
  storedState: {} as Record<string, unknown> | null,
}));

vi.mock('@kit/shared/logger', () => ({
  getLogger: async () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

vi.mock('@kit/shared/crypto', () => ({
  encrypt: async (value: string) => `enc(${value})`,
}));

vi.mock('@kit/publishing/server/oauth-app-credentials', () => ({
  getOAuthAppCredentials: async () => ({
    clientId: 'client-id',
    clientSecret: 'client-secret',
  }),
}));

vi.mock('~/lib/platforms/store-connection', () => ({
  storePlatformConnections: async (
    _client: unknown,
    rows: Array<Record<string, unknown>>,
  ) => {
    state.stored.push(...rows);

    return state.storeResult;
  },
}));

vi.mock('@kit/supabase/server-client', () => ({
  getSupabaseServerClient: () => ({
    auth: { getUser: async () => ({ data: { user: { id: 'user-1' } } }) },
    from: (table: string) => {
      const query = {
        select: () => query,
        eq: () => query,
        gt: () => query,
        single: async () => ({ data: state.storedState, error: null }),
        maybeSingle: async () => ({ data: { slug: 'acme' }, error: null }),
        delete: () => ({
          eq: async (_column: string, nonce: string) => {
            state.deletedNonces.push(`${table}:${nonce}`);

            return { error: null };
          },
        }),
      };

      return query;
    },
  }),
}));

const ACCOUNT = '11111111-1111-4111-8111-111111111111';
const NONCE = '22222222-2222-4222-8222-222222222222';
const ORIGIN = 'https://app.example.test';

function callbackRequest(platform: string, stateBody: Record<string, unknown>) {
  const stateParam = Buffer.from(
    JSON.stringify({
      accountId: ACCOUNT,
      returnUrl: '/home/acme/settings/platforms',
      nonce: NONCE,
      ...stateBody,
    }),
  ).toString('base64url');

  return new NextRequest(
    `${ORIGIN}/api/platforms/callback/${platform}?code=vendor-code&state=${stateParam}`,
  );
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function stubVendor(answer: (url: URL, init?: RequestInit) => Response) {
  const fetchMock = vi.fn(async (input: string | URL, init?: RequestInit) =>
    answer(new URL(input.toString()), init),
  );

  vi.stubGlobal('fetch', fetchMock);

  return fetchMock;
}

function landing(response: Response) {
  const location = new URL(response.headers.get('location') ?? '');

  return {
    path: location.pathname,
    query: Object.fromEntries(location.searchParams),
  };
}

beforeEach(() => {
  state.stored = [];
  state.storeResult = { error: null };
  state.deletedNonces = [];
  state.storedState = { id: 's1', nonce: NONCE, metadata: {} };
  vi.stubEnv('NEXT_PUBLIC_APP_URL', ORIGIN);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('TikTok callback success (FILM-706)', () => {
  const TOKENS = {
    access_token: 'tt-access',
    refresh_token: 'tt-refresh',
    expires_in: 86_400,
    refresh_expires_in: 31_536_000,
    scope: 'user.info.basic,video.upload',
  };

  function tiktok(overrides: { tokens?: unknown; user?: unknown } = {}) {
    return stubVendor((url) =>
      url.pathname === '/v2/oauth/token/'
        ? json(overrides.tokens ?? TOKENS)
        : json(
            overrides.user ?? {
              data: {
                user: {
                  open_id: 'open-1',
                  union_id: 'union-1',
                  display_name: 'Acme Clips',
                  avatar_url: 'https://cdn.example.test/a.png',
                },
              },
            },
          ),
    );
  }

  beforeEach(() => {
    state.storedState = {
      id: 's1',
      nonce: NONCE,
      metadata: { codeVerifier: 'verifier-1' },
    };
  });

  it('exchanges the code with the stored PKCE verifier and stores the connection', async () => {
    const fetchMock = tiktok();
    const { GET } = await import('~/api/platforms/callback/tiktok/route');

    const response = await GET(callbackRequest('tiktok', {}));

    const [tokenUrl, tokenInit] = fetchMock.mock.calls[0]!;
    const sent = new URLSearchParams(String(tokenInit?.body));

    expect(new URL(tokenUrl.toString()).pathname).toBe('/v2/oauth/token/');
    expect(Object.fromEntries(sent)).toMatchObject({
      client_key: 'client-id',
      code: 'vendor-code',
      code_verifier: 'verifier-1',
      redirect_uri: `${ORIGIN}/api/platforms/callback/tiktok`,
    });

    expect(state.stored).toHaveLength(1);
    expect(state.stored[0]).toMatchObject({
      account_id: ACCOUNT,
      platform: 'tiktok',
      platform_account_id: 'open-1',
      platform_account_name: 'Acme Clips',
      access_token_encrypted: 'enc(tt-access)',
      refresh_token_encrypted: 'enc(tt-refresh)',
      scopes: ['user.info.basic', 'video.upload'],
      is_active: true,
      metadata: expect.objectContaining({ union_id: 'union-1' }),
    });
    expect(state.deletedNonces).toEqual([`oauth_states:${NONCE}`]);
    expect(landing(response)).toEqual({
      path: '/home/acme/settings/platforms',
      query: { success: 'tiktok_connected', username: 'Acme Clips' },
    });
  });

  it('records no scopes when TikTok sends none, rather than the ones asked for', async () => {
    tiktok({ tokens: { ...TOKENS, scope: undefined } });
    const { GET } = await import('~/api/platforms/callback/tiktok/route');

    await GET(callbackRequest('tiktok', {}));

    expect(state.stored[0]?.scopes).toEqual([]);
  });

  it('stores nothing and keeps the state when the token exchange is refused', async () => {
    tiktok({ tokens: { error: 'invalid_grant' } });
    const { GET } = await import('~/api/platforms/callback/tiktok/route');

    const response = await GET(callbackRequest('tiktok', {}));

    expect(state.stored).toEqual([]);
    expect(state.deletedNonces).toEqual([]);
    expect(landing(response).query).toMatchObject({
      error: 'token_exchange_failed',
    });
  });
});

describe('Meta callback success (FILM-707)', () => {
  const PAGE_TOKEN = 'page-token';
  const USER_TOKEN = 'long-user-token';

  function meta(pages: unknown[], instagram?: unknown) {
    return stubVendor((url) => {
      if (url.pathname.endsWith('/oauth/access_token')) {
        return url.searchParams.get('grant_type') === 'fb_exchange_token'
          ? json({ access_token: USER_TOKEN, expires_in: 5_183_944 })
          : json({ access_token: 'short-user-token' });
      }
      if (url.pathname.endsWith('/me/accounts')) return json({ data: pages });
      if (url.pathname.endsWith('/me/permissions')) {
        return json({
          data: [
            { permission: 'pages_show_list', status: 'granted' },
            { permission: 'instagram_basic', status: 'granted' },
            { permission: 'business_management', status: 'declined' },
          ],
        });
      }
      if (url.pathname.endsWith('/ig-1')) {
        return instagram === undefined
          ? json({ error: { message: 'boom' } }, 500)
          : json(instagram);
      }

      return json({ error: { message: url.pathname } }, 404);
    });
  }

  const linkedPage = {
    id: 'page-1',
    name: 'Acme Page',
    access_token: PAGE_TOKEN,
    category: 'Media',
    picture: { data: { url: 'https://cdn.example.test/p.png' } },
    instagram_business_account: { id: 'ig-1' },
  };

  const instagramAccount = {
    id: 'ig-1',
    username: 'acme_reels',
    profile_picture_url: 'https://cdn.example.test/ig.png',
    followers_count: 1200,
  };

  it('stores the Page and its Instagram account, the Instagram row pointing at the Page', async () => {
    meta([linkedPage], instagramAccount);
    const { GET } = await import('~/api/platforms/callback/meta/route');

    const response = await GET(
      callbackRequest('meta', { platforms: ['facebook', 'instagram'] }),
    );

    expect(
      state.stored.map((row) => [row.platform, row.platform_account_id]),
    ).toEqual([
      ['facebook', 'page-1'],
      ['instagram', 'ig-1'],
    ]);

    const [facebook, instagram] = state.stored;

    expect(facebook).toMatchObject({
      account_id: ACCOUNT,
      platform_account_name: 'Acme Page',
      access_token_encrypted: `enc(${PAGE_TOKEN})`,
      refresh_token_encrypted: `enc(${USER_TOKEN})`,
      scopes: ['pages_show_list', 'instagram_basic'],
    });
    expect(instagram).toMatchObject({
      platform_account_name: 'acme_reels',
      access_token_encrypted: `enc(${PAGE_TOKEN})`,
      refresh_token_encrypted: `enc(${USER_TOKEN})`,
      scopes: ['pages_show_list', 'instagram_basic'],
      metadata: expect.objectContaining({
        linked_page_id: 'page-1',
        followers_count: 1200,
      }),
    });
    expect(state.deletedNonces).toEqual([`oauth_states:${NONCE}`]);
    expect(landing(response).query).toEqual({
      success: 'meta_connected',
      count: '2',
      accounts: 'Acme Page, acme_reels',
    });
  });

  it('asks for the Instagram account with the Page token', async () => {
    const fetchMock = meta([linkedPage], instagramAccount);
    const { GET } = await import('~/api/platforms/callback/meta/route');

    await GET(callbackRequest('meta', { platforms: ['instagram'] }));

    const igCall = fetchMock.mock.calls.find(([input]) =>
      new URL(input.toString()).pathname.endsWith('/ig-1'),
    );

    // FILM-1728: the token rides in the header, never in the URL.
    expect(
      new URL(igCall![0].toString()).searchParams.has('access_token'),
    ).toBe(false);
    expect(new Headers(igCall![1]?.headers).get('authorization')).toBe(
      `Bearer ${PAGE_TOKEN}`,
    );
    expect(state.stored.map((row) => row.platform)).toEqual(['instagram']);
  });

  it('stores no Instagram row for a Page with no linked Instagram account', async () => {
    const { instagram_business_account: _unlinked, ...unlinked } = linkedPage;

    meta([unlinked]);
    const { GET } = await import('~/api/platforms/callback/meta/route');

    await GET(
      callbackRequest('meta', { platforms: ['facebook', 'instagram'] }),
    );

    expect(state.stored.map((row) => row.platform)).toEqual(['facebook']);
  });

  it('stores the Page alone when Instagram’s account lookup fails', async () => {
    meta([linkedPage]);
    const { GET } = await import('~/api/platforms/callback/meta/route');

    await GET(
      callbackRequest('meta', { platforms: ['facebook', 'instagram'] }),
    );

    expect(state.stored.map((row) => row.platform)).toEqual(['facebook']);
  });

  it('stores one pair per Page when the person manages several', async () => {
    meta(
      [linkedPage, { ...linkedPage, id: 'page-2', name: 'Second Page' }],
      instagramAccount,
    );
    const { GET } = await import('~/api/platforms/callback/meta/route');

    const response = await GET(
      callbackRequest('meta', { platforms: ['facebook'] }),
    );

    expect(state.stored.map((row) => row.platform_account_id)).toEqual([
      'page-1',
      'page-2',
    ]);
    expect(landing(response).query.count).toBe('2');
  });

  it('lands on the failure page when the person manages no Page', async () => {
    meta([]);
    const { GET } = await import('~/api/platforms/callback/meta/route');

    const response = await GET(
      callbackRequest('meta', { platforms: ['facebook'] }),
    );

    expect(state.stored).toEqual([]);
    expect(landing(response).query).toMatchObject({ error: 'no_pages_found' });
  });
});
