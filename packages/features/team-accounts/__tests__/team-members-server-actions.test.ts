import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock Next.js functions - must be defined before import
vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
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

import { revalidatePath } from 'next/cache';
import {
  removeMemberFromAccountAction,
  transferOwnershipAction,
  updateMemberRoleAction,
} from '../src/server/actions/team-members-server-actions';

const mockRevalidatePath = vi.mocked(revalidatePath);

// Mock Supabase clients
const mockSelect = vi.fn().mockReturnThis();
const mockEq = vi.fn().mockReturnThis();
const mockSingle = vi.fn(() =>
  Promise.resolve({
    data: { name: 'Test Team' },
    error: null,
  }),
);
const mockRpc = vi.fn(() => Promise.resolve({ data: true, error: null }));

const mockClient = {
  from: vi.fn(() => ({
    select: mockSelect,
    eq: mockEq,
    single: mockSingle,
  })),
  rpc: mockRpc,
};

const mockAdminClient = {
  from: vi.fn(() => ({
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    single: vi.fn(() => Promise.resolve({ data: null, error: null })),
  })),
};

vi.mock('@kit/supabase/server-client', () => ({
  getSupabaseServerClient: vi.fn(() => mockClient),
}));

vi.mock('@kit/supabase/server-admin-client', () => ({
  getSupabaseServerAdminClient: vi.fn(() => mockAdminClient),
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

import { createAuditLog, extractNetworkContext } from '@kit/audit-logs/server';

const mockCreateAuditLog = vi.mocked(createAuditLog);
const mockExtractNetworkContext = vi.mocked(extractNetworkContext);

// Mock account members service
const mockRemoveMemberFromAccount = vi.fn(() => Promise.resolve());
const mockUpdateMemberRole = vi.fn(() => Promise.resolve());
const mockTransferOwnership = vi.fn(() => Promise.resolve());

vi.mock('../src/server/services/account-members.service', () => ({
  createAccountMembersService: vi.fn(() => ({
    removeMemberFromAccount: mockRemoveMemberFromAccount,
    updateMemberRole: mockUpdateMemberRole,
    transferOwnership: mockTransferOwnership,
  })),
}));

// Mock OTP API
const mockVerifyToken = vi.fn((params: any) =>
  Promise.resolve({ valid: true, user_id: params.userId })
);

vi.mock('@kit/otp', () => ({
  createOtpApi: vi.fn(() => ({
    verifyToken: mockVerifyToken,
  })),
}));

describe('team-members-server-actions', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Reset default responses
    mockSingle.mockResolvedValue({
      data: { name: 'Test Team', id: '123e4567-e89b-12d3-a456-426614174000' },
      error: null,
    });
    mockRpc.mockResolvedValue({ data: true, error: null });
    mockVerifyToken.mockImplementation((params: any) =>
      Promise.resolve({ valid: true, user_id: params.userId })
    );
  });

  describe('removeMemberFromAccountAction', () => {
    describe('successful removal', () => {
      it('should remove member with valid UUIDs', async () => {
        const data = {
          accountId: '123e4567-e89b-12d3-a456-426614174000',
          userId: '987fcdeb-51a2-43d7-8f9e-123456789abc',
        };
        const user = { id: '887fcdeb-51a2-43d7-8f9e-123456789abc' };

        const result = await removeMemberFromAccountAction(data, user);

        expect(result).toEqual({ success: true });
        expect(mockRemoveMemberFromAccount).toHaveBeenCalledWith({
          accountId: data.accountId,
          userId: data.userId,
        });
      });

      it('should revalidate account layout after removal', async () => {
        const data = {
          accountId: '223e4567-e89b-12d3-a456-426614174000',
          userId: '787fcdeb-51a2-43d7-8f9e-123456789abc',
        };
        const user = { id: '687fcdeb-51a2-43d7-8f9e-123456789abc' };

        await removeMemberFromAccountAction(data, user);

        expect(mockRevalidatePath).toHaveBeenCalledWith(
          '/home/[account]',
          'layout',
        );
      });

      it('should create audit log for member removal', async () => {
        const data = {
          accountId: '323e4567-e89b-12d3-a456-426614174000',
          userId: '587fcdeb-51a2-43d7-8f9e-123456789abc',
        };
        const user = { id: '487fcdeb-51a2-43d7-8f9e-123456789abc' };

        const accountData = {
          name: 'Audit Team',
        };

        const memberData = {
          account_id: data.accountId,
          user_id: data.userId,
          role: 'member',
        };

        mockSingle
          .mockResolvedValueOnce({ data: accountData, error: null })
          .mockResolvedValueOnce({ data: memberData, error: null });

        await removeMemberFromAccountAction(data, user);

        expect(mockCreateAuditLog).toHaveBeenCalledWith({
          accountId: data.accountId,
          userId: user.id,
          action: 'delete',
          objectType: 'team_member',
          objectId: `${data.accountId}-${data.userId}`,
          objectName: 'Team member in Audit Team',
          before: memberData,
          scopes: [{ type: 'account', id: data.accountId }],
          ipAddress: '127.0.0.1',
          userAgent: 'test-agent',
        });
      });

      it('should extract network context', async () => {
        const data = {
          accountId: '423e4567-e89b-12d3-a456-426614174000',
          userId: '387fcdeb-51a2-43d7-8f9e-123456789abc',
        };
        const user = { id: '287fcdeb-51a2-43d7-8f9e-123456789abc' };

        mockSingle
          .mockResolvedValueOnce({ data: { name: 'Team' }, error: null })
          .mockResolvedValueOnce({ data: {}, error: null });

        await removeMemberFromAccountAction(data, user);

        expect(mockExtractNetworkContext).toHaveBeenCalled();
      });

      it('should not create audit log when account data missing', async () => {
        const data = {
          accountId: '523e4567-e89b-12d3-a456-426614174000',
          userId: '187fcdeb-51a2-43d7-8f9e-123456789abc',
        };
        const user = { id: '087fcdeb-51a2-43d7-8f9e-123456789abc' };

        mockSingle
          .mockResolvedValueOnce({ data: null, error: null })
          .mockResolvedValueOnce({ data: {}, error: null });

        await removeMemberFromAccountAction(data, user);

        expect(mockCreateAuditLog).not.toHaveBeenCalled();
      });
    });

    describe('schema validation', () => {
      it('should reject invalid accountId UUID', async () => {
        const data = {
          accountId: 'invalid-uuid',
          userId: '987fcdeb-51a2-43d7-8f9e-123456789abc',
        };
        const user = { id: '887fcdeb-51a2-43d7-8f9e-123456789abc' };

        await expect(
          removeMemberFromAccountAction(data, user),
        ).rejects.toThrow();
      });

      it('should reject invalid userId UUID', async () => {
        const data = {
          accountId: '123e4567-e89b-12d3-a456-426614174000',
          userId: 'invalid-uuid',
        };
        const user = { id: '887fcdeb-51a2-43d7-8f9e-123456789abc' };

        await expect(
          removeMemberFromAccountAction(data, user),
        ).rejects.toThrow();
      });

      it('should reject missing accountId', async () => {
        const data = {
          userId: '987fcdeb-51a2-43d7-8f9e-123456789abc',
        };
        const user = { id: '887fcdeb-51a2-43d7-8f9e-123456789abc' };

        await expect(
          removeMemberFromAccountAction(data as any, user),
        ).rejects.toThrow();
      });

      it('should reject missing userId', async () => {
        const data = {
          accountId: '123e4567-e89b-12d3-a456-426614174000',
        };
        const user = { id: '887fcdeb-51a2-43d7-8f9e-123456789abc' };

        await expect(
          removeMemberFromAccountAction(data as any, user),
        ).rejects.toThrow();
      });
    });

    describe('error handling', () => {
      it('should propagate service errors', async () => {
        mockRemoveMemberFromAccount.mockRejectedValueOnce(
          new Error('Member not found'),
        );

        const data = {
          accountId: '123e4567-e89b-12d3-a456-426614174000',
          userId: '987fcdeb-51a2-43d7-8f9e-123456789abc',
        };
        const user = { id: '887fcdeb-51a2-43d7-8f9e-123456789abc' };

        await expect(
          removeMemberFromAccountAction(data, user),
        ).rejects.toThrow('Member not found');
      });
    });
  });

  describe('updateMemberRoleAction', () => {
    describe('successful update', () => {
      it('should update member role with valid data', async () => {
        const data = {
          accountId: '123e4567-e89b-12d3-a456-426614174000',
          userId: '987fcdeb-51a2-43d7-8f9e-123456789abc',
          role: 'admin',
        };
        const user = { id: '887fcdeb-51a2-43d7-8f9e-123456789abc' };

        const result = await updateMemberRoleAction(data, user);

        expect(result).toEqual({ success: true });
        expect(mockUpdateMemberRole).toHaveBeenCalledWith(data, mockAdminClient);
      });

      it('should revalidate account layout after update', async () => {
        const data = {
          accountId: '223e4567-e89b-12d3-a456-426614174000',
          userId: '787fcdeb-51a2-43d7-8f9e-123456789abc',
          role: 'member',
        };
        const user = { id: '687fcdeb-51a2-43d7-8f9e-123456789abc' };

        await updateMemberRoleAction(data, user);

        expect(mockRevalidatePath).toHaveBeenCalledWith(
          '/home/[account]',
          'layout',
        );
      });

      it('should use admin client for role update', async () => {
        const data = {
          accountId: '323e4567-e89b-12d3-a456-426614174000',
          userId: '587fcdeb-51a2-43d7-8f9e-123456789abc',
          role: 'owner',
        };
        const user = { id: '487fcdeb-51a2-43d7-8f9e-123456789abc' };

        await updateMemberRoleAction(data, user);

        expect(mockUpdateMemberRole).toHaveBeenCalledWith(
          data,
          mockAdminClient,
        );
      });

      it('should create audit log with before and after states', async () => {
        const data = {
          accountId: '423e4567-e89b-12d3-a456-426614174000',
          userId: '387fcdeb-51a2-43d7-8f9e-123456789abc',
          role: 'admin',
        };
        const user = { id: '287fcdeb-51a2-43d7-8f9e-123456789abc' };

        const accountData = { name: 'Audit Team' };
        const beforeMember = {
          account_id: data.accountId,
          user_id: data.userId,
          role: 'member',
        };
        const afterMember = {
          account_id: data.accountId,
          user_id: data.userId,
          role: 'admin',
        };

        mockSingle
          .mockResolvedValueOnce({ data: accountData, error: null })
          .mockResolvedValueOnce({ data: beforeMember, error: null })
          .mockResolvedValueOnce({ data: afterMember, error: null });

        await updateMemberRoleAction(data, user);

        expect(mockCreateAuditLog).toHaveBeenCalledWith({
          accountId: data.accountId,
          userId: user.id,
          action: 'permission_change',
          objectType: 'team_member',
          objectId: `${data.accountId}-${data.userId}`,
          objectName: 'Team member in Audit Team',
          before: beforeMember,
          after: afterMember,
          scopes: [{ type: 'account', id: data.accountId }],
          ipAddress: '127.0.0.1',
          userAgent: 'test-agent',
        });
      });

      it('should extract network context', async () => {
        const data = {
          accountId: '523e4567-e89b-12d3-a456-426614174000',
          userId: '187fcdeb-51a2-43d7-8f9e-123456789abc',
          role: 'viewer',
        };
        const user = { id: '087fcdeb-51a2-43d7-8f9e-123456789abc' };

        mockSingle
          .mockResolvedValueOnce({ data: { name: 'Team' }, error: null })
          .mockResolvedValueOnce({ data: {}, error: null })
          .mockResolvedValueOnce({ data: {}, error: null });

        await updateMemberRoleAction(data, user);

        expect(mockExtractNetworkContext).toHaveBeenCalled();
      });
    });

    describe('schema validation', () => {
      it('should reject empty role', async () => {
        const data = {
          accountId: '123e4567-e89b-12d3-a456-426614174000',
          userId: '987fcdeb-51a2-43d7-8f9e-123456789abc',
          role: '',
        };
        const user = { id: '887fcdeb-51a2-43d7-8f9e-123456789abc' };

        await expect(updateMemberRoleAction(data, user)).rejects.toThrow();
      });

      it('should reject invalid accountId UUID', async () => {
        const data = {
          accountId: 'invalid-uuid',
          userId: '987fcdeb-51a2-43d7-8f9e-123456789abc',
          role: 'admin',
        };
        const user = { id: '887fcdeb-51a2-43d7-8f9e-123456789abc' };

        await expect(updateMemberRoleAction(data, user)).rejects.toThrow();
      });

      it('should reject missing role', async () => {
        const data = {
          accountId: '123e4567-e89b-12d3-a456-426614174000',
          userId: '987fcdeb-51a2-43d7-8f9e-123456789abc',
        };
        const user = { id: '887fcdeb-51a2-43d7-8f9e-123456789abc' };

        await expect(
          updateMemberRoleAction(data as any, user),
        ).rejects.toThrow();
      });
    });

    describe('error handling', () => {
      it('should propagate service errors', async () => {
        mockUpdateMemberRole.mockRejectedValueOnce(
          new Error('Insufficient permissions'),
        );

        const data = {
          accountId: '123e4567-e89b-12d3-a456-426614174000',
          userId: '987fcdeb-51a2-43d7-8f9e-123456789abc',
          role: 'owner',
        };
        const user = { id: '887fcdeb-51a2-43d7-8f9e-123456789abc' };

        await expect(updateMemberRoleAction(data, user)).rejects.toThrow(
          'Insufficient permissions',
        );
      });
    });
  });

  describe('transferOwnershipAction', () => {
    describe('successful transfer', () => {
      it('should transfer ownership with valid OTP', async () => {
        const data = {
          accountId: '123e4567-e89b-12d3-a456-426614174000',
          userId: '987fcdeb-51a2-43d7-8f9e-123456789abc',
          otp: '123456',
        };
        const user = { id: '887fcdeb-51a2-43d7-8f9e-123456789abc' };

        const result = await transferOwnershipAction(data, user);

        expect(result).toEqual({ success: true });
        expect(mockTransferOwnership).toHaveBeenCalledWith(
          data,
          mockAdminClient,
        );
      });

      it('should verify user is account owner', async () => {
        const data = {
          accountId: '223e4567-e89b-12d3-a456-426614174000',
          userId: '787fcdeb-51a2-43d7-8f9e-123456789abc',
          otp: '654321',
        };
        const user = { id: '687fcdeb-51a2-43d7-8f9e-123456789abc' };

        await transferOwnershipAction(data, user);

        expect(mockRpc).toHaveBeenCalledWith('is_account_owner', {
          account_id: data.accountId,
        });
      });

      it('should verify OTP before transfer', async () => {
        const data = {
          accountId: '323e4567-e89b-12d3-a456-426614174000',
          userId: '587fcdeb-51a2-43d7-8f9e-123456789abc',
          otp: '789012',
        };
        const user = { id: '487fcdeb-51a2-43d7-8f9e-123456789abc' };

        await transferOwnershipAction(data, user);

        expect(mockVerifyToken).toHaveBeenCalledWith({
          token: data.otp,
          userId: user.id,
          purpose: `transfer-team-ownership-${data.accountId}`,
        });
      });

      it('should use admin client for ownership transfer', async () => {
        const data = {
          accountId: '423e4567-e89b-12d3-a456-426614174000',
          userId: '387fcdeb-51a2-43d7-8f9e-123456789abc',
          otp: '345678',
        };
        const user = { id: '287fcdeb-51a2-43d7-8f9e-123456789abc' };

        await transferOwnershipAction(data, user);

        expect(mockTransferOwnership).toHaveBeenCalledWith(
          data,
          mockAdminClient,
        );
      });

      it('should create audit log with ownership transfer metadata', async () => {
        const data = {
          accountId: '523e4567-e89b-12d3-a456-426614174000',
          userId: '187fcdeb-51a2-43d7-8f9e-123456789abc',
          otp: '901234',
        };
        const user = { id: '087fcdeb-51a2-43d7-8f9e-123456789abc' };

        const beforeAccount = {
          id: data.accountId,
          name: 'Transfer Team',
          owner_id: user.id,
        };

        const afterAccount = {
          id: data.accountId,
          name: 'Transfer Team',
          owner_id: data.userId,
        };

        mockSingle
          .mockResolvedValueOnce({ data: beforeAccount, error: null })
          .mockResolvedValueOnce({ data: afterAccount, error: null });

        await transferOwnershipAction(data, user);

        expect(mockCreateAuditLog).toHaveBeenCalledWith({
          accountId: data.accountId,
          userId: user.id,
          action: 'permission_change',
          objectType: 'account',
          objectId: data.accountId,
          objectName: 'Transfer Team',
          before: beforeAccount,
          after: afterAccount,
          scopes: [{ type: 'account', id: data.accountId }],
          metadata: {
            action_type: 'ownership_transfer',
            new_owner_id: data.userId,
            previous_owner_id: user.id,
          },
          ipAddress: '127.0.0.1',
          userAgent: 'test-agent',
        });
      });

      it('should log transfer process', async () => {
        const data = {
          accountId: '623e4567-e89b-12d3-a456-426614174000',
          userId: 'f87fcdeb-51a2-43d7-8f9e-123456789abc',
          otp: '567890',
        };
        const user = { id: 'e87fcdeb-51a2-43d7-8f9e-123456789abc' };

        await transferOwnershipAction(data, user);

        expect(mockLogger.info).toHaveBeenCalledWith(
          expect.objectContaining({
            name: 'teams.transferOwnership',
            userId: user.id,
            accountId: data.accountId,
          }),
          'Processing team ownership transfer request...',
        );

        expect(mockLogger.info).toHaveBeenCalledWith(
          expect.any(Object),
          'OTP verification successful. Proceeding with ownership transfer...',
        );

        expect(mockLogger.info).toHaveBeenCalledWith(
          expect.any(Object),
          'Team ownership transferred successfully',
        );
      });

      it('should revalidate account layout after transfer', async () => {
        const data = {
          accountId: '723e4567-e89b-12d3-a456-426614174000',
          userId: 'd87fcdeb-51a2-43d7-8f9e-123456789abc',
          otp: '234567',
        };
        const user = { id: 'c87fcdeb-51a2-43d7-8f9e-123456789abc' };

        await transferOwnershipAction(data, user);

        expect(mockRevalidatePath).toHaveBeenCalledWith(
          '/home/[account]',
          'layout',
        );
      });
    });

    describe('security validation', () => {
      it('should reject when user is not account owner', async () => {
        const data = {
          accountId: '123e4567-e89b-12d3-a456-426614174000',
          userId: '987fcdeb-51a2-43d7-8f9e-123456789abc',
          otp: '123456',
        };
        const user = { id: '887fcdeb-51a2-43d7-8f9e-123456789abc' };

        mockRpc.mockResolvedValueOnce({ data: false, error: null });

        await expect(transferOwnershipAction(data, user)).rejects.toThrow(
          'You must be the owner of the account to transfer ownership',
        );

        expect(mockLogger.error).toHaveBeenCalledWith(
          expect.any(Object),
          'User is not the owner of this account',
        );
      });

      it('should reject when ownership check fails', async () => {
        const data = {
          accountId: '223e4567-e89b-12d3-a456-426614174000',
          userId: '787fcdeb-51a2-43d7-8f9e-123456789abc',
          otp: '654321',
        };
        const user = { id: '687fcdeb-51a2-43d7-8f9e-123456789abc' };

        mockRpc.mockResolvedValueOnce({
          data: null,
          error: new Error('RPC failed'),
        });

        await expect(transferOwnershipAction(data, user)).rejects.toThrow(
          'You must be the owner of the account to transfer ownership',
        );
      });

      it('should reject invalid OTP', async () => {
        const data = {
          accountId: '323e4567-e89b-12d3-a456-426614174000',
          userId: '587fcdeb-51a2-43d7-8f9e-123456789abc',
          otp: '999999', // Valid length but wrong OTP
        };
        const user = { id: '487fcdeb-51a2-43d7-8f9e-123456789abc' };

        mockVerifyToken.mockImplementationOnce(() =>
          Promise.resolve({ valid: false })
        );

        await expect(transferOwnershipAction(data, user)).rejects.toThrow(
          'Invalid OTP',
        );

        expect(mockLogger.error).toHaveBeenCalledWith(
          expect.any(Object),
          'Invalid OTP provided',
        );
      });

      it('should reject OTP user ID mismatch', async () => {
        const data = {
          accountId: '423e4567-e89b-12d3-a456-426614174000',
          userId: '387fcdeb-51a2-43d7-8f9e-123456789abc',
          otp: '123456',
        };
        const user = { id: '287fcdeb-51a2-43d7-8f9e-123456789abc' };

        mockVerifyToken.mockImplementationOnce(() =>
          Promise.resolve({
            valid: true,
            user_id: 'f87fcdeb-51a2-43d7-8f9e-123456789abc', // Different from user.id
          })
        );

        await expect(transferOwnershipAction(data, user)).rejects.toThrow(
          'Nonce mismatch',
        );

        expect(mockLogger.error).toHaveBeenCalledWith(
          expect.any(Object),
          'This token was meant to be used by a different user. Exiting.',
        );
      });
    });

    describe('schema validation', () => {
      it('should reject OTP shorter than 6 characters', async () => {
        const data = {
          accountId: '123e4567-e89b-12d3-a456-426614174000',
          userId: '987fcdeb-51a2-43d7-8f9e-123456789abc',
          otp: '12345',
        };
        const user = { id: '887fcdeb-51a2-43d7-8f9e-123456789abc' };

        await expect(transferOwnershipAction(data, user)).rejects.toThrow();
      });

      it('should reject invalid accountId UUID', async () => {
        const data = {
          accountId: 'invalid-uuid',
          userId: '987fcdeb-51a2-43d7-8f9e-123456789abc',
          otp: '123456',
        };
        const user = { id: '887fcdeb-51a2-43d7-8f9e-123456789abc' };

        await expect(transferOwnershipAction(data, user)).rejects.toThrow();
      });

      it('should reject invalid userId UUID', async () => {
        const data = {
          accountId: '123e4567-e89b-12d3-a456-426614174000',
          userId: 'invalid-uuid',
          otp: '123456',
        };
        const user = { id: '887fcdeb-51a2-43d7-8f9e-123456789abc' };

        await expect(transferOwnershipAction(data, user)).rejects.toThrow();
      });

      it('should reject missing OTP', async () => {
        const data = {
          accountId: '123e4567-e89b-12d3-a456-426614174000',
          userId: '987fcdeb-51a2-43d7-8f9e-123456789abc',
        };
        const user = { id: '887fcdeb-51a2-43d7-8f9e-123456789abc' };

        await expect(
          transferOwnershipAction(data as any, user),
        ).rejects.toThrow();
      });
    });

    describe('error handling', () => {
      it('should propagate service errors', async () => {
        const data = {
          accountId: '523e4567-e89b-12d3-a456-426614174000',
          userId: '187fcdeb-51a2-43d7-8f9e-123456789abc',
          otp: '123456',
        };
        const user = { id: '087fcdeb-51a2-43d7-8f9e-123456789abc' };

        // Need to mock account fetch before the service call fails
        mockSingle.mockResolvedValueOnce({
          data: { id: data.accountId, name: 'Test' },
          error: null,
        });

        mockTransferOwnership.mockRejectedValueOnce(
          new Error('Transfer failed'),
        );

        await expect(transferOwnershipAction(data, user)).rejects.toThrow(
          'Transfer failed',
        );
      });
    });
  });

  describe('integration flows', () => {
    it('should complete full member management lifecycle', async () => {
      const accountId = '823e4567-e89b-12d3-a456-426614174000';
      const memberId = 'b87fcdeb-51a2-43d7-8f9e-123456789abc';
      const user = { id: 'a87fcdeb-51a2-43d7-8f9e-123456789abc' };

      // Update member role
      const updateData = {
        accountId,
        userId: memberId,
        role: 'admin',
      };

      await updateMemberRoleAction(updateData, user);

      expect(mockUpdateMemberRole).toHaveBeenCalledWith(
        updateData,
        mockAdminClient,
      );

      // Remove member
      const removeData = {
        accountId,
        userId: memberId,
      };

      await removeMemberFromAccountAction(removeData, user);

      expect(mockRemoveMemberFromAccount).toHaveBeenCalledWith(removeData);

      // Both should revalidate
      expect(mockRevalidatePath).toHaveBeenCalledTimes(2);
    });

    it('should complete ownership transfer with all checks', async () => {
      const data = {
        accountId: '923e4567-e89b-12d3-a456-426614174000',
        userId: '987fcdeb-51a2-43d7-8f9e-123456789abc',
        otp: '123456',
      };
      const user = { id: '887fcdeb-51a2-43d7-8f9e-123456789abc' };

      const beforeAccount = {
        id: data.accountId,
        name: 'Full Flow Team',
        owner_id: user.id,
      };

      const afterAccount = {
        id: data.accountId,
        name: 'Full Flow Team',
        owner_id: data.userId,
      };

      mockRpc.mockResolvedValueOnce({ data: true, error: null });
      mockSingle
        .mockResolvedValueOnce({ data: beforeAccount, error: null })
        .mockResolvedValueOnce({ data: afterAccount, error: null });

      const result = await transferOwnershipAction(data, user);

      // Verify all checks performed
      expect(mockRpc).toHaveBeenCalledWith('is_account_owner', {
        account_id: data.accountId,
      });
      expect(mockVerifyToken).toHaveBeenCalled();
      expect(mockTransferOwnership).toHaveBeenCalled();
      expect(mockCreateAuditLog).toHaveBeenCalled();
      expect(mockRevalidatePath).toHaveBeenCalled();
      expect(result).toEqual({ success: true });
    });
  });
});
