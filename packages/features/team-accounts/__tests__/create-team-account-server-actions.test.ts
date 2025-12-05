import { redirect } from 'next/navigation';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createAuditLog, extractNetworkContext } from '@kit/audit-logs/server';

import { createTeamAccountAction } from '../src/server/actions/create-team-account-server-actions';

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
const mockClient = {
  from: vi.fn(() => ({
    select: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    single: vi.fn(() => Promise.resolve({ data: null, error: null })),
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

// Mock create team account service
const mockCreateNewOrganizationAccount = vi.fn(() =>
  Promise.resolve({
    data: {
      id: '123e4567-e89b-12d3-a456-426614174000',
      name: 'Test Team',
      slug: 'test-team',
    },
    error: null,
  }),
);

vi.mock('../src/server/services/create-team-account.service', () => ({
  createCreateTeamAccountService: vi.fn(() => ({
    createNewOrganizationAccount: mockCreateNewOrganizationAccount,
  })),
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

describe('createTeamAccountAction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset to default successful response
    mockCreateNewOrganizationAccount.mockResolvedValue({
      data: {
        id: '123e4567-e89b-12d3-a456-426614174000',
        name: 'Test Team',
        slug: 'test-team',
      },
      error: null,
    });
  });

  describe('successful account creation', () => {
    it('should create team account with valid name', async () => {
      const user = { id: '987fcdeb-51a2-43d7-8f9e-123456789abc' };
      const data = { name: 'Test Team' };

      await expect(createTeamAccountAction(data, user)).rejects.toThrow(
        'NEXT_REDIRECT;/home/test-team',
      );

      expect(mockCreateNewOrganizationAccount).toHaveBeenCalledWith({
        name: 'Test Team',
        userId: user.id,
      });
    });

    it('should redirect to team home page after creation', async () => {
      const user = { id: '887fcdeb-51a2-43d7-8f9e-123456789abc' };
      const data = { name: 'My Team' };

      mockCreateNewOrganizationAccount.mockResolvedValueOnce({
        data: {
          id: '223e4567-e89b-12d3-a456-426614174000',
          name: 'My Team',
          slug: 'my-team',
        },
        error: null,
      });

      await expect(createTeamAccountAction(data, user)).rejects.toThrow(
        'NEXT_REDIRECT;/home/my-team',
      );

      expect(mockRedirect).toHaveBeenCalledWith('/home/my-team');
    });

    it('should create audit log after account creation', async () => {
      const user = { id: '787fcdeb-51a2-43d7-8f9e-123456789abc' };
      const data = { name: 'Audit Team' };

      const accountData = {
        id: '323e4567-e89b-12d3-a456-426614174000',
        name: 'Audit Team',
        slug: 'audit-team',
      };

      mockCreateNewOrganizationAccount.mockResolvedValueOnce({
        data: accountData,
        error: null,
      });

      await expect(createTeamAccountAction(data, user)).rejects.toThrow(
        'NEXT_REDIRECT',
      );

      expect(mockCreateAuditLog).toHaveBeenCalledWith({
        accountId: accountData.id,
        userId: user.id,
        action: 'create',
        objectType: 'account',
        objectId: accountData.id,
        objectName: accountData.name,
        after: accountData,
        scopes: [{ type: 'account', id: accountData.id }],
        ipAddress: '127.0.0.1',
        userAgent: 'test-agent',
      });
    });

    it('should extract network context for audit log', async () => {
      const user = { id: '687fcdeb-51a2-43d7-8f9e-123456789abc' };
      const data = { name: 'Network Team' };

      await expect(createTeamAccountAction(data, user)).rejects.toThrow(
        'NEXT_REDIRECT',
      );

      expect(mockExtractNetworkContext).toHaveBeenCalled();
    });

    it('should log creation start and completion', async () => {
      const user = { id: '587fcdeb-51a2-43d7-8f9e-123456789abc' };
      const data = { name: 'Logged Team' };

      await expect(createTeamAccountAction(data, user)).rejects.toThrow(
        'NEXT_REDIRECT',
      );

      expect(mockLogger.info).toHaveBeenCalledWith(
        {
          name: 'team-accounts.create',
          userId: user.id,
          accountName: 'Logged Team',
        },
        'Creating team account...',
      );

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'team-accounts.create',
          userId: user.id,
        }),
        'Team account created',
      );
    });

    it('should handle unicode characters in team name', async () => {
      const user = { id: '487fcdeb-51a2-43d7-8f9e-123456789abc' };
      const data = { name: 'Café ☕ Team' };

      mockCreateNewOrganizationAccount.mockResolvedValueOnce({
        data: {
          id: '423e4567-e89b-12d3-a456-426614174000',
          name: 'Café ☕ Team',
          slug: 'cafe-team',
        },
        error: null,
      });

      await expect(createTeamAccountAction(data, user)).rejects.toThrow(
        'NEXT_REDIRECT',
      );

      expect(mockCreateNewOrganizationAccount).toHaveBeenCalledWith({
        name: 'Café ☕ Team',
        userId: user.id,
      });
    });

    it('should handle emoji in team name', async () => {
      const user = { id: '387fcdeb-51a2-43d7-8f9e-123456789abc' };
      const data = { name: '🚀 Rocket Team' };

      mockCreateNewOrganizationAccount.mockResolvedValueOnce({
        data: {
          id: '523e4567-e89b-12d3-a456-426614174000',
          name: '🚀 Rocket Team',
          slug: 'rocket-team',
        },
        error: null,
      });

      await expect(createTeamAccountAction(data, user)).rejects.toThrow(
        'NEXT_REDIRECT',
      );

      expect(mockCreateNewOrganizationAccount).toHaveBeenCalledWith({
        name: '🚀 Rocket Team',
        userId: user.id,
      });
    });
  });

  describe('schema validation', () => {
    it('should reject team name shorter than 2 characters', async () => {
      const user = { id: '287fcdeb-51a2-43d7-8f9e-123456789abc' };
      const data = { name: 'A' };

      await expect(createTeamAccountAction(data, user)).rejects.toThrow();
    });

    it('should reject team name longer than 50 characters', async () => {
      const user = { id: '187fcdeb-51a2-43d7-8f9e-123456789abc' };
      const data = {
        name: 'This is a very long team name that exceeds the maximum allowed length of 50 characters',
      };

      await expect(createTeamAccountAction(data, user)).rejects.toThrow();
    });

    it('should reject team name with special characters', async () => {
      const user = { id: '087fcdeb-51a2-43d7-8f9e-123456789abc' };
      const data = { name: 'Team@Name!' };

      await expect(createTeamAccountAction(data, user)).rejects.toThrow();
    });

    it('should reject reserved name "settings"', async () => {
      const user = { id: 'f87fcdeb-51a2-43d7-8f9e-123456789abc' };
      const data = { name: 'settings' };

      await expect(createTeamAccountAction(data, user)).rejects.toThrow();
    });

    it('should reject reserved name "billing"', async () => {
      const user = { id: 'e87fcdeb-51a2-43d7-8f9e-123456789abc' };
      const data = { name: 'billing' };

      await expect(createTeamAccountAction(data, user)).rejects.toThrow();
    });

    it('should reject reserved names case-insensitively', async () => {
      const user = { id: 'd87fcdeb-51a2-43d7-8f9e-123456789abc' };
      const data = { name: 'SETTINGS' };

      await expect(createTeamAccountAction(data, user)).rejects.toThrow();
    });

    it('should accept valid 2-character team name', async () => {
      const user = { id: 'c87fcdeb-51a2-43d7-8f9e-123456789abc' };
      const data = { name: 'AB' };

      mockCreateNewOrganizationAccount.mockResolvedValueOnce({
        data: {
          id: '623e4567-e89b-12d3-a456-426614174000',
          name: 'AB',
          slug: 'ab',
        },
        error: null,
      });

      await expect(createTeamAccountAction(data, user)).rejects.toThrow(
        'NEXT_REDIRECT',
      );
    });

    it('should accept valid 50-character team name', async () => {
      const user = { id: 'b87fcdeb-51a2-43d7-8f9e-123456789abc' };
      const data = { name: 'A'.repeat(50) };

      mockCreateNewOrganizationAccount.mockResolvedValueOnce({
        data: {
          id: '723e4567-e89b-12d3-a456-426614174000',
          name: 'A'.repeat(50),
          slug: 'a-long-slug',
        },
        error: null,
      });

      await expect(createTeamAccountAction(data, user)).rejects.toThrow(
        'NEXT_REDIRECT',
      );
    });

    it('should accept team name with spaces', async () => {
      const user = { id: 'a87fcdeb-51a2-43d7-8f9e-123456789abc' };
      const data = { name: 'My Great Team' };

      mockCreateNewOrganizationAccount.mockResolvedValueOnce({
        data: {
          id: '823e4567-e89b-12d3-a456-426614174000',
          name: 'My Great Team',
          slug: 'my-great-team',
        },
        error: null,
      });

      await expect(createTeamAccountAction(data, user)).rejects.toThrow(
        'NEXT_REDIRECT',
      );
    });

    it('should accept team name with hyphens and underscores', async () => {
      const user = { id: '987fcdeb-51a2-43d7-8f9e-123456789abc' };
      const data = { name: 'My-Team_Name' };

      mockCreateNewOrganizationAccount.mockResolvedValueOnce({
        data: {
          id: '923e4567-e89b-12d3-a456-426614174000',
          name: 'My-Team_Name',
          slug: 'my-team-name',
        },
        error: null,
      });

      await expect(createTeamAccountAction(data, user)).rejects.toThrow(
        'NEXT_REDIRECT',
      );
    });
  });

  describe('error handling', () => {
    it('should return error when service fails', async () => {
      const user = { id: '887fcdeb-51a2-43d7-8f9e-123456789abc' };
      const data = { name: 'Failed Team' };

      const serviceError = new Error('Database error');

      mockCreateNewOrganizationAccount.mockResolvedValueOnce({
        data: null,
        error: serviceError,
      });

      const result = await createTeamAccountAction(data, user);

      expect(result).toEqual({ error: true });
      expect(mockRedirect).not.toHaveBeenCalled();
    });

    it('should log error when creation fails', async () => {
      const user = { id: '787fcdeb-51a2-43d7-8f9e-123456789abc' };
      const data = { name: 'Error Team' };

      const serviceError = new Error('Creation failed');

      mockCreateNewOrganizationAccount.mockResolvedValueOnce({
        data: null,
        error: serviceError,
      });

      await createTeamAccountAction(data, user);

      expect(mockLogger.error).toHaveBeenCalledWith(
        {
          name: 'team-accounts.create',
          userId: user.id,
          accountName: 'Error Team',
          error: serviceError,
        },
        'Failed to create team account',
      );
    });

    it('should not create audit log on failure', async () => {
      const user = { id: '687fcdeb-51a2-43d7-8f9e-123456789abc' };
      const data = { name: 'No Audit Team' };

      mockCreateNewOrganizationAccount.mockResolvedValueOnce({
        data: null,
        error: new Error('Failed'),
      });

      await createTeamAccountAction(data, user);

      expect(mockCreateAuditLog).not.toHaveBeenCalled();
    });

    it('should not redirect on failure', async () => {
      const user = { id: '587fcdeb-51a2-43d7-8f9e-123456789abc' };
      const data = { name: 'No Redirect Team' };

      mockCreateNewOrganizationAccount.mockResolvedValueOnce({
        data: null,
        error: new Error('Failed'),
      });

      await createTeamAccountAction(data, user);

      expect(mockRedirect).not.toHaveBeenCalled();
    });

    it('should handle service throwing exception', async () => {
      const user = { id: '487fcdeb-51a2-43d7-8f9e-123456789abc' };
      const data = { name: 'Exception Team' };

      mockCreateNewOrganizationAccount.mockRejectedValueOnce(
        new Error('Unexpected error'),
      );

      await expect(createTeamAccountAction(data, user)).rejects.toThrow(
        'Unexpected error',
      );
    });
  });

  describe('edge cases', () => {
    it('should handle null user', async () => {
      const data = { name: 'Test Team' };

      await expect(
        createTeamAccountAction(data, null as any),
      ).rejects.toThrow();
    });

    it('should handle user without id', async () => {
      const data = { name: 'Test Team' };
      const user = {} as any;

      await expect(createTeamAccountAction(data, user)).rejects.toThrow();
    });

    it('should handle missing name field', async () => {
      const user = { id: '387fcdeb-51a2-43d7-8f9e-123456789abc' };

      await expect(createTeamAccountAction({} as any, user)).rejects.toThrow();
    });

    it('should handle empty string name', async () => {
      const user = { id: '287fcdeb-51a2-43d7-8f9e-123456789abc' };
      const data = { name: '' };

      await expect(createTeamAccountAction(data, user)).rejects.toThrow();
    });

    it('should handle whitespace-only name', async () => {
      const user = { id: '187fcdeb-51a2-43d7-8f9e-123456789abc' };
      const data = { name: '   ' };

      await expect(createTeamAccountAction(data, user)).rejects.toThrow();
    });
  });

  describe('integration flow', () => {
    it('should complete full creation flow', async () => {
      const user = { id: '087fcdeb-51a2-43d7-8f9e-123456789abc' };
      const data = { name: 'Full Flow Team' };

      const accountData = {
        id: 'a23e4567-e89b-12d3-a456-426614174000',
        name: 'Full Flow Team',
        slug: 'full-flow-team',
      };

      mockCreateNewOrganizationAccount.mockResolvedValueOnce({
        data: accountData,
        error: null,
      });

      await expect(createTeamAccountAction(data, user)).rejects.toThrow(
        'NEXT_REDIRECT;/home/full-flow-team',
      );

      // Verify full flow
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'team-accounts.create' }),
        'Creating team account...',
      );

      expect(mockCreateNewOrganizationAccount).toHaveBeenCalledWith({
        name: 'Full Flow Team',
        userId: user.id,
      });

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'team-accounts.create' }),
        'Team account created',
      );

      expect(mockExtractNetworkContext).toHaveBeenCalled();

      expect(mockCreateAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          accountId: accountData.id,
          userId: user.id,
          action: 'create',
          objectType: 'account',
        }),
      );

      expect(mockRedirect).toHaveBeenCalledWith('/home/full-flow-team');
    });

    it('should not proceed beyond error point on failure', async () => {
      const user = { id: 'f86fcdeb-51a2-43d7-8f9e-123456789abc' };
      const data = { name: 'Failed Flow Team' };

      mockCreateNewOrganizationAccount.mockResolvedValueOnce({
        data: null,
        error: new Error('Creation failed'),
      });

      const result = await createTeamAccountAction(data, user);

      // Should return error
      expect(result).toEqual({ error: true });

      // Should log error
      expect(mockLogger.error).toHaveBeenCalled();

      // Should not proceed to audit log or redirect
      expect(mockCreateAuditLog).not.toHaveBeenCalled();
      expect(mockRedirect).not.toHaveBeenCalled();
    });
  });
});
