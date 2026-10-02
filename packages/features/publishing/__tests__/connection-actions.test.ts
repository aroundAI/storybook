import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Platform, PlatformConnection } from '../src/lib/types';

// Mock server-only
vi.mock('server-only', () => ({}));

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

// Mock @kit/next/actions
vi.mock('@kit/next/actions', () => ({
  enhanceAction: (
    fn: (data: Record<string, unknown>, user: unknown) => Promise<unknown>,
    _options: unknown,
  ) => {
    return async (data: Record<string, unknown>) => {
      return fn(data, { id: 'test-user-id' });
    };
  },
}));

const logger = vi.hoisted(() => ({
  info: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
}));

vi.mock('@kit/shared/logger', () => ({
  getLogger: () => Promise.resolve(logger),
}));

// Mock token-refresh
vi.mock('../src/lib/token-refresh', () => ({
  ensureValidToken: vi.fn(() =>
    Promise.resolve({
      valid: true,
      accessToken: 'mock-access-token',
    }),
  ),
}));

/**
 * PostgREST query builders are thenable: `order()` both continues the chain
 * and resolves to a result. Declaring the terminal methods as the resolved
 * shape is what lets a test call `mockResolvedValueOnce` on them — typed as
 * returning the chain object, every such call was a type error.
 */
interface QueryResult {
  data: unknown;
  error: { message: string } | null;
}

// Mock Supabase client
const mockSupabaseClient = {
  from: vi.fn(() => mockSupabaseClient),
  select: vi.fn(() => mockSupabaseClient),
  eq: vi.fn(() => mockSupabaseClient),
  is: vi.fn(() => mockSupabaseClient),
  delete: vi.fn(() => mockSupabaseClient),
  order: vi.fn(() => mockSupabaseClient as unknown as Promise<QueryResult>),
  single: vi.fn(
    (): Promise<QueryResult> => Promise.resolve({ data: null, error: null }),
  ),
  maybeSingle: vi.fn(
    (): Promise<QueryResult> => Promise.resolve({ data: null, error: null }),
  ),
  rpc: vi.fn(
    (): Promise<QueryResult> => Promise.resolve({ data: [], error: null }),
  ),
};

const revokers = vi.hoisted(() => ({
  revokeAtVendor: vi.fn(),
}));

vi.mock('../src/oauth/revokers', () => revokers);

vi.mock('@kit/supabase/server-client', () => ({
  getSupabaseServerClient: () => mockSupabaseClient,
}));

// KB-43: members may not read token columns, so the disconnect's token read
// goes through the admin client — and only after the member's read found the row.
const mockAdminClient = {
  from: vi.fn(() => mockAdminClient),
  select: vi.fn(() => mockAdminClient),
  eq: vi.fn(() => mockAdminClient),
  maybeSingle: vi.fn(
    (): Promise<QueryResult> => Promise.resolve({ data: null, error: null }),
  ),
};

vi.mock('@kit/supabase/server-admin-client', () => ({
  getSupabaseServerAdminClient: () => mockAdminClient,
}));

const clickhouse = vi.hoisted(() => ({
  queryLatestSubscriberLevels: vi.fn(),
}));

vi.mock('@kit/clickhouse/server', () => clickhouse);

describe('Connection Actions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clickhouse.queryLatestSubscriberLevels.mockResolvedValue(new Map());
  });

  describe('getConnectedPlatformsAction', () => {
    it('should return empty array when no connections exist', async () => {
      // Mock empty result
      mockSupabaseClient.order.mockResolvedValueOnce({
        data: [],
        error: null,
      });

      const { getConnectedPlatformsAction } = await import(
        '../src/server/connection-actions'
      );

      const result = await getConnectedPlatformsAction({
        accountId: 'test-account-id',
      });

      expect(result).toEqual([]);
    });

    it('should transform database records to PlatformConnection type', async () => {
      const mockDbConnection = {
        id: 'conn-1',
        platform: 'youtube',
        platform_account_id: 'yt-account-123',
        platform_account_name: 'My YouTube Channel',
        is_active: true,
        token_expires_at: new Date(Date.now() + 3600000).toISOString(), // 1 hour from now
        scopes: ['upload', 'read'],
        metadata: {
          avatar_url: 'https://example.com/avatar.jpg',
          followers_count: 1000,
        },
      };

      mockSupabaseClient.order.mockResolvedValueOnce({
        data: [mockDbConnection],
        error: null,
      });

      const { getConnectedPlatformsAction } = await import(
        '../src/server/connection-actions'
      );

      const result = await getConnectedPlatformsAction({
        accountId: 'test-account-id',
      });

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        id: 'conn-1',
        platform: 'youtube',
        platformAccountId: 'yt-account-123',
        platformAccountName: 'My YouTube Channel',
        isActive: true,
        tokenValid: true,
        avatarUrl: 'https://example.com/avatar.jpg',
        followerCount: 1000,
      });
    });

    it('should handle connections without metadata', async () => {
      const mockDbConnection = {
        id: 'conn-2',
        platform: 'tiktok',
        platform_account_id: 'tt-account-123',
        platform_account_name: 'My TikTok',
        is_active: true,
        token_expires_at: new Date(Date.now() + 3600000).toISOString(),
        scopes: null,
        metadata: null,
      };

      mockSupabaseClient.order.mockResolvedValueOnce({
        data: [mockDbConnection],
        error: null,
      });

      const { getConnectedPlatformsAction } = await import(
        '../src/server/connection-actions'
      );

      const result = await getConnectedPlatformsAction({
        accountId: 'test-account-id',
      });

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        avatarUrl: null,
        followerCount: null,
      });
    });

    // FILM-717: a LinkedIn row is kept, but it is not somewhere to publish.
    it('leaves out a connection to a retired platform', async () => {
      const row = (id: string, platform: string) => ({
        id,
        platform,
        platform_account_id: `${platform}-account`,
        platform_account_name: platform,
        is_active: true,
        token_expires_at: new Date(Date.now() + 3600000).toISOString(),
        scopes: null,
        metadata: null,
      });

      mockSupabaseClient.order.mockResolvedValueOnce({
        data: [row('conn-li', 'linkedin'), row('conn-yt', 'youtube')],
        error: null,
      });

      const { getConnectedPlatformsAction } = await import(
        '../src/server/connection-actions'
      );

      const result = await getConnectedPlatformsAction({
        accountId: 'test-account-id',
      });

      expect(result.map((connection) => connection.id)).toEqual(['conn-yt']);
    });

    describe('follower badge source (FILM-1617)', () => {
      const youtube = {
        id: 'conn-yt',
        platform: 'youtube',
        platform_account_id: 'yt-1',
        platform_account_name: 'Channel',
        is_active: true,
        token_expires_at: new Date(Date.now() + 3600000).toISOString(),
        scopes: null,
        created_at: '2026-03-04T10:00:00Z',
        metadata: { followers_count: 900 },
      };

      async function connectedPlatforms(rows: unknown[]) {
        mockSupabaseClient.order.mockResolvedValueOnce({
          data: rows,
          error: null,
        });

        const { getConnectedPlatformsAction } = await import(
          '../src/server/connection-actions'
        );

        return getConnectedPlatformsAction({ accountId: 'test-account-id' });
      }

      it('prefers the latest subscriber level over the stored count', async () => {
        clickhouse.queryLatestSubscriberLevels.mockResolvedValue(
          new Map([
            [
              'conn-yt',
              {
                date: '2026-09-15',
                level: 41_000,
                source: 'interpolated',
                roundingStep: 100,
              },
            ],
          ]),
        );

        const [connection] = await connectedPlatforms([youtube]);

        expect(clickhouse.queryLatestSubscriberLevels).toHaveBeenCalledWith([
          'conn-yt',
        ]);
        expect(connection).toMatchObject({
          followerCount: 41_000,
          followerCountSource: 'reconstructed',
          followerCountAsOf: '2026-09-15',
        });
      });

      // YouTube rounds above 1,000, so its snapshot days are `constrained` or
      // `clamped`, never `snapshot`. They are still measured days.
      it('treats a rounded snapshot day as measured, and carries its rounding', async () => {
        clickhouse.queryLatestSubscriberLevels.mockResolvedValue(
          new Map([
            [
              'conn-yt',
              {
                date: '2026-09-14',
                level: 42_600,
                source: 'constrained',
                roundingStep: 100,
              },
            ],
          ]),
        );

        const [connection] = await connectedPlatforms([youtube]);

        expect(connection).toMatchObject({
          followerCount: 42_600,
          followerCountSource: 'snapshot',
          followerCountRoundingStep: 100,
        });
      });

      // Instagram's badge works today only through this value.
      it('falls back to the stored count, dated by the connection', async () => {
        const [connection] = await connectedPlatforms([youtube]);

        expect(connection).toMatchObject({
          followerCount: 900,
          followerCountSource: 'metadata',
          followerCountAsOf: '2026-03-04',
        });
      });

      it('reports no count, not zero, when neither exists', async () => {
        const [connection] = await connectedPlatforms([
          { ...youtube, metadata: {} },
        ]);

        expect(connection).toMatchObject({
          followerCount: null,
          followerCountSource: null,
        });
      });

      // A slow read is an outage the page would otherwise wait on forever:
      // the publish screen must not be gated on analytics.
      it('falls back to the stored count when the level read hangs', async () => {
        vi.useFakeTimers();

        try {
          clickhouse.queryLatestSubscriberLevels.mockReturnValue(
            new Promise(() => {}),
          );

          const pending = connectedPlatforms([youtube]);

          await vi.advanceTimersByTimeAsync(2_000);

          const [connection] = await pending;

          expect(connection).toMatchObject({
            followerCount: 900,
            followerCountSource: 'metadata',
          });
        } finally {
          vi.useRealTimers();
        }
      }, 5_000);

      // The badge is decoration; an analytics outage must not fail publishing.
      it('falls back to the stored count when the level read fails', async () => {
        clickhouse.queryLatestSubscriberLevels.mockRejectedValue(
          new Error('ClickHouse unavailable'),
        );

        const [connection] = await connectedPlatforms([youtube]);

        expect(connection).toMatchObject({
          followerCount: 900,
          followerCountSource: 'metadata',
        });
      });
    });

    it('should throw error on database failure', async () => {
      mockSupabaseClient.order.mockResolvedValueOnce({
        data: null,
        error: { message: 'Database connection failed' },
      });

      const { getConnectedPlatformsAction } = await import(
        '../src/server/connection-actions'
      );

      await expect(
        getConnectedPlatformsAction({ accountId: 'test-account-id' }),
      ).rejects.toThrow('Failed to fetch platform connections');
    });
  });

  describe('PlatformConnection type validation', () => {
    it('should have all required fields', () => {
      const connection: PlatformConnection = {
        id: 'test-id',
        platform: 'youtube' as Platform,
        language: 'en',
        platformAccountName: 'Test Channel',
        isActive: true,
        tokenValid: true,
      };

      expect(connection.id).toBe('test-id');
      expect(connection.platform).toBe('youtube');
      expect(connection.platformAccountName).toBe('Test Channel');
      expect(connection.isActive).toBe(true);
      expect(connection.tokenValid).toBe(true);
    });

    it('should allow optional fields', () => {
      const connection: PlatformConnection = {
        id: 'test-id',
        platform: 'instagram' as Platform,
        language: 'en',
        platformAccountId: 'ig-123',
        platformAccountName: 'Test Instagram',
        avatarUrl: 'https://example.com/avatar.png',
        isActive: true,
        tokenValid: false,
        tokenExpiresAt: '2024-12-31T23:59:59Z',
        followerCount: 5000,
        scopes: ['media', 'comments'],
      };

      expect(connection.platformAccountId).toBe('ig-123');
      expect(connection.avatarUrl).toBe('https://example.com/avatar.png');
      expect(connection.tokenExpiresAt).toBe('2024-12-31T23:59:59Z');
      expect(connection.followerCount).toBe(5000);
      expect(connection.scopes).toEqual(['media', 'comments']);
    });

    it('should allow null values for optional fields', () => {
      const connection: PlatformConnection = {
        id: 'test-id',
        platform: 'linkedin' as Platform,
        language: 'en',
        platformAccountId: null,
        platformAccountName: 'Test LinkedIn',
        avatarUrl: null,
        isActive: true,
        tokenValid: true,
        tokenExpiresAt: null,
        followerCount: null,
        scopes: null,
      };

      expect(connection.platformAccountId).toBeNull();
      expect(connection.avatarUrl).toBeNull();
      expect(connection.followerCount).toBeNull();
    });
  });

  describe('getAccessToken', () => {
    it('should return access token when valid', async () => {
      const { getAccessToken } = await import(
        '../src/server/connection-tokens'
      );

      const result = await getAccessToken('conn-123');

      expect(result).toHaveProperty('accessToken');
      expect(result.accessToken).toBe('mock-access-token');
    });
  });

  describe('disconnectPlatformAction (KB-22)', () => {
    const CONNECTION_ID = '11111111-0000-4000-8000-000000000001';

    it('revokes at the vendor, then disconnects through the RPC — and never deletes the row', async () => {
      mockSupabaseClient.maybeSingle.mockResolvedValueOnce({
        data: {
          id: CONNECTION_ID,
          platform: 'youtube',
          disconnected_at: null,
        },
        error: null,
      });
      mockAdminClient.maybeSingle.mockResolvedValueOnce({
        data: {
          access_token_encrypted: 'enc',
          refresh_token_encrypted: 'enc-refresh',
        },
        error: null,
      });
      revokers.revokeAtVendor.mockResolvedValueOnce({
        status: 'revoked',
        httpStatus: 200,
      });
      mockSupabaseClient.rpc.mockResolvedValueOnce({
        data: [{ id: CONNECTION_ID, already_disconnected: false }],
        error: null,
      });

      const { disconnectPlatformAction } = await import(
        '../src/server/connection-actions'
      );

      const result = await disconnectPlatformAction({
        connectionId: CONNECTION_ID,
      });

      expect(result).toEqual({
        ok: true,
        data: {
          disconnected: [CONNECTION_ID],
          alreadyDisconnected: false,
          revoke: { status: 'revoked', confirmed: true },
        },
      });
      expect(revokers.revokeAtVendor).toHaveBeenCalledWith({
        platform: 'youtube',
        access_token_encrypted: 'enc',
        refresh_token_encrypted: 'enc-refresh',
      });
      expect(logger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'oauth.disconnect',
          revoke: 'revoked',
        }),
        expect.any(String),
      );
      expect(logger.warn).not.toHaveBeenCalled();
      expect(mockSupabaseClient.rpc).toHaveBeenCalledWith(
        'disconnect_platform_connection',
        { p_connection_id: CONNECTION_ID },
      );
      expect(mockSupabaseClient.delete).not.toHaveBeenCalled();
      // The member's client never names a token column.
      expect(mockSupabaseClient.select).toHaveBeenCalledWith(
        'id, platform, disconnected_at',
      );
      expect(mockAdminClient.select).toHaveBeenCalledWith(
        'access_token_encrypted, refresh_token_encrypted',
      );
      expect(mockAdminClient.eq).toHaveBeenCalledWith('id', CONNECTION_ID);
    });

    it('does not ask the vendor again for a connection already disconnected', async () => {
      mockSupabaseClient.maybeSingle.mockResolvedValueOnce({
        data: {
          id: CONNECTION_ID,
          platform: 'tiktok',
          disconnected_at: '2026-09-23T00:00:00Z',
        },
        error: null,
      });
      mockSupabaseClient.rpc.mockResolvedValueOnce({
        data: [{ id: CONNECTION_ID, already_disconnected: true }],
        error: null,
      });

      const { disconnectPlatformAction } = await import(
        '../src/server/connection-actions'
      );

      const result = await disconnectPlatformAction({
        connectionId: CONNECTION_ID,
      });

      expect(result).toEqual({
        ok: true,
        data: {
          disconnected: [],
          alreadyDisconnected: true,
          revoke: { status: 'no_token', confirmed: true },
        },
      });
      expect(revokers.revokeAtVendor).not.toHaveBeenCalled();
      expect(mockAdminClient.maybeSingle).not.toHaveBeenCalled();
    });

    it.each([
      ['vendor_refused', 400],
      ['unreachable', undefined],
      ['not_configured', undefined],
      ['undecryptable', undefined],
      ['vendor_offers_none', undefined],
    ] as const)(
      'tells the caller, and warns, when the revoke is %s (KB-45)',
      async (status, httpStatus) => {
        mockSupabaseClient.maybeSingle.mockResolvedValueOnce({
          data: {
            id: CONNECTION_ID,
            platform: 'twitter',
            disconnected_at: null,
          },
          error: null,
        });
        mockAdminClient.maybeSingle.mockResolvedValueOnce({
          data: {
            access_token_encrypted: 'enc',
            refresh_token_encrypted: 'enc-refresh',
          },
          error: null,
        });
        revokers.revokeAtVendor.mockResolvedValueOnce(
          httpStatus ? { status, httpStatus } : { status },
        );
        mockSupabaseClient.rpc.mockResolvedValueOnce({
          data: [{ id: CONNECTION_ID, already_disconnected: false }],
          error: null,
        });

        const { disconnectPlatformAction } = await import(
          '../src/server/connection-actions'
        );

        const result = await disconnectPlatformAction({
          connectionId: CONNECTION_ID,
        });

        expect(result).toEqual({
          ok: true,
          data: {
            disconnected: [CONNECTION_ID],
            alreadyDisconnected: false,
            revoke: { status, confirmed: false },
          },
        });
        expect(logger.warn).toHaveBeenCalledWith(
          expect.objectContaining({
            name: 'oauth.disconnect',
            platform: 'twitter',
            revoke: status,
            httpStatus,
          }),
          expect.any(String),
        );
        expect(logger.info).not.toHaveBeenCalledWith(
          expect.objectContaining({ name: 'oauth.disconnect' }),
          expect.any(String),
        );
      },
    );

    it('returns a refusal, as a value, for a connection the caller cannot see (KB-6)', async () => {
      mockSupabaseClient.maybeSingle.mockResolvedValueOnce({
        data: null,
        error: null,
      });

      const { disconnectPlatformAction } = await import(
        '../src/server/connection-actions'
      );

      const result = await disconnectPlatformAction({
        connectionId: CONNECTION_ID,
      });

      expect(result).toEqual({
        ok: false,
        error:
          'That connection no longer exists, or you do not have access to it.',
      });
      expect(mockSupabaseClient.rpc).not.toHaveBeenCalled();
      // No access, no admin read.
      expect(mockAdminClient.maybeSingle).not.toHaveBeenCalled();
    });
  });

  /**
   * KB-127. The Refresh button forces `ensureValidToken(id, true)`, which reads
   * and writes the connection through the admin client. A refresh the vendor
   * refuses deactivates the connection, and an X refresh rotates its refresh
   * token. So the caller must be shown to reach the connection first, through
   * their own client, which is what RLS (`has_account_access`) decides, as
   * disconnect does.
   */
  describe('refreshConnectionAction (KB-127)', () => {
    const CONNECTION_ID = '11111111-2222-4333-8444-555555555555';

    it('refuses, as a value, a connection the caller cannot see, and refreshes nothing', async () => {
      mockSupabaseClient.maybeSingle.mockResolvedValueOnce({
        data: null,
        error: null,
      });

      const { refreshConnectionAction } = await import(
        '../src/server/connection-actions'
      );
      const { ensureValidToken } = await import('../src/lib/token-refresh');

      const result = await refreshConnectionAction({
        connectionId: CONNECTION_ID,
      });

      expect(result).toEqual({
        ok: false,
        error:
          'That connection no longer exists, or you do not have access to it.',
      });
      expect(ensureValidToken).not.toHaveBeenCalled();
    });

    it('force-refreshes a connection the caller can see, checked through their own client', async () => {
      mockSupabaseClient.maybeSingle.mockResolvedValueOnce({
        data: { id: CONNECTION_ID },
        error: null,
      });

      const { refreshConnectionAction } = await import(
        '../src/server/connection-actions'
      );
      const { ensureValidToken } = await import('../src/lib/token-refresh');

      const result = await refreshConnectionAction({
        connectionId: CONNECTION_ID,
      });

      expect(result).toEqual({ ok: true, data: { success: true } });
      expect(mockSupabaseClient.from).toHaveBeenCalledWith(
        'platform_connections',
      );
      expect(mockSupabaseClient.eq).toHaveBeenCalledWith('id', CONNECTION_ID);
      expect(ensureValidToken).toHaveBeenCalledWith(CONNECTION_ID, true);
    });

    // KB-161: a failed read is a fault, not a refusal saying the connection
    // is gone, so it is thrown and production shows its generic sentence.
    it('throws a failed token read rather than refusing as not found', async () => {
      mockSupabaseClient.maybeSingle.mockResolvedValueOnce({
        data: { id: CONNECTION_ID, platform: 'youtube' },
        error: null,
      });

      const { refreshConnectionAction } = await import(
        '../src/server/connection-actions'
      );
      const { ensureValidToken } = await import('../src/lib/token-refresh');
      vi.mocked(ensureValidToken).mockRejectedValueOnce(
        new Error(
          'Platform connection not found: the read failed (connection reset)',
        ),
      );

      await expect(
        refreshConnectionAction({ connectionId: CONNECTION_ID }),
      ).rejects.toThrow('the read failed (connection reset)');
    });
  });
});
