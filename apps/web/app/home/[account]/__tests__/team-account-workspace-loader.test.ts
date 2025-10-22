import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getSupabaseServerClient } from '@kit/supabase/server-client';
// Import after mocks
import { createTeamAccountsApi } from '@kit/team-accounts/api';

import { requireUserInServerComponent } from '~/lib/server/require-user-in-server-component';

import { loadTeamWorkspace } from '../_lib/server/team-account-workspace.loader';

// Mock dependencies before importing
vi.mock('@kit/supabase/server-client', () => ({
  getSupabaseServerClient: vi.fn(() => ({})),
}));

vi.mock('@kit/team-accounts/api', () => ({
  createTeamAccountsApi: vi.fn(),
}));

vi.mock('~/lib/server/require-user-in-server-component', () => ({
  requireUserInServerComponent: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT;${url}`);
  }),
}));

vi.mock('~/config/paths.config', () => ({
  default: {
    app: {
      home: '/home',
    },
  },
}));

// Get mocked functions
const mockCreateTeamAccountsApi = vi.mocked(createTeamAccountsApi);
const mockRequireUserInServerComponent = vi.mocked(
  requireUserInServerComponent,
);
const mockGetSupabaseServerClient = vi.mocked(getSupabaseServerClient);

describe('loadTeamWorkspace', () => {
  let mockGetAccountWorkspace: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();

    // Setup default mock implementations
    mockGetAccountWorkspace = vi.fn().mockResolvedValue({
      data: {
        account: {
          id: 'team-account-id',
          name: 'Engineering Team',
          slug: 'engineering-team',
          picture_url: 'https://example.com/team-avatar.jpg',
          is_personal_account: false,
        },
        accounts: [
          {
            id: 'account-1',
            name: 'Team Account 1',
            slug: 'team-1',
            picture_url: null,
            role: 'owner',
          },
          {
            id: 'account-2',
            name: 'Team Account 2',
            slug: 'team-2',
            picture_url: null,
            role: 'member',
          },
        ],
        subscription: {
          id: 'sub-team-123',
          status: 'active',
          plan_name: 'Team Pro Plan',
          interval: 'month',
        },
      },
      error: null,
    });

    mockCreateTeamAccountsApi.mockReturnValue({
      getAccountWorkspace: mockGetAccountWorkspace,
    } as any);

    mockRequireUserInServerComponent.mockResolvedValue({
      id: 'user-id-123',
      email: 'john@example.com',
    } as any);

    mockGetSupabaseServerClient.mockReturnValue({} as any);
  });

  it('should load team workspace with account, accounts, and subscription', async () => {
    const result = await loadTeamWorkspace('engineering-team');

    expect(result).toHaveProperty('account');
    expect(result).toHaveProperty('accounts');
    expect(result).toHaveProperty('subscription');
    expect(result).toHaveProperty('user');
  });

  it('should return team account data', async () => {
    const result = await loadTeamWorkspace('engineering-team');

    expect(result.account).toEqual({
      id: 'team-account-id',
      name: 'Engineering Team',
      slug: 'engineering-team',
      picture_url: 'https://example.com/team-avatar.jpg',
      is_personal_account: false,
    });
  });

  it('should return team accounts list', async () => {
    const result = await loadTeamWorkspace('engineering-team');

    expect(result.accounts).toHaveLength(2);
    expect(result.accounts[0]).toEqual({
      id: 'account-1',
      name: 'Team Account 1',
      slug: 'team-1',
      picture_url: null,
      role: 'owner',
    });
  });

  it('should return subscription data', async () => {
    const result = await loadTeamWorkspace('engineering-team');

    expect(result.subscription).toEqual({
      id: 'sub-team-123',
      status: 'active',
      plan_name: 'Team Pro Plan',
      interval: 'month',
    });
  });

  it('should return authenticated user', async () => {
    const result = await loadTeamWorkspace('engineering-team');

    expect(result.user).toEqual({
      id: 'user-id-123',
      email: 'john@example.com',
    });
  });

  it('should call getAccountWorkspace with slug', async () => {
    await loadTeamWorkspace('my-awesome-team');

    expect(mockGetAccountWorkspace).toHaveBeenCalledWith('my-awesome-team');
  });

  it('should call createTeamAccountsApi with Supabase client', async () => {
    const mockClient = {};
    mockGetSupabaseServerClient.mockReturnValue(mockClient as any);

    await loadTeamWorkspace('engineering-team');

    expect(mockCreateTeamAccountsApi).toHaveBeenCalledWith(mockClient);
  });

  it('should load data in parallel', async () => {
    const startTime = Date.now();

    await loadTeamWorkspace('engineering-team');

    const duration = Date.now() - startTime;

    // Verify all promises were called
    expect(mockGetAccountWorkspace).toHaveBeenCalledTimes(1);
    expect(mockRequireUserInServerComponent).toHaveBeenCalledTimes(1);

    // Should complete quickly if parallel
    expect(duration).toBeLessThan(1000);
  });

  it('should redirect to home when account not found', async () => {
    mockGetAccountWorkspace.mockResolvedValue({
      data: null,
      error: { message: 'Account not found' },
    });

    try {
      await loadTeamWorkspace('non-existent-team');
      expect.fail('Expected redirect to be thrown');
    } catch (error) {
      expect((error as Error).message).toBe('NEXT_REDIRECT;/home');
    }
  });

  it('should redirect to home when account is null', async () => {
    mockGetAccountWorkspace.mockResolvedValue({
      data: {
        account: null,
        accounts: [],
        subscription: null,
      },
      error: null,
    });

    try {
      await loadTeamWorkspace('invalid-slug');
      expect.fail('Expected redirect to be thrown');
    } catch (error) {
      expect((error as Error).message).toBe('NEXT_REDIRECT;/home');
    }
  });

  it('should handle team without subscription', async () => {
    mockGetAccountWorkspace.mockResolvedValue({
      data: {
        account: {
          id: 'team-account-id',
          name: 'Free Team',
          slug: 'free-team',
          picture_url: null,
          is_personal_account: false,
        },
        accounts: [],
        subscription: null,
      },
      error: null,
    });

    const result = await loadTeamWorkspace('free-team');

    expect(result.subscription).toBeNull();
  });

  it('should handle team with empty accounts list', async () => {
    mockGetAccountWorkspace.mockResolvedValue({
      data: {
        account: {
          id: 'team-account-id',
          name: 'Solo Team',
          slug: 'solo-team',
          picture_url: null,
          is_personal_account: false,
        },
        accounts: [],
        subscription: null,
      },
      error: null,
    });

    const result = await loadTeamWorkspace('solo-team');

    expect(result.accounts).toEqual([]);
  });

  it('should handle team with multiple roles', async () => {
    mockGetAccountWorkspace.mockResolvedValue({
      data: {
        account: {
          id: 'team-account-id',
          name: 'Multi-Role Team',
          slug: 'multi-role-team',
          picture_url: null,
          is_personal_account: false,
        },
        accounts: [
          { id: '1', name: 'Team 1', slug: 'team-1', role: 'owner' },
          { id: '2', name: 'Team 2', slug: 'team-2', role: 'admin' },
          { id: '3', name: 'Team 3', slug: 'team-3', role: 'member' },
        ],
        subscription: null,
      },
      error: null,
    });

    const result = await loadTeamWorkspace('multi-role-team');

    expect(result.accounts).toHaveLength(3);
    expect(result.accounts[0].role).toBe('owner');
    expect(result.accounts[1].role).toBe('admin');
    expect(result.accounts[2].role).toBe('member');
  });

  it('should handle team with different subscription statuses', async () => {
    const statuses = ['active', 'trialing', 'past_due', 'canceled'];

    for (const status of statuses) {
      mockGetAccountWorkspace.mockResolvedValue({
        data: {
          account: {
            id: 'team-account-id',
            name: 'Test Team',
            slug: 'test-team',
            picture_url: null,
            is_personal_account: false,
          },
          accounts: [],
          subscription: {
            id: 'sub-123',
            status,
            plan_name: 'Team Plan',
            interval: 'month',
          },
        },
        error: null,
      });

      const result = await loadTeamWorkspace('test-team');

      expect(result.subscription.status).toBe(status);
    }
  });

  it('should handle slugs with special characters', async () => {
    const testSlugs = [
      'team-with-dashes',
      'team_with_underscores',
      'team123',
      'team-with-numbers-456',
    ];

    for (const slug of testSlugs) {
      mockGetAccountWorkspace.mockResolvedValue({
        data: {
          account: {
            id: 'team-id',
            name: 'Test Team',
            slug,
            picture_url: null,
            is_personal_account: false,
          },
          accounts: [],
          subscription: null,
        },
        error: null,
      });

      const result = await loadTeamWorkspace(slug);

      expect(result.account.slug).toBe(slug);
      expect(mockGetAccountWorkspace).toHaveBeenCalledWith(slug);
    }
  });

  it('should propagate errors from getAccountWorkspace', async () => {
    mockGetAccountWorkspace.mockRejectedValue(
      new Error('Database connection failed'),
    );

    await expect(loadTeamWorkspace('engineering-team')).rejects.toThrow(
      'Database connection failed',
    );
  });

  it('should propagate errors from requireUserInServerComponent', async () => {
    mockRequireUserInServerComponent.mockRejectedValue(
      new Error('User not authenticated'),
    );

    await expect(loadTeamWorkspace('engineering-team')).rejects.toThrow(
      'User not authenticated',
    );
  });

  describe('Data Integrity', () => {
    it('should return consistent data structure', async () => {
      const result = await loadTeamWorkspace('engineering-team');

      expect(result).toMatchObject({
        account: expect.any(Object),
        accounts: expect.any(Array),
        user: expect.any(Object),
      });
    });

    it('should have required account fields', async () => {
      const result = await loadTeamWorkspace('engineering-team');

      expect(result.account).toHaveProperty('id');
      expect(result.account).toHaveProperty('name');
      expect(result.account).toHaveProperty('slug');
      expect(result.account).toHaveProperty('is_personal_account');
    });

    it('should have accounts with required fields', async () => {
      const result = await loadTeamWorkspace('engineering-team');

      result.accounts.forEach((account) => {
        expect(account).toHaveProperty('id');
        expect(account).toHaveProperty('name');
        expect(account).toHaveProperty('slug');
        expect(account).toHaveProperty('role');
      });
    });

    it('should have user with required fields', async () => {
      const result = await loadTeamWorkspace('engineering-team');

      expect(result.user).toHaveProperty('id');
      expect(result.user).toHaveProperty('email');
    });

    it('should have subscription with required fields when present', async () => {
      const result = await loadTeamWorkspace('engineering-team');

      if (result.subscription) {
        expect(result.subscription).toHaveProperty('id');
        expect(result.subscription).toHaveProperty('status');
      }
    });
  });

  describe('Edge Cases', () => {
    it('should handle concurrent workspace loads for different teams', async () => {
      const slugs = ['team-a', 'team-b', 'team-c'];

      const promises = slugs.map((slug) => {
        mockGetAccountWorkspace.mockResolvedValue({
          data: {
            account: {
              id: `${slug}-id`,
              name: slug,
              slug,
              picture_url: null,
              is_personal_account: false,
            },
            accounts: [],
            subscription: null,
          },
          error: null,
        });

        return loadTeamWorkspace(slug);
      });

      const results = await Promise.all(promises);

      expect(results).toHaveLength(3);
      expect(mockGetAccountWorkspace).toHaveBeenCalledTimes(3);
    });

    it('should handle team with very long name', async () => {
      const longName = 'A'.repeat(500);

      mockGetAccountWorkspace.mockResolvedValue({
        data: {
          account: {
            id: 'team-id',
            name: longName,
            slug: 'long-team',
            picture_url: null,
            is_personal_account: false,
          },
          accounts: [],
          subscription: null,
        },
        error: null,
      });

      const result = await loadTeamWorkspace('long-team');

      expect(result.account.name).toBe(longName);
    });

    it('should handle team with many accounts', async () => {
      const manyAccounts = Array.from({ length: 100 }, (_, i) => ({
        id: `account-${i}`,
        name: `Account ${i}`,
        slug: `account-${i}`,
        role: i === 0 ? 'owner' : 'member',
      }));

      mockGetAccountWorkspace.mockResolvedValue({
        data: {
          account: {
            id: 'team-id',
            name: 'Large Team',
            slug: 'large-team',
            picture_url: null,
            is_personal_account: false,
          },
          accounts: manyAccounts,
          subscription: null,
        },
        error: null,
      });

      const result = await loadTeamWorkspace('large-team');

      expect(result.accounts).toHaveLength(100);
    });
  });
});
