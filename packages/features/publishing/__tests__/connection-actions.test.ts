import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Platform, PlatformConnection } from '../src/lib/types';

// Mock server-only
vi.mock('server-only', () => ({}));

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

// Mock @kit/shared/logger
vi.mock('@kit/shared/logger', () => ({
  getLogger: () =>
    Promise.resolve({
      info: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
    }),
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
  order: vi.fn(() => mockSupabaseClient as unknown as Promise<QueryResult>),
  single: vi.fn(
    (): Promise<QueryResult> => Promise.resolve({ data: null, error: null }),
  ),
};

vi.mock('@kit/supabase/server-client', () => ({
  getSupabaseServerClient: () => mockSupabaseClient,
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
        '../src/server/connection-actions'
      );

      const result = await getAccessToken('conn-123');

      expect(result).toHaveProperty('accessToken');
      expect(result.accessToken).toBe('mock-access-token');
    });
  });
});
