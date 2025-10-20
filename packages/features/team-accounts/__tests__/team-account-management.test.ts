import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { SupabaseClient } from '@supabase/supabase-js';

import { createCreateTeamAccountService } from '../src/server/services/create-team-account.service';
import { createDeleteTeamAccountService } from '../src/server/services/delete-team-account.service';
import { createLeaveTeamAccountService } from '../src/server/services/leave-team-account.service';

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

// Valid UUIDs for testing
const ACCOUNT_ID = '550e8400-e29b-41d4-a716-446655440000';
const USER_ID = '550e8400-e29b-41d4-a716-446655440001';

// Mock Supabase clients
const mockRpc = vi.fn();
const mockDelete = vi.fn();
const mockEq = vi.fn();
const mockMatch = vi.fn();
const mockFrom = vi.fn();

const mockClient = {
  rpc: mockRpc,
} as unknown as SupabaseClient;

const mockAdminClient = {
  from: mockFrom,
} as unknown as SupabaseClient;

describe('Team Account Management Services', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Setup default chain for delete operations
    mockFrom.mockReturnValue({
      delete: mockDelete,
    });

    mockDelete.mockReturnValue({
      eq: mockEq,
      match: mockMatch,
    });
  });

  describe('CreateTeamAccountService', () => {
    let service: ReturnType<typeof createCreateTeamAccountService>;

    beforeEach(() => {
      service = createCreateTeamAccountService(mockClient);
    });

    describe('createNewOrganizationAccount', () => {
      it('should create new team account successfully', async () => {
        const mockData = {
          id: ACCOUNT_ID,
          name: 'Test Organization',
          slug: 'test-organization',
        };

        mockRpc.mockResolvedValue({
          data: mockData,
          error: null,
        });

        const result = await service.createNewOrganizationAccount({
          name: 'Test Organization',
          userId: USER_ID,
        });

        expect(mockRpc).toHaveBeenCalledWith('create_team_account', {
          account_name: 'Test Organization',
        });

        expect(result).toEqual({
          data: mockData,
          error: null,
        });
      });

      it('should throw error when RPC fails', async () => {
        mockRpc.mockResolvedValue({
          data: null,
          error: { message: 'Database error', code: '500' },
        });

        await expect(
          service.createNewOrganizationAccount({
            name: 'Test Organization',
            userId: USER_ID,
          }),
        ).rejects.toThrow('Error creating team account');

        expect(mockRpc).toHaveBeenCalledWith('create_team_account', {
          account_name: 'Test Organization',
        });
      });

      it('should handle RPC throwing exception', async () => {
        mockRpc.mockRejectedValue(new Error('Connection failed'));

        await expect(
          service.createNewOrganizationAccount({
            name: 'Test Organization',
            userId: USER_ID,
          }),
        ).rejects.toThrow('Connection failed');
      });

      it('should create accounts with various name formats', async () => {
        const testNames = [
          'Simple Name',
          'Name-With-Dashes',
          'Name_With_Underscores',
          'Name123',
          'Acme Corp.',
          'Test & Co',
        ];

        for (const name of testNames) {
          mockRpc.mockResolvedValue({
            data: { id: ACCOUNT_ID, name },
            error: null,
          });

          await service.createNewOrganizationAccount({
            name,
            userId: USER_ID,
          });

          expect(mockRpc).toHaveBeenCalledWith('create_team_account', {
            account_name: name,
          });
        }
      });

      it('should handle concurrent account creation', async () => {
        mockRpc.mockResolvedValue({
          data: { id: ACCOUNT_ID, name: 'Test' },
          error: null,
        });

        await Promise.all([
          service.createNewOrganizationAccount({
            name: 'Organization 1',
            userId: USER_ID,
          }),
          service.createNewOrganizationAccount({
            name: 'Organization 2',
            userId: USER_ID,
          }),
        ]);

        expect(mockRpc).toHaveBeenCalledTimes(2);
      });

      it('should return data and error from RPC', async () => {
        const mockData = { id: ACCOUNT_ID, name: 'Test' };

        mockRpc.mockResolvedValue({
          data: mockData,
          error: null,
        });

        const result = await service.createNewOrganizationAccount({
          name: 'Test',
          userId: USER_ID,
        });

        expect(result.data).toEqual(mockData);
        expect(result.error).toBeNull();
      });

      it('should handle empty account names', async () => {
        mockRpc.mockResolvedValue({
          data: { id: ACCOUNT_ID, name: '' },
          error: null,
        });

        await service.createNewOrganizationAccount({
          name: '',
          userId: USER_ID,
        });

        expect(mockRpc).toHaveBeenCalledWith('create_team_account', {
          account_name: '',
        });
      });

      it('should handle very long account names', async () => {
        const longName = 'A'.repeat(500);

        mockRpc.mockResolvedValue({
          data: { id: ACCOUNT_ID, name: longName },
          error: null,
        });

        await service.createNewOrganizationAccount({
          name: longName,
          userId: USER_ID,
        });

        expect(mockRpc).toHaveBeenCalledWith('create_team_account', {
          account_name: longName,
        });
      });
    });
  });

  describe('DeleteTeamAccountService', () => {
    let service: ReturnType<typeof createDeleteTeamAccountService>;

    beforeEach(() => {
      service = createDeleteTeamAccountService();

      // Setup default: deletion succeeds
      mockEq.mockResolvedValue({
        data: null,
        error: null,
      });
    });

    describe('deleteTeamAccount', () => {
      it('should delete team account successfully', async () => {
        await service.deleteTeamAccount(mockAdminClient, {
          accountId: ACCOUNT_ID,
          userId: USER_ID,
        });

        expect(mockFrom).toHaveBeenCalledWith('accounts');
        expect(mockDelete).toHaveBeenCalled();
        expect(mockEq).toHaveBeenCalledWith('id', ACCOUNT_ID);
      });

      it('should throw error when deletion fails', async () => {
        mockEq.mockResolvedValue({
          data: null,
          error: { message: 'Deletion failed', code: '500' },
        });

        await expect(
          service.deleteTeamAccount(mockAdminClient, {
            accountId: ACCOUNT_ID,
            userId: USER_ID,
          }),
        ).rejects.toThrow('Failed to delete team account');
      });

      it('should use admin client for deletion', async () => {
        await service.deleteTeamAccount(mockAdminClient, {
          accountId: ACCOUNT_ID,
          userId: USER_ID,
        });

        expect(mockFrom).toHaveBeenCalledWith('accounts');
      });

      it('should handle deletion throwing exception', async () => {
        mockEq.mockRejectedValue(new Error('Database connection failed'));

        await expect(
          service.deleteTeamAccount(mockAdminClient, {
            accountId: ACCOUNT_ID,
            userId: USER_ID,
          }),
        ).rejects.toThrow('Database connection failed');
      });

      it('should handle edge case UUIDs', async () => {
        const edgeCaseIds = [
          '00000000-0000-0000-0000-000000000000',
          'ffffffff-ffff-ffff-ffff-ffffffffffff',
        ];

        for (const id of edgeCaseIds) {
          mockEq.mockResolvedValue({
            data: null,
            error: null,
          });

          await service.deleteTeamAccount(mockAdminClient, {
            accountId: id,
            userId: USER_ID,
          });

          expect(mockEq).toHaveBeenCalledWith('id', id);
        }
      });

      it('should handle foreign key constraint errors', async () => {
        mockEq.mockResolvedValue({
          data: null,
          error: {
            message: 'Foreign key constraint violation',
            code: '23503',
          },
        });

        await expect(
          service.deleteTeamAccount(mockAdminClient, {
            accountId: ACCOUNT_ID,
            userId: USER_ID,
          }),
        ).rejects.toThrow('Failed to delete team account');
      });

      it('should not throw if no data returned on success', async () => {
        mockEq.mockResolvedValue({
          data: null,
          error: null,
        });

        await expect(
          service.deleteTeamAccount(mockAdminClient, {
            accountId: ACCOUNT_ID,
            userId: USER_ID,
          }),
        ).resolves.toBeUndefined();
      });
    });
  });

  describe('LeaveTeamAccountService', () => {
    let service: ReturnType<typeof createLeaveTeamAccountService>;

    beforeEach(() => {
      service = createLeaveTeamAccountService(mockAdminClient);

      // Setup default: leave succeeds
      mockMatch.mockResolvedValue({
        data: null,
        error: null,
      });
    });

    describe('leaveTeamAccount', () => {
      it('should leave team account successfully', async () => {
        await service.leaveTeamAccount({
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

      it('should validate UUID format via Zod schema', async () => {
        await expect(
          service.leaveTeamAccount({
            accountId: 'invalid-uuid',
            userId: USER_ID,
          }),
        ).rejects.toThrow();

        expect(mockDelete).not.toHaveBeenCalled();
      });

      it('should throw error when deletion fails', async () => {
        mockMatch.mockResolvedValue({
          data: null,
          error: { message: 'Deletion failed' },
        });

        await expect(
          service.leaveTeamAccount({
            accountId: ACCOUNT_ID,
            userId: USER_ID,
          }),
        ).rejects.toThrow('Failed to leave team account');
      });

      it('should use admin client for deletion', async () => {
        await service.leaveTeamAccount({
          accountId: ACCOUNT_ID,
          userId: USER_ID,
        });

        expect(mockFrom).toHaveBeenCalledWith('accounts_memberships');
      });

      it('should handle concurrent leave operations', async () => {
        const userId2 = '550e8400-e29b-41d4-a716-446655440002';

        await Promise.all([
          service.leaveTeamAccount({
            accountId: ACCOUNT_ID,
            userId: USER_ID,
          }),
          service.leaveTeamAccount({
            accountId: ACCOUNT_ID,
            userId: userId2,
          }),
        ]);

        expect(mockMatch).toHaveBeenCalledTimes(2);
      });

      it('should handle deletion throwing exception', async () => {
        mockMatch.mockRejectedValue(new Error('Connection failed'));

        await expect(
          service.leaveTeamAccount({
            accountId: ACCOUNT_ID,
            userId: USER_ID,
          }),
        ).rejects.toThrow('Connection failed');
      });

      it('should validate both accountId and userId are UUIDs', async () => {
        // Invalid accountId
        await expect(
          service.leaveTeamAccount({
            accountId: 'not-a-uuid',
            userId: USER_ID,
          }),
        ).rejects.toThrow();

        // Invalid userId
        await expect(
          service.leaveTeamAccount({
            accountId: ACCOUNT_ID,
            userId: 'not-a-uuid',
          }),
        ).rejects.toThrow();

        expect(mockDelete).not.toHaveBeenCalled();
      });

      it('should handle edge case valid UUIDs', async () => {
        const edgeCases = [
          {
            accountId: '00000000-0000-0000-0000-000000000000',
            userId: '00000000-0000-0000-0000-000000000001',
          },
          {
            accountId: 'ffffffff-ffff-ffff-ffff-ffffffffffff',
            userId: 'ffffffff-ffff-ffff-ffff-ffffffffff00',
          },
        ];

        for (const params of edgeCases) {
          mockMatch.mockResolvedValue({
            data: null,
            error: null,
          });

          await service.leaveTeamAccount(params);

          expect(mockMatch).toHaveBeenCalledWith({
            account_id: params.accountId,
            user_id: params.userId,
          });
        }
      });

      it('should not throw if no data returned on success', async () => {
        mockMatch.mockResolvedValue({
          data: null,
          error: null,
        });

        await expect(
          service.leaveTeamAccount({
            accountId: ACCOUNT_ID,
            userId: USER_ID,
          }),
        ).resolves.toBeUndefined();
      });
    });
  });

  describe('Integration scenarios', () => {
    it('should handle full team account lifecycle', async () => {
      // Create account
      const createService = createCreateTeamAccountService(mockClient);

      mockRpc.mockResolvedValue({
        data: { id: ACCOUNT_ID, name: 'Test Org' },
        error: null,
      });

      await createService.createNewOrganizationAccount({
        name: 'Test Org',
        userId: USER_ID,
      });

      // Leave account
      const leaveService = createLeaveTeamAccountService(mockAdminClient);

      mockMatch.mockResolvedValue({
        data: null,
        error: null,
      });

      await leaveService.leaveTeamAccount({
        accountId: ACCOUNT_ID,
        userId: USER_ID,
      });

      // Delete account
      const deleteService = createDeleteTeamAccountService();

      mockEq.mockResolvedValue({
        data: null,
        error: null,
      });

      await deleteService.deleteTeamAccount(mockAdminClient, {
        accountId: ACCOUNT_ID,
        userId: USER_ID,
      });

      expect(mockRpc).toHaveBeenCalledWith(
        'create_team_account',
        expect.anything(),
      );
      expect(mockMatch).toHaveBeenCalled();
      expect(mockEq).toHaveBeenCalledWith('id', ACCOUNT_ID);
    });

    it('should handle create failure gracefully', async () => {
      const createService = createCreateTeamAccountService(mockClient);

      mockRpc.mockResolvedValue({
        data: null,
        error: { message: 'Duplicate slug' },
      });

      await expect(
        createService.createNewOrganizationAccount({
          name: 'Test Org',
          userId: USER_ID,
        }),
      ).rejects.toThrow('Error creating team account');

      // Should not proceed to other operations
      expect(mockMatch).not.toHaveBeenCalled();
      expect(mockEq).not.toHaveBeenCalled();
    });
  });
});
