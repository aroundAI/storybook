import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createAdminAccountsService } from '../src/lib/server/services/admin-accounts.service';

describe('AdminAccountsService', () => {
  let mockClient: SupabaseClient;
  let mockFrom: ReturnType<typeof vi.fn>;
  let mockDelete: ReturnType<typeof vi.fn>;
  let mockEq: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();

    mockEq = vi.fn();
    mockDelete = vi.fn(() => ({
      eq: mockEq,
    }));
    mockFrom = vi.fn(() => ({
      delete: mockDelete,
    }));

    mockClient = {
      from: mockFrom,
    } as unknown as SupabaseClient;
  });

  describe('createAdminAccountsService', () => {
    it('should create a service instance', () => {
      const service = createAdminAccountsService(mockClient);

      expect(service).toBeDefined();
      expect(typeof service.deleteAccount).toBe('function');
    });

    it('should create a new instance each time', () => {
      const service1 = createAdminAccountsService(mockClient);
      const service2 = createAdminAccountsService(mockClient);

      expect(service1).not.toBe(service2);
    });

    it('should accept admin client in constructor', () => {
      const service = createAdminAccountsService(mockClient);

      expect(service).toBeInstanceOf(Object);
    });
  });

  describe('deleteAccount', () => {
    describe('successful deletion', () => {
      it('should delete account with valid UUID', async () => {
        const service = createAdminAccountsService(mockClient);

        mockEq.mockResolvedValue({ error: null, data: null });

        await service.deleteAccount('account-123-uuid');

        expect(mockFrom).toHaveBeenCalledWith('accounts');
        expect(mockDelete).toHaveBeenCalled();
        expect(mockEq).toHaveBeenCalledWith('id', 'account-123-uuid');
      });

      it('should complete without throwing on successful deletion', async () => {
        const service = createAdminAccountsService(mockClient);

        mockEq.mockResolvedValue({ error: null, data: null });

        await expect(
          service.deleteAccount('account-456'),
        ).resolves.not.toThrow();
      });

      it('should use correct table name', async () => {
        const service = createAdminAccountsService(mockClient);

        mockEq.mockResolvedValue({ error: null, data: null });

        await service.deleteAccount('account-789');

        expect(mockFrom).toHaveBeenCalledWith('accounts');
      });

      it('should call delete method', async () => {
        const service = createAdminAccountsService(mockClient);

        mockEq.mockResolvedValue({ error: null, data: null });

        await service.deleteAccount('account-abc');

        expect(mockDelete).toHaveBeenCalledTimes(1);
      });

      it('should filter by account id', async () => {
        const service = createAdminAccountsService(mockClient);

        mockEq.mockResolvedValue({ error: null, data: null });

        await service.deleteAccount('specific-account-id');

        expect(mockEq).toHaveBeenCalledWith('id', 'specific-account-id');
      });

      it('should handle deletion of personal accounts', async () => {
        const service = createAdminAccountsService(mockClient);

        mockEq.mockResolvedValue({ error: null, data: null });

        await service.deleteAccount('personal-account-id');

        expect(mockEq).toHaveBeenCalledWith('id', 'personal-account-id');
      });

      it('should handle deletion of team accounts', async () => {
        const service = createAdminAccountsService(mockClient);

        mockEq.mockResolvedValue({ error: null, data: null });

        await service.deleteAccount('team-account-id');

        expect(mockEq).toHaveBeenCalledWith('id', 'team-account-id');
      });
    });

    describe('error handling', () => {
      it('should throw error when deletion fails', async () => {
        const service = createAdminAccountsService(mockClient);

        const error = new Error('Database error');
        mockEq.mockResolvedValue({ error, data: null });

        await expect(service.deleteAccount('account-123')).rejects.toThrow(
          'Database error',
        );
      });

      it('should throw error on foreign key constraint violation', async () => {
        const service = createAdminAccountsService(mockClient);

        const error = {
          message: 'Foreign key constraint violation',
          code: '23503',
        };
        mockEq.mockResolvedValue({ error, data: null });

        await expect(service.deleteAccount('account-123')).rejects.toThrow();
      });

      it('should throw error when account does not exist', async () => {
        const service = createAdminAccountsService(mockClient);

        const error = new Error('Account not found');
        mockEq.mockResolvedValue({ error, data: null });

        await expect(
          service.deleteAccount('non-existent-id'),
        ).rejects.toThrow('Account not found');
      });

      it('should throw error on network failure', async () => {
        const service = createAdminAccountsService(mockClient);

        const error = new Error('Network error');
        mockEq.mockResolvedValue({ error, data: null });

        await expect(service.deleteAccount('account-123')).rejects.toThrow(
          'Network error',
        );
      });

      it('should throw error on permission denied', async () => {
        const service = createAdminAccountsService(mockClient);

        const error = new Error('Permission denied');
        mockEq.mockResolvedValue({ error, data: null });

        await expect(service.deleteAccount('account-123')).rejects.toThrow(
          'Permission denied',
        );
      });

      it('should throw database error object', async () => {
        const service = createAdminAccountsService(mockClient);

        const error = { message: 'DB error', code: '500' };
        mockEq.mockResolvedValue({ error, data: null });

        await expect(service.deleteAccount('account-123')).rejects.toEqual(
          error,
        );
      });
    });

    describe('edge cases', () => {
      it('should handle very long account IDs', async () => {
        const service = createAdminAccountsService(mockClient);

        const longId = 'a'.repeat(1000);
        mockEq.mockResolvedValue({ error: null, data: null });

        await service.deleteAccount(longId);

        expect(mockEq).toHaveBeenCalledWith('id', longId);
      });

      it('should handle account ID with special characters', async () => {
        const service = createAdminAccountsService(mockClient);

        const specialId = 'account-!@#$%^&*()';
        mockEq.mockResolvedValue({ error: null, data: null });

        await service.deleteAccount(specialId);

        expect(mockEq).toHaveBeenCalledWith('id', specialId);
      });

      it('should handle account ID with spaces', async () => {
        const service = createAdminAccountsService(mockClient);

        const idWithSpaces = 'account 123 456';
        mockEq.mockResolvedValue({ error: null, data: null });

        await service.deleteAccount(idWithSpaces);

        expect(mockEq).toHaveBeenCalledWith('id', idWithSpaces);
      });

      it('should handle empty string account ID', async () => {
        const service = createAdminAccountsService(mockClient);

        mockEq.mockResolvedValue({ error: null, data: null });

        await service.deleteAccount('');

        expect(mockEq).toHaveBeenCalledWith('id', '');
      });

      it('should handle numeric string account ID', async () => {
        const service = createAdminAccountsService(mockClient);

        mockEq.mockResolvedValue({ error: null, data: null });

        await service.deleteAccount('123456');

        expect(mockEq).toHaveBeenCalledWith('id', '123456');
      });

      it('should handle UUID format account ID', async () => {
        const service = createAdminAccountsService(mockClient);

        const uuid = '550e8400-e29b-41d4-a716-446655440000';
        mockEq.mockResolvedValue({ error: null, data: null });

        await service.deleteAccount(uuid);

        expect(mockEq).toHaveBeenCalledWith('id', uuid);
      });
    });

    describe('admin client usage', () => {
      it('should use admin client for deletion', async () => {
        const service = createAdminAccountsService(mockClient);

        mockEq.mockResolvedValue({ error: null, data: null });

        await service.deleteAccount('account-123');

        // Verify the admin client is used (from is called on adminClient)
        expect(mockFrom).toHaveBeenCalled();
      });

      it('should require admin client for RLS bypass', async () => {
        const service = createAdminAccountsService(mockClient);

        mockEq.mockResolvedValue({ error: null, data: null });

        await service.deleteAccount('account-123');

        // Service should use the provided admin client
        expect(mockClient.from).toHaveBeenCalled();
      });
    });

    describe('cascade deletion', () => {
      it('should trigger cascade deletion of related data', async () => {
        const service = createAdminAccountsService(mockClient);

        mockEq.mockResolvedValue({ error: null, data: null });

        // When account is deleted, database cascades should handle:
        // - account_memberships
        // - subscriptions
        // - account_invitations
        // - etc.
        await service.deleteAccount('account-with-relations');

        expect(mockEq).toHaveBeenCalledWith('id', 'account-with-relations');
      });

      it('should fail if cascade deletion violates constraints', async () => {
        const service = createAdminAccountsService(mockClient);

        const error = {
          message: 'Cannot delete account with active subscriptions',
          code: '23503',
        };
        mockEq.mockResolvedValue({ error, data: null });

        await expect(
          service.deleteAccount('account-with-subscriptions'),
        ).rejects.toEqual(error);
      });
    });

    describe('method chaining', () => {
      it('should chain from().delete().eq() correctly', async () => {
        const service = createAdminAccountsService(mockClient);

        mockEq.mockResolvedValue({ error: null, data: null });

        await service.deleteAccount('account-123');

        // Verify the chain: from -> delete -> eq
        expect(mockFrom).toHaveBeenCalledBefore(mockDelete);
        expect(mockDelete).toHaveBeenCalledBefore(mockEq);
      });

      it('should call methods in correct order', async () => {
        const service = createAdminAccountsService(mockClient);

        const callOrder: string[] = [];

        mockFrom.mockImplementation(() => {
          callOrder.push('from');
          return { delete: mockDelete };
        });

        mockDelete.mockImplementation(() => {
          callOrder.push('delete');
          return { eq: mockEq };
        });

        mockEq.mockImplementation(() => {
          callOrder.push('eq');
          return Promise.resolve({ error: null, data: null });
        });

        await service.deleteAccount('account-123');

        expect(callOrder).toEqual(['from', 'delete', 'eq']);
      });
    });

    describe('concurrent deletions', () => {
      it('should handle multiple concurrent deletions', async () => {
        const service = createAdminAccountsService(mockClient);

        mockEq.mockResolvedValue({ error: null, data: null });

        await Promise.all([
          service.deleteAccount('account-1'),
          service.deleteAccount('account-2'),
          service.deleteAccount('account-3'),
        ]);

        expect(mockEq).toHaveBeenCalledTimes(3);
        expect(mockEq).toHaveBeenCalledWith('id', 'account-1');
        expect(mockEq).toHaveBeenCalledWith('id', 'account-2');
        expect(mockEq).toHaveBeenCalledWith('id', 'account-3');
      });

      it('should handle one failure in concurrent deletions', async () => {
        const service = createAdminAccountsService(mockClient);

        mockEq
          .mockResolvedValueOnce({ error: null, data: null })
          .mockResolvedValueOnce({
            error: new Error('Failed'),
            data: null,
          })
          .mockResolvedValueOnce({ error: null, data: null });

        const results = await Promise.allSettled([
          service.deleteAccount('account-1'),
          service.deleteAccount('account-2'),
          service.deleteAccount('account-3'),
        ]);

        expect(results[0].status).toBe('fulfilled');
        expect(results[1].status).toBe('rejected');
        expect(results[2].status).toBe('fulfilled');
      });
    });
  });
});
