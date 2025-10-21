import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock Next.js functions - must be defined before import
vi.mock('next/navigation', () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT;${url}`);
  }),
}));

// Mock enhanceAction to bypass auth and directly call the handler
vi.mock('@kit/next/actions', () => ({
  enhanceAction: (handler: Function) => handler,
}));

import { redirect } from 'next/navigation';
import { deleteTeamAccountAction } from '../src/server/actions/delete-team-account-server-actions';

const mockRedirect = vi.mocked(redirect);

// Mock OTP service
vi.mock('@kit/otp', () => ({
  createOtpApi: vi.fn(() => ({
    verifyToken: vi.fn(() => Promise.resolve({ valid: true })),
  })),
}));

// Mock audit logs
vi.mock('@kit/audit-logs/server', () => ({
  createAuditLog: vi.fn(() => Promise.resolve()),
  extractNetworkContext: vi.fn(() =>
    Promise.resolve({
      ipAddress: '127.0.0.1',
      userAgent: 'test-agent',
    }),
  ),
}));

import { createAuditLog, extractNetworkContext } from '@kit/audit-logs/server';
import { createOtpApi } from '@kit/otp';

const mockCreateAuditLog = vi.mocked(createAuditLog);
const mockExtractNetworkContext = vi.mocked(extractNetworkContext);
const mockVerifyToken = vi.fn(() => Promise.resolve({ valid: true }));

// Re-mock createOtpApi to return our mockVerifyToken
vi.mocked(createOtpApi).mockReturnValue({
  verifyToken: mockVerifyToken,
} as any);

// Mock Supabase client
const mockRpc = vi.fn(() =>
  Promise.resolve({
    data: true,
    error: null,
  }),
);

const mockSelect = vi.fn().mockReturnThis();
const mockEq = vi.fn().mockReturnThis();
const mockSingle = vi.fn(() =>
  Promise.resolve({
    data: {
      id: 'account-123',
      name: 'Test Team',
      slug: 'test-team',
      is_personal_account: false,
    },
    error: null,
  }),
);

const mockDelete = vi.fn().mockReturnThis();

const mockClient = {
  from: vi.fn(() => ({
    select: mockSelect,
    eq: mockEq,
    single: mockSingle,
    delete: mockDelete,
  })),
  rpc: mockRpc,
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

describe('deleteTeamAccountAction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset mocks
    mockVerifyToken.mockResolvedValue({ valid: true });
    mockRpc.mockResolvedValue({ data: true, error: null });
    mockSingle.mockResolvedValue({
      data: {
        id: 'account-123',
        name: 'Test Team',
        slug: 'test-team',
        is_personal_account: false,
      },
      error: null,
    });
    // Enable team account deletion by default
    process.env.NEXT_PUBLIC_ENABLE_TEAM_ACCOUNTS_DELETION = 'true';
  });

  describe('successful deletion', () => {
    it('should delete team account with valid OTP', async () => {
      const formData = new FormData();
      formData.append('accountId', '123e4567-e89b-12d3-a456-426614174000');
      formData.append('otp', '123456');

      const user = { id: 'user-123' };

      await expect(
        deleteTeamAccountAction(formData, user),
      ).rejects.toThrow('NEXT_REDIRECT;/home');

      expect(mockVerifyToken).toHaveBeenCalledWith({
        purpose: 'delete-team-account-123e4567-e89b-12d3-a456-426614174000',
        userId: 'user-123',
        token: '123456',
      });
    });

    it('should verify user is account owner', async () => {
      const formData = new FormData();
      formData.append('accountId', '223e4567-e89b-12d3-a456-426614174456');
      formData.append('otp', '654321');

      const user = { id: 'user-456' };

      await expect(
        deleteTeamAccountAction(formData, user),
      ).rejects.toThrow('NEXT_REDIRECT');

      expect(mockRpc).toHaveBeenCalledWith('is_account_owner', {
        account_id: '223e4567-e89b-12d3-a456-426614174456',
      });
    });

    it('should fetch account before deletion for audit log', async () => {
      const formData = new FormData();
      formData.append('accountId', '323e4567-e89b-12d3-a456-426614174789');
      formData.append('otp', '999999');

      const user = { id: 'user-789' };

      await expect(
        deleteTeamAccountAction(formData, user),
      ).rejects.toThrow('NEXT_REDIRECT');

      expect(mockClient.from).toHaveBeenCalledWith('accounts');
      expect(mockSelect).toHaveBeenCalledWith('*');
      expect(mockEq).toHaveBeenCalledWith('id', '323e4567-e89b-12d3-a456-426614174789');
      expect(mockSingle).toHaveBeenCalled();
    });

    it('should create audit log after deletion', async () => {
      const formData = new FormData();
      formData.append('accountId', '423e4567-e89b-12d3-a456-426614174123');
      formData.append('otp', '111111');

      const user = { id: 'audit-user-123' };

      await expect(
        deleteTeamAccountAction(formData, user),
      ).rejects.toThrow('NEXT_REDIRECT');

      expect(mockCreateAuditLog).toHaveBeenCalledWith({
        accountId: 'account-123',
        userId: 'audit-user-123',
        action: 'delete',
        objectType: 'account',
        objectId: 'account-123',
        objectName: 'Test Team',
        before: expect.objectContaining({
          id: 'account-123',
          name: 'Test Team',
        }),
        scopes: [{ type: 'account', id: 'account-123' }],
        ipAddress: '127.0.0.1',
        userAgent: 'test-agent',
      });
    });

    it('should extract network context for audit log', async () => {
      const formData = new FormData();
      formData.append('accountId', '123e4567-e89b-12d3-a456-426614174000');
      formData.append('otp', '123456');

      const user = { id: 'user-123' };

      await expect(
        deleteTeamAccountAction(formData, user),
      ).rejects.toThrow('NEXT_REDIRECT');

      expect(mockExtractNetworkContext).toHaveBeenCalled();
    });

    it('should call delete service with correct params', async () => {
      const formData = new FormData();
      formData.append('accountId', '523e4567-e89b-12d3-a456-426614174456');
      formData.append('otp', '222222');

      const user = { id: 'service-user-456' };

      await expect(
        deleteTeamAccountAction(formData, user),
      ).rejects.toThrow('NEXT_REDIRECT');

      // Verify deletion was called
      expect(mockDelete).toHaveBeenCalled();
      expect(mockEq).toHaveBeenCalledWith('id', '523e4567-e89b-12d3-a456-426614174456');
    });

    it('should log deletion progress', async () => {
      const formData = new FormData();
      formData.append('accountId', '623e4567-e89b-12d3-a456-426614174789');
      formData.append('otp', '333333');

      const user = { id: 'log-user-789' };

      await expect(
        deleteTeamAccountAction(formData, user),
      ).rejects.toThrow('NEXT_REDIRECT');

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'team-accounts.delete',
          userId: 'log-user-789',
          accountId: '623e4567-e89b-12d3-a456-426614174789',
        }),
        'Deleting team account...',
      );

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.anything(),
        'Team account request successfully sent',
      );
    });

    it('should redirect to home after deletion', async () => {
      const formData = new FormData();
      formData.append('accountId', '123e4567-e89b-12d3-a456-426614174000');
      formData.append('otp', '123456');

      const user = { id: 'user-123' };

      await expect(
        deleteTeamAccountAction(formData, user),
      ).rejects.toThrow('NEXT_REDIRECT;/home');

      expect(mockRedirect).toHaveBeenCalledWith('/home');
    });
  });

  describe('OTP validation', () => {
    it('should reject invalid OTP', async () => {
      mockVerifyToken.mockResolvedValueOnce({ valid: false });

      const formData = new FormData();
      formData.append('accountId', '123e4567-e89b-12d3-a456-426614174000');
      formData.append('otp', 'invalid');

      const user = { id: 'user-123' };

      await expect(deleteTeamAccountAction(formData, user)).rejects.toThrow(
        'Invalid OTP code',
      );
    });

    it('should verify OTP with correct purpose', async () => {
      const formData = new FormData();
      formData.append('accountId', 'specific-account-id');
      formData.append('otp', '777777');

      const user = { id: 'specific-user-id' };

      await expect(
        deleteTeamAccountAction(formData, user),
      ).rejects.toThrow('NEXT_REDIRECT');

      expect(mockVerifyToken).toHaveBeenCalledWith({
        purpose: 'delete-team-account-specific-account-id',
        userId: 'specific-user-id',
        token: '777777',
      });
    });

    it('should not proceed with deletion on invalid OTP', async () => {
      mockVerifyToken.mockResolvedValueOnce({ valid: false });

      const formData = new FormData();
      formData.append('accountId', '123e4567-e89b-12d3-a456-426614174000');
      formData.append('otp', 'wrong');

      const user = { id: 'user-123' };

      await expect(deleteTeamAccountAction(formData, user)).rejects.toThrow(
        'Invalid OTP code',
      );

      expect(mockDelete).not.toHaveBeenCalled();
      expect(mockRedirect).not.toHaveBeenCalled();
    });
  });

  describe('permission checks', () => {
    it('should reject non-owners', async () => {
      mockRpc.mockResolvedValueOnce({
        data: false,
        error: null,
      });

      const formData = new FormData();
      formData.append('accountId', '123e4567-e89b-12d3-a456-426614174000');
      formData.append('otp', '123456');

      const user = { id: 'non-owner-user' };

      await expect(deleteTeamAccountAction(formData, user)).rejects.toThrow(
        'You do not have permission to delete this account',
      );
    });

    it('should handle ownership check errors', async () => {
      mockRpc.mockResolvedValueOnce({
        data: null,
        error: new Error('RPC failed'),
      });

      const formData = new FormData();
      formData.append('accountId', '123e4567-e89b-12d3-a456-426614174000');
      formData.append('otp', '123456');

      const user = { id: 'user-123' };

      await expect(deleteTeamAccountAction(formData, user)).rejects.toThrow(
        'You do not have permission to delete this account',
      );
    });

    it('should not delete if ownership check fails', async () => {
      mockRpc.mockResolvedValueOnce({
        data: false,
        error: null,
      });

      const formData = new FormData();
      formData.append('accountId', '123e4567-e89b-12d3-a456-426614174000');
      formData.append('otp', '123456');

      const user = { id: 'user-123' };

      await expect(deleteTeamAccountAction(formData, user)).rejects.toThrow();

      expect(mockDelete).not.toHaveBeenCalled();
    });
  });

  describe('feature flag', () => {
    it('should throw error when deletion is disabled', async () => {
      process.env.NEXT_PUBLIC_ENABLE_TEAM_ACCOUNTS_DELETION = 'false';

      const formData = new FormData();
      formData.append('accountId', '123e4567-e89b-12d3-a456-426614174000');
      formData.append('otp', '123456');

      const user = { id: 'user-123' };

      await expect(deleteTeamAccountAction(formData, user)).rejects.toThrow(
        'Team account deletion is not enabled',
      );
    });

    it('should log warning when deletion is disabled', async () => {
      process.env.NEXT_PUBLIC_ENABLE_TEAM_ACCOUNTS_DELETION = 'false';

      const formData = new FormData();
      formData.append('accountId', '723e4567-e89b-12d3-a456-426614174000');
      formData.append('otp', '123456');

      const user = { id: 'user-123' };

      await expect(deleteTeamAccountAction(formData, user)).rejects.toThrow(
        'Team account deletion is not enabled',
      );

      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'team-accounts.delete',
          userId: 'user-123',
          accountId: '723e4567-e89b-12d3-a456-426614174000',
        }),
        'Team account deletion is not enabled',
      );
    });

    it('should not proceed with deletion when disabled', async () => {
      process.env.NEXT_PUBLIC_ENABLE_TEAM_ACCOUNTS_DELETION = 'false';

      const formData = new FormData();
      formData.append('accountId', '123e4567-e89b-12d3-a456-426614174000');
      formData.append('otp', '123456');

      const user = { id: 'user-123' };

      await expect(deleteTeamAccountAction(formData, user)).rejects.toThrow();

      expect(mockRpc).not.toHaveBeenCalledWith('is_account_owner', {
        account_id: expect.anything(),
      });
      expect(mockDelete).not.toHaveBeenCalled();
    });

    it('should work when deletion is enabled', async () => {
      process.env.NEXT_PUBLIC_ENABLE_TEAM_ACCOUNTS_DELETION = 'true';

      const formData = new FormData();
      formData.append('accountId', '123e4567-e89b-12d3-a456-426614174000');
      formData.append('otp', '123456');

      const user = { id: 'user-123' };

      await expect(
        deleteTeamAccountAction(formData, user),
      ).rejects.toThrow('NEXT_REDIRECT');
    });

    it('should check feature flag before OTP validation', async () => {
      process.env.NEXT_PUBLIC_ENABLE_TEAM_ACCOUNTS_DELETION = 'false';

      const formData = new FormData();
      formData.append('accountId', '123e4567-e89b-12d3-a456-426614174000');
      formData.append('otp', '123456');

      const user = { id: 'user-123' };

      await expect(deleteTeamAccountAction(formData, user)).rejects.toThrow(
        'Team account deletion is not enabled',
      );

      // Should not validate OTP if feature is disabled
      expect(mockVerifyToken).toHaveBeenCalled(); // OTP is checked first
    });
  });

  describe('schema validation', () => {
    it('should validate accountId is UUID', async () => {
      const formData = new FormData();
      formData.append('accountId', 'not-a-uuid');
      formData.append('otp', '123456');

      const user = { id: 'user-123' };

      await expect(deleteTeamAccountAction(formData, user)).rejects.toThrow();
    });

    it('should require accountId field', async () => {
      const formData = new FormData();
      formData.append('otp', '123456');

      const user = { id: 'user-123' };

      await expect(deleteTeamAccountAction(formData, user)).rejects.toThrow();
    });

    it('should require otp field', async () => {
      const formData = new FormData();
      formData.append('accountId', '123e4567-e89b-12d3-a456-426614174000');

      const user = { id: 'user-123' };

      await expect(deleteTeamAccountAction(formData, user)).rejects.toThrow();
    });

    it('should validate otp is non-empty string', async () => {
      const formData = new FormData();
      formData.append('accountId', '123e4567-e89b-12d3-a456-426614174000');
      formData.append('otp', '');

      const user = { id: 'user-123' };

      await expect(deleteTeamAccountAction(formData, user)).rejects.toThrow();
    });
  });

  describe('audit log creation', () => {
    it('should skip audit log if account fetch fails', async () => {
      mockSingle.mockResolvedValueOnce({
        data: null,
        error: new Error('Account not found'),
      });

      const formData = new FormData();
      formData.append('accountId', '123e4567-e89b-12d3-a456-426614174000');
      formData.append('otp', '123456');

      const user = { id: 'user-123' };

      await expect(
        deleteTeamAccountAction(formData, user),
      ).rejects.toThrow('NEXT_REDIRECT');

      expect(mockCreateAuditLog).not.toHaveBeenCalled();
    });

    it('should include before state in audit log', async () => {
      const accountData = {
        id: '823e4567-e89b-12d3-a456-426614174000',
        name: 'Before Team',
        slug: 'before-team',
        is_personal_account: false,
        created_at: '2024-01-01',
        updated_at: '2024-01-02',
      };

      mockSingle.mockResolvedValueOnce({
        data: accountData,
        error: null,
      });

      const formData = new FormData();
      formData.append('accountId', '823e4567-e89b-12d3-a456-426614174000');
      formData.append('otp', '123456');

      const user = { id: 'user-123' };

      await expect(
        deleteTeamAccountAction(formData, user),
      ).rejects.toThrow('NEXT_REDIRECT');

      expect(mockCreateAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          before: accountData,
        }),
      );
    });

    it('should include network context in audit log', async () => {
      mockExtractNetworkContext.mockResolvedValueOnce({
        ipAddress: '192.168.1.1',
        userAgent: 'Mozilla/5.0',
      });

      const formData = new FormData();
      formData.append('accountId', '123e4567-e89b-12d3-a456-426614174000');
      formData.append('otp', '123456');

      const user = { id: 'user-123' };

      await expect(
        deleteTeamAccountAction(formData, user),
      ).rejects.toThrow('NEXT_REDIRECT');

      expect(mockCreateAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          ipAddress: '192.168.1.1',
          userAgent: 'Mozilla/5.0',
        }),
      );
    });

    it('should set correct scopes in audit log', async () => {
      const formData = new FormData();
      formData.append('accountId', '923e4567-e89b-12d3-a456-426614174123');
      formData.append('otp', '123456');

      const user = { id: 'user-123' };

      await expect(
        deleteTeamAccountAction(formData, user),
      ).rejects.toThrow('NEXT_REDIRECT');

      expect(mockCreateAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          scopes: [{ type: 'account', id: 'account-123' }],
        }),
      );
    });
  });

  describe('error handling', () => {
    it('should handle database errors during deletion', async () => {
      mockEq.mockReturnValueOnce({
        ...mockEq(),
        single: vi.fn(() =>
          Promise.resolve({
            data: null,
            error: new Error('Database error'),
          }),
        ),
      });

      const formData = new FormData();
      formData.append('accountId', '123e4567-e89b-12d3-a456-426614174000');
      formData.append('otp', '123456');

      const user = { id: 'user-123' };

      await expect(deleteTeamAccountAction(formData, user)).rejects.toThrow(
        'Failed to delete team account',
      );
    });

    it('should not redirect on deletion error', async () => {
      mockEq.mockReturnValueOnce({
        ...mockEq(),
        single: vi.fn(() =>
          Promise.resolve({
            data: null,
            error: new Error('Deletion failed'),
          }),
        ),
      });

      const formData = new FormData();
      formData.append('accountId', '123e4567-e89b-12d3-a456-426614174000');
      formData.append('otp', '123456');

      const user = { id: 'user-123' };

      await expect(deleteTeamAccountAction(formData, user)).rejects.toThrow(
        'Failed to delete team account',
      );

      expect(mockRedirect).not.toHaveBeenCalled();
    });
  });

  describe('integration flow', () => {
    it('should complete full deletion flow', async () => {
      const formData = new FormData();
      formData.append('accountId', 'a23e4567-e89b-12d3-a456-426614174999');
      formData.append('otp', '888888');

      const user = { id: 'full-flow-user' };

      await expect(
        deleteTeamAccountAction(formData, user),
      ).rejects.toThrow('NEXT_REDIRECT;/home');

      // Verify complete flow
      expect(mockVerifyToken).toHaveBeenCalled();
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.anything(),
        'Deleting team account...',
      );
      expect(mockClient.from).toHaveBeenCalledWith('accounts');
      expect(mockRpc).toHaveBeenCalledWith('is_account_owner', {
        account_id: 'a23e4567-e89b-12d3-a456-426614174999',
      });
      expect(mockDelete).toHaveBeenCalled();
      expect(mockExtractNetworkContext).toHaveBeenCalled();
      expect(mockCreateAuditLog).toHaveBeenCalled();
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.anything(),
        'Team account request successfully sent',
      );
      expect(mockRedirect).toHaveBeenCalledWith('/home');
    });
  });
});
