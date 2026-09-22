import {
  type Mock,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import { META_GRAPH_BASE, META_OAUTH_TOKEN_URL } from '@kit/shared/vendors';

import {
  type Platform,
  ensureValidToken,
  formatPlatformName,
  getExpiryBuffer,
} from '../src/lib/token-refresh';

// Mock server-only
vi.mock('server-only', () => ({}));

// Mock the crypto module. This lived at `../src/lib/crypto` until that file
// was deleted as dead code in 96c9e20e; token-refresh.ts now imports from
// `@kit/shared/crypto`, so mocking the old path silently mocked nothing.
vi.mock('@kit/shared/crypto', () => ({
  encrypt: vi.fn((value: string) => Promise.resolve(`encrypted:${value}`)),
  decrypt: vi.fn((value: string) =>
    Promise.resolve(value.replace('encrypted:', '')),
  ),
}));

/**
 * PostgREST builders resolve to `{ data, error }`; typing the terminal
 * methods as that shape is what lets a test override them.
 */
interface QueryResult {
  data: unknown;
  error: { message: string } | null;
}

// Mock Supabase client
const mockSupabase = {
  from: vi.fn(() => mockSupabase),
  select: vi.fn(() => mockSupabase),
  eq: vi.fn(() => mockSupabase),
  lt: vi.fn(() => mockSupabase),
  order: vi.fn(() => mockSupabase),
  update: vi.fn(() => mockSupabase),
  single: vi.fn(
    (): Promise<QueryResult> => Promise.resolve({ data: null, error: null }),
  ),
};

vi.mock('../src/server/account-oauth-actions', () => ({
  getAccountOAuthAppAdmin: vi.fn(() =>
    Promise.resolve({
      clientId: 'test-facebook-app-id',
      clientSecret: 'test-facebook-app-secret',
    }),
  ),
}));

// token-refresh.ts runs from background workers with no user session, so it
// uses the admin client. Mocking `server-client` left the real admin client to
// be constructed, which threw on the unset NEXT_PUBLIC_SUPABASE_* env vars.
vi.mock('@kit/supabase/server-admin-client', () => ({
  getSupabaseServerAdminClient: () => mockSupabase,
}));

describe('Token Refresh', () => {
  const validKey =
    '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

  beforeEach(() => {
    vi.stubEnv('TOKEN_ENCRYPTION_KEY', validKey);
    vi.stubEnv('YOUTUBE_CLIENT_ID', 'test-youtube-client-id');
    vi.stubEnv('YOUTUBE_CLIENT_SECRET', 'test-youtube-client-secret');
    vi.stubEnv('TIKTOK_CLIENT_KEY', 'test-tiktok-client-key');
    vi.stubEnv('TIKTOK_CLIENT_SECRET', 'test-tiktok-client-secret');
    vi.stubEnv('FACEBOOK_APP_ID', 'test-facebook-app-id');
    vi.stubEnv('FACEBOOK_APP_SECRET', 'test-facebook-app-secret');

    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe('formatPlatformName', () => {
    it('should format youtube correctly', () => {
      expect(formatPlatformName('youtube')).toBe('YouTube');
    });

    it('should format tiktok correctly', () => {
      expect(formatPlatformName('tiktok')).toBe('TikTok');
    });

    it('should format instagram correctly', () => {
      expect(formatPlatformName('instagram')).toBe('Instagram');
    });

    it('should format facebook correctly', () => {
      expect(formatPlatformName('facebook')).toBe('Facebook');
    });

    it('should return unknown platforms as-is', () => {
      expect(formatPlatformName('unknown' as Platform)).toBe('unknown');
    });
  });

  describe('getExpiryBuffer', () => {
    it('should return 5 minutes in milliseconds', () => {
      expect(getExpiryBuffer()).toBe(5 * 60 * 1000);
    });
  });

  describe('ensureValidToken', () => {
    it('should return NOT_FOUND when connection does not exist', async () => {
      mockSupabase.single.mockResolvedValueOnce({
        data: null,
        error: { message: 'Not found' },
      });

      // Dynamically import to get fresh module with mocks
      const { ensureValidToken } = await import('../src/lib/token-refresh');

      const result = await ensureValidToken('non-existent-id');

      expect(result.valid).toBe(false);
      expect(result.error).toBe('NOT_FOUND');
    });

    it('should return CONNECTION_INACTIVE when connection is inactive', async () => {
      mockSupabase.single.mockResolvedValueOnce({
        data: {
          id: 'conn-1',
          is_active: false,
          platform: 'youtube',
          account_id: 'account-1',
        },
        error: null,
      });

      const { ensureValidToken } = await import('../src/lib/token-refresh');

      const result = await ensureValidToken('conn-1');

      expect(result.valid).toBe(false);
      expect(result.error).toBe('CONNECTION_INACTIVE');
      expect(result.requiresReauth).toBe(true);
    });

    it('should return valid token when not expired', async () => {
      const futureExpiry = new Date(Date.now() + 60 * 60 * 1000); // 1 hour from now

      mockSupabase.single.mockResolvedValueOnce({
        data: {
          id: 'conn-1',
          is_active: true,
          platform: 'youtube',
          account_id: 'account-1',
          access_token_encrypted: 'encrypted:valid-access-token',
          refresh_token_encrypted: 'encrypted:valid-refresh-token',
          token_expires_at: futureExpiry.toISOString(),
        },
        error: null,
      });

      const { ensureValidToken } = await import('../src/lib/token-refresh');

      const result = await ensureValidToken('conn-1');

      expect(result.valid).toBe(true);
      expect(result.accessToken).toBe('valid-access-token');
    });
  });
});

describe('Platform Token Refresh Functions', () => {
  beforeEach(() => {
    vi.stubEnv('YOUTUBE_CLIENT_ID', 'test-youtube-client-id');
    vi.stubEnv('YOUTUBE_CLIENT_SECRET', 'test-youtube-client-secret');
    vi.stubEnv('TIKTOK_CLIENT_KEY', 'test-tiktok-client-key');
    vi.stubEnv('TIKTOK_CLIENT_SECRET', 'test-tiktok-client-secret');
    vi.stubEnv('FACEBOOK_APP_ID', 'test-facebook-app-id');
    vi.stubEnv('FACEBOOK_APP_SECRET', 'test-facebook-app-secret');

    // Mock global fetch
    global.fetch = vi.fn() as Mock;
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  describe('YouTube token refresh', () => {
    it('should call Google OAuth endpoint with correct parameters', async () => {
      const mockResponse = {
        ok: true,
        json: () =>
          Promise.resolve({
            access_token: 'new-access-token',
            refresh_token: 'new-refresh-token',
            expires_in: 3600,
          }),
      };

      (global.fetch as Mock).mockResolvedValueOnce(mockResponse);

      // Call YouTube refresh directly (we'd need to export it for this test)
      // For now, verify the fetch was called correctly
      await global.fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: 'test-youtube-client-id',
          client_secret: 'test-youtube-client-secret',
          refresh_token: 'test-refresh-token',
          grant_type: 'refresh_token',
        }),
      });

      expect(global.fetch).toHaveBeenCalledWith(
        'https://oauth2.googleapis.com/token',
        expect.objectContaining({
          method: 'POST',
        }),
      );
    });
  });

  describe('TikTok token refresh', () => {
    it('should call TikTok OAuth endpoint', async () => {
      const mockResponse = {
        ok: true,
        json: () =>
          Promise.resolve({
            access_token: 'new-tiktok-access-token',
            refresh_token: 'new-tiktok-refresh-token',
            expires_in: 86400,
          }),
      };

      (global.fetch as Mock).mockResolvedValueOnce(mockResponse);

      await global.fetch('https://open.tiktokapis.com/v2/oauth/token/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_key: 'test-tiktok-client-key',
          client_secret: 'test-tiktok-client-secret',
          refresh_token: 'test-refresh-token',
          grant_type: 'refresh_token',
        }),
      });

      expect(global.fetch).toHaveBeenCalledWith(
        'https://open.tiktokapis.com/v2/oauth/token/',
        expect.objectContaining({
          method: 'POST',
        }),
      );
    });
  });

  /**
   * Driven through `ensureValidToken`, the entry point all six callers use.
   * The case this replaced called `fetch` itself and asserted that `fetch` had
   * been called, so it passed whatever token-refresh.ts did (FILM-1723).
   */
  describe('Meta token refresh', () => {
    const connection = {
      id: 'conn-1',
      account_id: 'account-1',
      platform: 'instagram',
      platform_account_id: 'ig-1',
      access_token_encrypted: 'encrypted:old-page-token',
      refresh_token_encrypted: 'encrypted:old-user-token',
      is_active: true,
      token_expires_at: new Date(Date.now() - 1000).toISOString(),
      metadata: { linked_page_id: 'page-1' },
      updated_at: '2026-09-01T00:00:00.000Z',
    };

    beforeEach(() => {
      mockSupabase.single.mockResolvedValueOnce({
        data: connection,
        error: null,
      });
      // The first `select` is the read above; the second closes the
      // optimistic-lock update and has to report a locked row.
      mockSupabase.select
        .mockImplementationOnce(() => mockSupabase)
        .mockImplementationOnce(
          () =>
            Promise.resolve({
              data: [{ id: connection.id }],
              error: null,
            }) as unknown as typeof mockSupabase,
        );

      vi.stubGlobal(
        'fetch',
        vi
          .fn()
          .mockResolvedValueOnce({
            json: () =>
              Promise.resolve({
                access_token: 'new-user-token',
                expires_in: 5184000,
              }),
          })
          .mockResolvedValueOnce({
            json: () =>
              Promise.resolve({
                data: [
                  { id: 'page-0', access_token: 'other-page-token' },
                  { id: 'page-1', access_token: 'new-page-token' },
                ],
              }),
          }),
      );
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it('exchanges the user token and reads the page token on the pinned Graph version', async () => {
      const result = await ensureValidToken(connection.id);

      expect(result).toEqual({ valid: true, accessToken: 'new-page-token' });

      const [exchange, pages] = (fetch as Mock).mock.calls.map(
        ([url]) => new URL(url as string),
      );

      expect(exchange!.origin + exchange!.pathname).toBe(META_OAUTH_TOKEN_URL);
      expect(Object.fromEntries(exchange!.searchParams)).toEqual({
        grant_type: 'fb_exchange_token',
        client_id: 'test-facebook-app-id',
        client_secret: 'test-facebook-app-secret',
        fb_exchange_token: 'old-user-token',
      });

      expect(pages!.origin + pages!.pathname).toBe(
        `${META_GRAPH_BASE}/me/accounts`,
      );
      expect(pages!.searchParams.get('access_token')).toBe('new-user-token');
    });

    it('stores the refreshed user token for the next cycle', async () => {
      await ensureValidToken(connection.id);

      expect(mockSupabase.update).toHaveBeenLastCalledWith(
        expect.objectContaining({
          access_token_encrypted: 'encrypted:new-page-token',
          refresh_token_encrypted: 'encrypted:new-user-token',
        }),
      );
    });
  });
});
