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

// Mock Supabase client
const mockSupabaseClient = {
  from: vi.fn(() => mockSupabaseClient),
  select: vi.fn(() => mockSupabaseClient),
  eq: vi.fn(() => mockSupabaseClient),
  order: vi.fn(() => mockSupabaseClient),
  single: vi.fn(() => Promise.resolve({ data: null, error: null })),
};

vi.mock('@kit/supabase/server-client', () => ({
  getSupabaseServerClient: () => mockSupabaseClient,
}));

describe('Connection Actions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
