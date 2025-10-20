import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { SupabaseClient } from '@supabase/supabase-js';

import { createAccountMembersService } from '../src/server/services/account-members.service';

// Mock logger
vi.mock('@kit/shared/logger', () => ({
  getLogger: vi.fn(() =>
    Promise.resolve({
      info: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
    }),
  ),
}));

// Mock per-seat billing service
const mockDecreaseSeats = vi.fn();

vi.mock(
  '../src/server/services/account-per-seat-billing.service',
  () => ({
    createAccountPerSeatBillingService: vi.fn(() => ({
      decreaseSeats: mockDecreaseSeats,
    })),
  }),
);

// Valid UUIDs for testing
const ACCOUNT_ID = '550e8400-e29b-41d4-a716-446655440000';
const USER_ID = '550e8400-e29b-41d4-a716-446655440001';
const NEW_OWNER_ID = '550e8400-e29b-41d4-a716-446655440002';

// Mock Supabase clients
const mockDelete = vi.fn();
const mockUpdate = vi.fn();
const mockMatch = vi.fn();
const mockFrom = vi.fn();
const mockRpc = vi.fn();
const mockAdminRpc = vi.fn();
const mockAdminFrom = vi.fn();
const mockAdminUpdate = vi.fn();
const mockAdminMatch = vi.fn();

const mockClient = {
  from: mockFrom,
  rpc: mockRpc,
} as unknown as SupabaseClient;

const mockAdminClient = {
  from: mockAdminFrom,
  rpc: mockAdminRpc,
} as unknown as SupabaseClient;

describe('AccountMembersService', () => {
  let service: ReturnType<typeof createAccountMembersService>;

  beforeEach(() => {
    vi.clearAllMocks();

    service = createAccountMembersService(mockClient);

    // Setup default chain for delete operation
    mockFrom.mockReturnValue({
      delete: mockDelete,
    });

    mockDelete.mockReturnValue({
      match: mockMatch,
    });

    // Setup default chain for admin update operation
    mockAdminFrom.mockReturnValue({
      update: mockAdminUpdate,
    });

    mockAdminUpdate.mockReturnValue({
      match: mockAdminMatch,
    });

    // Default: permissions check passes
    mockRpc.mockResolvedValue({
      data: true,
      error: null,
    });

    // Default: decrease seats succeeds
    mockDecreaseSeats.mockResolvedValue(undefined);
  });

  describe('removeMemberFromAccount', () => {
    it('should remove member from account successfully', async () => {
      mockMatch.mockResolvedValue({
        data: null,
        error: null,
      });

      await service.removeMemberFromAccount({
        accountId: ACCOUNT_ID,
        userId: USER_ID,
      });

      expect(mockFrom).toHaveBeenCalledWith('accounts_memberships');
      expect(mockDelete).toHaveBeenCalled();
      expect(mockMatch).toHaveBeenCalledWith({
        account_id: ACCOUNT_ID,
        user_id: USER_ID,
      });
    });

    it('should decrease seat count after removing member', async () => {
      mockMatch.mockResolvedValue({
        data: null,
        error: null,
      });

      await service.removeMemberFromAccount({
        accountId: ACCOUNT_ID,
        userId: USER_ID,
      });

      expect(mockDecreaseSeats).toHaveBeenCalledWith(ACCOUNT_ID);
    });

    it('should throw error when deletion fails', async () => {
      mockMatch.mockResolvedValue({
        data: null,
        error: { message: 'Database error', code: '500' },
      });

      await expect(
        service.removeMemberFromAccount({
          accountId: ACCOUNT_ID,
          userId: USER_ID,
        }),
      ).rejects.toThrow();
    });

    it('should not decrease seats when deletion fails', async () => {
      mockMatch.mockResolvedValue({
        data: null,
        error: { message: 'Database error' },
      });

      await expect(
        service.removeMemberFromAccount({
          accountId: ACCOUNT_ID,
          userId: USER_ID,
        }),
      ).rejects.toThrow();

      expect(mockDecreaseSeats).not.toHaveBeenCalled();
    });

    it('should handle concurrent member removals', async () => {
      mockMatch.mockResolvedValue({
        data: null,
        error: null,
      });

      await Promise.all([
        service.removeMemberFromAccount({
          accountId: ACCOUNT_ID,
          userId: USER_ID,
        }),
        service.removeMemberFromAccount({
          accountId: ACCOUNT_ID,
          userId: NEW_OWNER_ID,
        }),
      ]);

      expect(mockMatch).toHaveBeenCalledTimes(2);
      expect(mockDecreaseSeats).toHaveBeenCalledTimes(2);
    });

    it('should handle valid UUID formats', async () => {
      mockMatch.mockResolvedValue({
        data: null,
        error: null,
      });

      const edgeCaseIds = [
        '00000000-0000-0000-0000-000000000000',
        'ffffffff-ffff-ffff-ffff-ffffffffffff',
      ];

      for (const id of edgeCaseIds) {
        await service.removeMemberFromAccount({
          accountId: id,
          userId: USER_ID,
        });
      }

      expect(mockMatch).toHaveBeenCalledTimes(2);
    });
  });

  describe('updateMemberRole', () => {
    beforeEach(() => {
      // Default: permissions check passes
      mockRpc.mockResolvedValue({
        data: true,
        error: null,
      });

      // Default: update succeeds
      mockAdminMatch.mockResolvedValue({
        data: null,
        error: null,
      });
    });

    it('should update member role successfully', async () => {
      await service.updateMemberRole(
        {
          accountId: ACCOUNT_ID,
          userId: USER_ID,
          role: 'admin',
        },
        mockAdminClient,
      );

      expect(mockRpc).toHaveBeenCalledWith('can_action_account_member', {
        target_user_id: USER_ID,
        target_team_account_id: ACCOUNT_ID,
      });

      expect(mockAdminFrom).toHaveBeenCalledWith('accounts_memberships');
      expect(mockAdminUpdate).toHaveBeenCalledWith({
        account_role: 'admin',
      });
      expect(mockAdminMatch).toHaveBeenCalledWith({
        account_id: ACCOUNT_ID,
        user_id: USER_ID,
      });
    });

    it('should validate permissions before updating role', async () => {
      await service.updateMemberRole(
        {
          accountId: ACCOUNT_ID,
          userId: USER_ID,
          role: 'member',
        },
        mockAdminClient,
      );

      expect(mockRpc).toHaveBeenCalledBefore(mockAdminUpdate as any);
    });

    it('should throw error when permissions check fails', async () => {
      mockRpc.mockResolvedValue({
        data: false,
        error: null,
      });

      await expect(
        service.updateMemberRole(
          {
            accountId: ACCOUNT_ID,
            userId: USER_ID,
            role: 'admin',
          },
          mockAdminClient,
        ),
      ).rejects.toThrow('Failed to validate permissions to update member role');

      expect(mockAdminUpdate).not.toHaveBeenCalled();
    });

    it('should throw error when permissions RPC returns error', async () => {
      mockRpc.mockResolvedValue({
        data: null,
        error: { message: 'RPC error' },
      });

      await expect(
        service.updateMemberRole(
          {
            accountId: ACCOUNT_ID,
            userId: USER_ID,
            role: 'admin',
          },
          mockAdminClient,
        ),
      ).rejects.toThrow('Failed to validate permissions to update member role');
    });

    it('should throw error when role update fails', async () => {
      mockAdminMatch.mockResolvedValue({
        data: null,
        error: { message: 'Update failed' },
      });

      await expect(
        service.updateMemberRole(
          {
            accountId: ACCOUNT_ID,
            userId: USER_ID,
            role: 'admin',
          },
          mockAdminClient,
        ),
      ).rejects.toThrow();
    });

    it('should support all valid role types', async () => {
      const roles = ['owner', 'admin', 'member'] as const;

      for (const role of roles) {
        mockAdminMatch.mockResolvedValue({
          data: null,
          error: null,
        });

        await service.updateMemberRole(
          {
            accountId: ACCOUNT_ID,
            userId: USER_ID,
            role,
          },
          mockAdminClient,
        );

        expect(mockAdminUpdate).toHaveBeenCalledWith({
          account_role: role,
        });
      }
    });

    it('should handle concurrent role updates for different users', async () => {
      await Promise.all([
        service.updateMemberRole(
          {
            accountId: ACCOUNT_ID,
            userId: USER_ID,
            role: 'admin',
          },
          mockAdminClient,
        ),
        service.updateMemberRole(
          {
            accountId: ACCOUNT_ID,
            userId: NEW_OWNER_ID,
            role: 'member',
          },
          mockAdminClient,
        ),
      ]);

      expect(mockRpc).toHaveBeenCalledTimes(2);
      expect(mockAdminUpdate).toHaveBeenCalledTimes(2);
    });

    it('should use admin client for role update', async () => {
      await service.updateMemberRole(
        {
          accountId: ACCOUNT_ID,
          userId: USER_ID,
          role: 'admin',
        },
        mockAdminClient,
      );

      expect(mockAdminFrom).toHaveBeenCalled();
      expect(mockFrom).not.toHaveBeenCalledWith('accounts_memberships');
    });
  });

  describe('transferOwnership', () => {
    beforeEach(() => {
      // Default: transfer succeeds
      mockAdminRpc.mockResolvedValue({
        data: true,
        error: null,
      });
    });

    it('should transfer ownership successfully', async () => {
      await service.transferOwnership(
        {
          accountId: ACCOUNT_ID,
          userId: NEW_OWNER_ID,
        },
        mockAdminClient,
      );

      expect(mockAdminRpc).toHaveBeenCalledWith(
        'transfer_team_account_ownership',
        {
          target_account_id: ACCOUNT_ID,
          new_owner_id: NEW_OWNER_ID,
        },
      );
    });

    it('should throw error when transfer RPC fails', async () => {
      mockAdminRpc.mockResolvedValue({
        data: null,
        error: { message: 'Transfer failed', code: '500' },
      });

      await expect(
        service.transferOwnership(
          {
            accountId: ACCOUNT_ID,
            userId: NEW_OWNER_ID,
          },
          mockAdminClient,
        ),
      ).rejects.toThrow();
    });

    it('should return RPC data on success', async () => {
      const mockData = { success: true };

      mockAdminRpc.mockResolvedValue({
        data: mockData,
        error: null,
      });

      const result = await service.transferOwnership(
        {
          accountId: ACCOUNT_ID,
          userId: NEW_OWNER_ID,
        },
        mockAdminClient,
      );

      expect(result).toEqual(mockData);
    });

    it('should use admin client for ownership transfer', async () => {
      await service.transferOwnership(
        {
          accountId: ACCOUNT_ID,
          userId: NEW_OWNER_ID,
        },
        mockAdminClient,
      );

      expect(mockAdminRpc).toHaveBeenCalled();
      expect(mockRpc).not.toHaveBeenCalledWith(
        'transfer_team_account_ownership',
        expect.anything(),
      );
    });

    it('should handle edge case UUIDs', async () => {
      const edgeCaseAccount = '00000000-0000-0000-0000-000000000000';
      const edgeCaseUser = 'ffffffff-ffff-ffff-ffff-ffffffffffff';

      await service.transferOwnership(
        {
          accountId: edgeCaseAccount,
          userId: edgeCaseUser,
        },
        mockAdminClient,
      );

      expect(mockAdminRpc).toHaveBeenCalledWith(
        'transfer_team_account_ownership',
        {
          target_account_id: edgeCaseAccount,
          new_owner_id: edgeCaseUser,
        },
      );
    });

    it('should handle RPC throwing exception', async () => {
      mockAdminRpc.mockRejectedValue(new Error('Database connection failed'));

      await expect(
        service.transferOwnership(
          {
            accountId: ACCOUNT_ID,
            userId: NEW_OWNER_ID,
          },
          mockAdminClient,
        ),
      ).rejects.toThrow('Database connection failed');
    });
  });

  describe('Integration scenarios', () => {
    it('should handle member lifecycle: add role change, remove', async () => {
      // Change role
      mockAdminMatch.mockResolvedValue({
        data: null,
        error: null,
      });

      await service.updateMemberRole(
        {
          accountId: ACCOUNT_ID,
          userId: USER_ID,
          role: 'admin',
        },
        mockAdminClient,
      );

      // Remove member
      mockMatch.mockResolvedValue({
        data: null,
        error: null,
      });

      await service.removeMemberFromAccount({
        accountId: ACCOUNT_ID,
        userId: USER_ID,
      });

      expect(mockAdminUpdate).toHaveBeenCalled();
      expect(mockDelete).toHaveBeenCalled();
      expect(mockDecreaseSeats).toHaveBeenCalled();
    });

    it('should handle ownership transfer followed by role changes', async () => {
      // Transfer ownership
      mockAdminRpc.mockResolvedValue({
        data: true,
        error: null,
      });

      await service.transferOwnership(
        {
          accountId: ACCOUNT_ID,
          userId: NEW_OWNER_ID,
        },
        mockAdminClient,
      );

      // Update old owner to admin
      mockAdminMatch.mockResolvedValue({
        data: null,
        error: null,
      });

      await service.updateMemberRole(
        {
          accountId: ACCOUNT_ID,
          userId: USER_ID,
          role: 'admin',
        },
        mockAdminClient,
      );

      expect(mockAdminRpc).toHaveBeenCalledWith(
        'transfer_team_account_ownership',
        expect.anything(),
      );
      expect(mockAdminUpdate).toHaveBeenCalled();
    });
  });
});
