import { redirect } from 'next/navigation';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createAuditLog, extractNetworkContext } from '@kit/audit-logs/server';

import { updateTeamAccountName } from '../src/server/actions/team-details-server-actions';

// Mock Next.js functions - must be defined before import
vi.mock('next/navigation', () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT;${url}`);
  }),
}));

// Mock enhanceAction to apply schema validation but bypass auth
vi.mock('@kit/next/actions', () => ({
  enhanceAction: (handler: Function, options?: any) => {
    return async (...args: any[]) => {
      // Apply schema validation if provided
      if (options?.schema) {
        const dataToValidate = args[0];
        options.schema.parse(dataToValidate);
      }
      // Call handler with all args
      return handler(...args);
    };
  },
}));

const mockRedirect = vi.mocked(redirect);

// Mock Supabase client
const mockSelect = vi.fn().mockReturnThis();
const mockUpdate = vi.fn().mockReturnThis();
const mockEq = vi.fn().mockReturnThis();
const mockMatch = vi.fn().mockReturnThis();
const mockSingle = vi.fn(() =>
  Promise.resolve({
    data: {
      id: '123e4567-e89b-12d3-a456-426614174000',
      name: 'Updated Team',
      slug: 'updated-team',
    },
    error: null,
  }),
);

const mockClient = {
  from: vi.fn(() => ({
    select: mockSelect,
    update: mockUpdate,
    eq: mockEq,
    match: mockMatch,
    single: mockSingle,
  })),
};

vi.mock('@kit/supabase/server-client', () => ({
  getSupabaseServerClient: vi.fn(() => mockClient),
}));

// Mock logger
const mockLogger = {
  info: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
};

vi.mock('@kit/shared/logger', () => ({
  getLogger: vi.fn(() => Promise.resolve(mockLogger)),
}));

// Mock audit logs - define inline to avoid hoisting issues
vi.mock('@kit/audit-logs/server', () => ({
  createAuditLog: vi.fn(() => Promise.resolve()),
  extractNetworkContext: vi.fn(() =>
    Promise.resolve({
      ipAddress: '127.0.0.1',
      userAgent: 'test-agent',
    }),
  ),
}));

const mockCreateAuditLog = vi.mocked(createAuditLog);
const mockExtractNetworkContext = vi.mocked(extractNetworkContext);

describe('updateTeamAccountName', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Reset to default successful response
    mockSingle.mockResolvedValue({
      data: {
        id: '123e4567-e89b-12d3-a456-426614174000',
        name: 'Updated Team',
        slug: 'updated-team',
      },
      error: null,
    });
  });

  describe('successful update', () => {
    it('should update team name with valid data', async () => {
      const params = {
        name: 'New Team Name',
        slug: 'old-team',
        path: '/home/[account]/settings',
      };
      const user = { id: '987fcdeb-51a2-43d7-8f9e-123456789abc' };

      // First call returns before state, second call returns after state
      mockSingle
        .mockResolvedValueOnce({
          data: {
            id: '123e4567-e89b-12d3-a456-426614174000',
            name: 'Old Team Name',
            slug: 'old-team',
          },
          error: null,
        })
        .mockResolvedValueOnce({
          data: {
            id: '123e4567-e89b-12d3-a456-426614174000',
            name: 'New Team Name',
            slug: 'new-team-name',
          },
          error: null,
        });

      await expect(updateTeamAccountName(params, user)).rejects.toThrow(
        'NEXT_REDIRECT;/home/new-team-name/settings',
      );

      expect(mockUpdate).toHaveBeenCalledWith({
        name: 'New Team Name',
        slug: 'old-team',
      });
    });

    it('should redirect to updated path with new slug', async () => {
      const params = {
        name: 'Awesome Team',
        slug: 'test-team',
        path: '/home/[account]/members',
      };
      const user = { id: '887fcdeb-51a2-43d7-8f9e-123456789abc' };

      mockSingle
        .mockResolvedValueOnce({
          data: {
            id: '223e4567-e89b-12d3-a456-426614174000',
            name: 'Test Team',
            slug: 'test-team',
          },
          error: null,
        })
        .mockResolvedValueOnce({
          data: {
            id: '223e4567-e89b-12d3-a456-426614174000',
            name: 'Awesome Team',
            slug: 'awesome-team',
          },
          error: null,
        });

      await expect(updateTeamAccountName(params, user)).rejects.toThrow(
        'NEXT_REDIRECT;/home/awesome-team/members',
      );

      expect(mockRedirect).toHaveBeenCalledWith('/home/awesome-team/members');
    });

    it('should create audit log with before and after states', async () => {
      const params = {
        name: 'Audited Team',
        slug: 'audit-team',
        path: '/home/[account]',
      };
      const user = { id: '787fcdeb-51a2-43d7-8f9e-123456789abc' };

      const beforeAccount = {
        id: '323e4567-e89b-12d3-a456-426614174000',
        name: 'Before Name',
        slug: 'audit-team',
      };

      const afterAccount = {
        id: '323e4567-e89b-12d3-a456-426614174000',
        name: 'Audited Team',
        slug: 'audited-team',
      };

      mockSingle
        .mockResolvedValueOnce({ data: beforeAccount, error: null })
        .mockResolvedValueOnce({ data: afterAccount, error: null });

      await expect(updateTeamAccountName(params, user)).rejects.toThrow(
        'NEXT_REDIRECT',
      );

      expect(mockCreateAuditLog).toHaveBeenCalledWith({
        accountId: afterAccount.id,
        userId: user.id,
        action: 'update',
        objectType: 'account',
        objectId: afterAccount.id,
        objectName: afterAccount.name,
        before: beforeAccount,
        after: afterAccount,
        scopes: [{ type: 'account', id: afterAccount.id }],
        ipAddress: '127.0.0.1',
        userAgent: 'test-agent',
      });
    });

    it('should extract network context for audit log', async () => {
      const params = {
        name: 'Network Team',
        slug: 'network-team',
        path: '/home/[account]/settings',
      };
      const user = { id: '687fcdeb-51a2-43d7-8f9e-123456789abc' };

      mockSingle
        .mockResolvedValueOnce({
          data: {
            id: '423e4567-e89b-12d3-a456-426614174000',
            name: 'Old Name',
            slug: 'network-team',
          },
          error: null,
        })
        .mockResolvedValueOnce({
          data: {
            id: '423e4567-e89b-12d3-a456-426614174000',
            name: 'Network Team',
            slug: 'network-team',
          },
          error: null,
        });

      await expect(updateTeamAccountName(params, user)).rejects.toThrow(
        'NEXT_REDIRECT',
      );

      expect(mockExtractNetworkContext).toHaveBeenCalled();
    });

    it('should log update start and completion', async () => {
      const params = {
        name: 'Logged Team',
        slug: 'logged-team',
        path: '/home/[account]',
      };
      const user = { id: '587fcdeb-51a2-43d7-8f9e-123456789abc' };

      mockSingle
        .mockResolvedValueOnce({
          data: {
            id: '523e4567-e89b-12d3-a456-426614174000',
            name: 'Before',
            slug: 'logged-team',
          },
          error: null,
        })
        .mockResolvedValueOnce({
          data: {
            id: '523e4567-e89b-12d3-a456-426614174000',
            name: 'Logged Team',
            slug: 'logged-team',
          },
          error: null,
        });

      await expect(updateTeamAccountName(params, user)).rejects.toThrow(
        'NEXT_REDIRECT',
      );

      expect(mockLogger.info).toHaveBeenCalledWith(
        {
          name: 'team-accounts.update',
          accountName: 'Logged Team',
        },
        'Updating team name...',
      );

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'team-accounts.update' }),
        'Team name updated',
      );
    });

    it('should handle unicode characters in team name', async () => {
      const params = {
        name: 'Café ☕ Team',
        slug: 'cafe-team',
        path: '/home/[account]',
      };
      const user = { id: '487fcdeb-51a2-43d7-8f9e-123456789abc' };

      mockSingle
        .mockResolvedValueOnce({
          data: {
            id: '623e4567-e89b-12d3-a456-426614174000',
            name: 'Old',
            slug: 'cafe-team',
          },
          error: null,
        })
        .mockResolvedValueOnce({
          data: {
            id: '623e4567-e89b-12d3-a456-426614174000',
            name: 'Café ☕ Team',
            slug: 'cafe-team',
          },
          error: null,
        });

      await expect(updateTeamAccountName(params, user)).rejects.toThrow(
        'NEXT_REDIRECT',
      );

      expect(mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Café ☕ Team',
        }),
      );
    });

    it('should return success when no redirect needed', async () => {
      const params = {
        name: 'No Redirect Team',
        slug: 'no-redirect',
        path: '/home/[account]',
      };
      const user = { id: '387fcdeb-51a2-43d7-8f9e-123456789abc' };

      mockSingle
        .mockResolvedValueOnce({
          data: {
            id: '723e4567-e89b-12d3-a456-426614174000',
            name: 'Old',
            slug: 'no-redirect',
          },
          error: null,
        })
        .mockResolvedValueOnce({
          data: {
            id: '723e4567-e89b-12d3-a456-426614174000',
            name: 'No Redirect Team',
            slug: null, // null slug means no redirect
          },
          error: null,
        });

      const result = await updateTeamAccountName(params, user);

      expect(result).toEqual({ success: true });
      expect(mockRedirect).not.toHaveBeenCalled();
    });
  });

  describe('schema validation', () => {
    it('should reject team name shorter than 2 characters', async () => {
      const params = {
        name: 'A',
        slug: 'test-team',
        path: '/home/[account]',
      };
      const user = { id: '287fcdeb-51a2-43d7-8f9e-123456789abc' };

      await expect(updateTeamAccountName(params, user)).rejects.toThrow();
    });

    it('should reject team name longer than 50 characters', async () => {
      const params = {
        name: 'A'.repeat(51),
        slug: 'test-team',
        path: '/home/[account]',
      };
      const user = { id: '187fcdeb-51a2-43d7-8f9e-123456789abc' };

      await expect(updateTeamAccountName(params, user)).rejects.toThrow();
    });

    it('should reject team name with special characters', async () => {
      const params = {
        name: 'Team@Name!',
        slug: 'test-team',
        path: '/home/[account]',
      };
      const user = { id: '087fcdeb-51a2-43d7-8f9e-123456789abc' };

      await expect(updateTeamAccountName(params, user)).rejects.toThrow();
    });

    it('should reject reserved name "settings"', async () => {
      const params = {
        name: 'settings',
        slug: 'test-team',
        path: '/home/[account]',
      };
      const user = { id: 'f87fcdeb-51a2-43d7-8f9e-123456789abc' };

      await expect(updateTeamAccountName(params, user)).rejects.toThrow();
    });

    it('should reject reserved name "billing"', async () => {
      const params = {
        name: 'billing',
        slug: 'test-team',
        path: '/home/[account]',
      };
      const user = { id: 'e87fcdeb-51a2-43d7-8f9e-123456789abc' };

      await expect(updateTeamAccountName(params, user)).rejects.toThrow();
    });

    it('should reject empty slug', async () => {
      const params = {
        name: 'Valid Team',
        slug: '',
        path: '/home/[account]',
      };
      const user = { id: 'd87fcdeb-51a2-43d7-8f9e-123456789abc' };

      await expect(updateTeamAccountName(params, user)).rejects.toThrow();
    });

    it('should reject empty path', async () => {
      const params = {
        name: 'Valid Team',
        slug: 'valid-team',
        path: '',
      };
      const user = { id: 'c87fcdeb-51a2-43d7-8f9e-123456789abc' };

      await expect(updateTeamAccountName(params, user)).rejects.toThrow();
    });

    it('should reject slug longer than 255 characters', async () => {
      const params = {
        name: 'Valid Team',
        slug: 'a'.repeat(256),
        path: '/home/[account]',
      };
      const user = { id: 'b87fcdeb-51a2-43d7-8f9e-123456789abc' };

      await expect(updateTeamAccountName(params, user)).rejects.toThrow();
    });

    it('should accept valid minimum length values', async () => {
      const params = {
        name: 'AB',
        slug: 'ab',
        path: '/h',
      };
      const user = { id: 'a87fcdeb-51a2-43d7-8f9e-123456789abc' };

      mockSingle
        .mockResolvedValueOnce({
          data: {
            id: '823e4567-e89b-12d3-a456-426614174000',
            name: 'Old',
            slug: 'ab',
          },
          error: null,
        })
        .mockResolvedValueOnce({
          data: {
            id: '823e4567-e89b-12d3-a456-426614174000',
            name: 'AB',
            slug: 'ab',
          },
          error: null,
        });

      await expect(updateTeamAccountName(params, user)).rejects.toThrow(
        'NEXT_REDIRECT',
      );
    });
  });

  describe('error handling', () => {
    it('should throw error when update fails', async () => {
      const params = {
        name: 'Failed Team',
        slug: 'failed-team',
        path: '/home/[account]',
      };
      const user = { id: '987fcdeb-51a2-43d7-8f9e-123456789abc' };

      const updateError = new Error('Database constraint violation');

      mockSingle
        .mockResolvedValueOnce({
          data: {
            id: '923e4567-e89b-12d3-a456-426614174000',
            name: 'Old',
            slug: 'failed-team',
          },
          error: null,
        })
        .mockResolvedValueOnce({
          data: null,
          error: updateError,
        });

      await expect(updateTeamAccountName(params, user)).rejects.toThrow(
        'Database constraint violation',
      );
    });

    it('should log error when update fails', async () => {
      const params = {
        name: 'Error Team',
        slug: 'error-team',
        path: '/home/[account]',
      };
      const user = { id: '887fcdeb-51a2-43d7-8f9e-123456789abc' };

      const updateError = new Error('Update failed');

      mockSingle
        .mockResolvedValueOnce({
          data: {
            id: 'a23e4567-e89b-12d3-a456-426614174000',
            name: 'Old',
            slug: 'error-team',
          },
          error: null,
        })
        .mockResolvedValueOnce({
          data: null,
          error: updateError,
        });

      await expect(updateTeamAccountName(params, user)).rejects.toThrow();

      expect(mockLogger.error).toHaveBeenCalledWith(
        {
          name: 'team-accounts.update',
          accountName: 'Error Team',
          error: updateError,
        },
        'Failed to update team name',
      );
    });

    it('should not create audit log when update fails', async () => {
      const params = {
        name: 'No Audit Team',
        slug: 'no-audit',
        path: '/home/[account]',
      };
      const user = { id: '787fcdeb-51a2-43d7-8f9e-123456789abc' };

      mockSingle
        .mockResolvedValueOnce({
          data: {
            id: 'b23e4567-e89b-12d3-a456-426614174000',
            name: 'Old',
            slug: 'no-audit',
          },
          error: null,
        })
        .mockResolvedValueOnce({
          data: null,
          error: new Error('Failed'),
        });

      await expect(updateTeamAccountName(params, user)).rejects.toThrow();

      expect(mockCreateAuditLog).not.toHaveBeenCalled();
    });

    it('should not redirect when update fails', async () => {
      const params = {
        name: 'No Redirect Team',
        slug: 'no-redirect',
        path: '/home/[account]',
      };
      const user = { id: '687fcdeb-51a2-43d7-8f9e-123456789abc' };

      mockSingle
        .mockResolvedValueOnce({
          data: {
            id: 'c23e4567-e89b-12d3-a456-426614174000',
            name: 'Old',
            slug: 'no-redirect',
          },
          error: null,
        })
        .mockResolvedValueOnce({
          data: null,
          error: new Error('Failed'),
        });

      await expect(updateTeamAccountName(params, user)).rejects.toThrow();

      expect(mockRedirect).not.toHaveBeenCalled();
    });

    it('should handle missing before state gracefully', async () => {
      const params = {
        name: 'Missing Before',
        slug: 'missing-before',
        path: '/home/[account]',
      };
      const user = { id: '587fcdeb-51a2-43d7-8f9e-123456789abc' };

      // First call returns null (no before state)
      mockSingle
        .mockResolvedValueOnce({
          data: null,
          error: null,
        })
        .mockResolvedValueOnce({
          data: {
            id: 'd23e4567-e89b-12d3-a456-426614174000',
            name: 'Missing Before',
            slug: 'missing-before',
          },
          error: null,
        });

      await expect(updateTeamAccountName(params, user)).rejects.toThrow(
        'NEXT_REDIRECT',
      );

      // Should not create audit log without before state
      expect(mockCreateAuditLog).not.toHaveBeenCalled();
    });
  });

  describe('edge cases', () => {
    it('should handle null user', async () => {
      const params = {
        name: 'Test Team',
        slug: 'test-team',
        path: '/home/[account]',
      };

      await expect(
        updateTeamAccountName(params, null as any),
      ).rejects.toThrow();
    });

    it('should handle user without id', async () => {
      const params = {
        name: 'Test Team',
        slug: 'test-team',
        path: '/home/[account]',
      };
      const user = {} as any;

      await expect(updateTeamAccountName(params, user)).rejects.toThrow();
    });

    it('should handle missing name field', async () => {
      const params = {
        slug: 'test-team',
        path: '/home/[account]',
      };
      const user = { id: '487fcdeb-51a2-43d7-8f9e-123456789abc' };

      await expect(
        updateTeamAccountName(params as any, user),
      ).rejects.toThrow();
    });

    it('should handle path replacement correctly', async () => {
      const params = {
        name: 'Path Test',
        slug: 'old-slug',
        path: '/home/[account]/deeply/nested/[account]/path',
      };
      const user = { id: '387fcdeb-51a2-43d7-8f9e-123456789abc' };

      mockSingle
        .mockResolvedValueOnce({
          data: {
            id: 'e23e4567-e89b-12d3-a456-426614174000',
            name: 'Old',
            slug: 'old-slug',
          },
          error: null,
        })
        .mockResolvedValueOnce({
          data: {
            id: 'e23e4567-e89b-12d3-a456-426614174000',
            name: 'Path Test',
            slug: 'new-slug',
          },
          error: null,
        });

      await expect(updateTeamAccountName(params, user)).rejects.toThrow(
        'NEXT_REDIRECT;/home/new-slug/deeply/nested/[account]/path',
      );

      // Only first [account] should be replaced
      expect(mockRedirect).toHaveBeenCalledWith(
        '/home/new-slug/deeply/nested/[account]/path',
      );
    });
  });

  describe('integration flow', () => {
    it('should complete full update flow', async () => {
      const params = {
        name: 'Full Flow Team',
        slug: 'full-flow',
        path: '/home/[account]/settings',
      };
      const user = { id: '287fcdeb-51a2-43d7-8f9e-123456789abc' };

      const beforeAccount = {
        id: 'f23e4567-e89b-12d3-a456-426614174000',
        name: 'Old Flow Team',
        slug: 'full-flow',
      };

      const afterAccount = {
        id: 'f23e4567-e89b-12d3-a456-426614174000',
        name: 'Full Flow Team',
        slug: 'full-flow-team',
      };

      mockSingle
        .mockResolvedValueOnce({ data: beforeAccount, error: null })
        .mockResolvedValueOnce({ data: afterAccount, error: null });

      await expect(updateTeamAccountName(params, user)).rejects.toThrow(
        'NEXT_REDIRECT;/home/full-flow-team/settings',
      );

      // Verify full flow
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'team-accounts.update' }),
        'Updating team name...',
      );

      expect(mockClient.from).toHaveBeenCalledWith('accounts');
      expect(mockUpdate).toHaveBeenCalled();
      expect(mockMatch).toHaveBeenCalledWith({ slug: 'full-flow' });

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'team-accounts.update' }),
        'Team name updated',
      );

      expect(mockExtractNetworkContext).toHaveBeenCalled();

      expect(mockCreateAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          accountId: afterAccount.id,
          userId: user.id,
          action: 'update',
          before: beforeAccount,
          after: afterAccount,
        }),
      );

      expect(mockRedirect).toHaveBeenCalledWith(
        '/home/full-flow-team/settings',
      );
    });
  });
});
