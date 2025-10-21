import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createDeleteTeamAccountService } from '../src/server/services/delete-team-account.service';

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

// Create mock Supabase admin client
const createMockAdminClient = () => ({
  from: vi.fn(() => ({
    delete: vi.fn().mockReturnThis(),
    eq: vi.fn(() => Promise.resolve({ data: null, error: null })),
  })),
  rpc: vi.fn(() => Promise.resolve({ data: null, error: null })),
});

describe('DeleteTeamAccountService', () => {
  let mockAdminClient: ReturnType<typeof createMockAdminClient>;

  beforeEach(() => {
    mockAdminClient = createMockAdminClient();
    vi.clearAllMocks();
  });

  describe('service initialization', () => {
    it('should create service instance', () => {
      const service = createDeleteTeamAccountService();

      expect(service).toBeDefined();
      expect(typeof service.deleteTeamAccount).toBe('function');
    });

    it('should not require dependencies in constructor', () => {
      // Service factory takes no arguments
      const service = createDeleteTeamAccountService();

      expect(service).toBeDefined();
    });
  });

  describe('deleteTeamAccount - successful deletion', () => {
    it('should delete team account successfully', async () => {
      const service = createDeleteTeamAccountService();

      mockAdminClient.from.mockReturnValue({
        delete: vi.fn().mockReturnThis(),
        eq: vi.fn(() => Promise.resolve({ data: null, error: null })),
      });

      const params = {
        accountId: '123e4567-e89b-12d3-a456-426614174000',
        userId: '987fcdeb-51a2-43d7-8f9e-123456789abc',
      };

      await expect(
        service.deleteTeamAccount(mockAdminClient as any, params),
      ).resolves.not.toThrow();

      expect(mockAdminClient.from).toHaveBeenCalledWith('accounts');
    });

    it('should use admin client to delete account', async () => {
      const service = createDeleteTeamAccountService();

      const mockDelete = vi.fn().mockReturnThis();
      const mockEq = vi.fn(() => Promise.resolve({ data: null, error: null }));

      mockAdminClient.from.mockReturnValue({
        delete: mockDelete,
        eq: mockEq,
      });

      const params = {
        accountId: '123e4567-e89b-12d3-a456-426614174000',
        userId: '987fcdeb-51a2-43d7-8f9e-123456789abc',
      };

      await service.deleteTeamAccount(mockAdminClient as any, params);

      expect(mockDelete).toHaveBeenCalled();
      expect(mockEq).toHaveBeenCalledWith('id', params.accountId);
    });

    it('should log deletion progress', async () => {
      const service = createDeleteTeamAccountService();

      mockAdminClient.from.mockReturnValue({
        delete: vi.fn().mockReturnThis(),
        eq: vi.fn(() => Promise.resolve({ data: null, error: null })),
      });

      const params = {
        accountId: '123e4567-e89b-12d3-a456-426614174000',
        userId: '987fcdeb-51a2-43d7-8f9e-123456789abc',
      };

      await service.deleteTeamAccount(mockAdminClient as any, params);

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          accountId: params.accountId,
          userId: params.userId,
          name: 'accounts.delete-team-account',
        }),
        'Requested team account deletion. Processing...',
      );

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          accountId: params.accountId,
          userId: params.userId,
        }),
        'Successfully deleted team account',
      );
    });

    it('should complete without returning a value', async () => {
      const service = createDeleteTeamAccountService();

      mockAdminClient.from.mockReturnValue({
        delete: vi.fn().mockReturnThis(),
        eq: vi.fn(() => Promise.resolve({ data: null, error: null })),
      });

      const params = {
        accountId: '123e4567-e89b-12d3-a456-426614174000',
        userId: '987fcdeb-51a2-43d7-8f9e-123456789abc',
      };

      const result = await service.deleteTeamAccount(
        mockAdminClient as any,
        params,
      );

      expect(result).toBeUndefined();
    });
  });

  describe('deleteTeamAccount - cascade deletion', () => {
    it('should rely on database CASCADE for related data', async () => {
      const service = createDeleteTeamAccountService();

      mockAdminClient.from.mockReturnValue({
        delete: vi.fn().mockReturnThis(),
        eq: vi.fn(() => Promise.resolve({ data: null, error: null })),
      });

      const params = {
        accountId: '123e4567-e89b-12d3-a456-426614174000',
        userId: '987fcdeb-51a2-43d7-8f9e-123456789abc',
      };

      await service.deleteTeamAccount(mockAdminClient as any, params);

      // Only deletes from accounts table - CASCADE handles the rest
      expect(mockAdminClient.from).toHaveBeenCalledWith('accounts');
      expect(mockAdminClient.from).toHaveBeenCalledTimes(1);
    });

    it('should delete only the specific account by id', async () => {
      const service = createDeleteTeamAccountService();

      const mockEq = vi.fn(() => Promise.resolve({ data: null, error: null }));

      mockAdminClient.from.mockReturnValue({
        delete: vi.fn().mockReturnThis(),
        eq: mockEq,
      });

      const params = {
        accountId: 'specific-account-123',
        userId: '987fcdeb-51a2-43d7-8f9e-123456789abc',
      };

      await service.deleteTeamAccount(mockAdminClient as any, params);

      expect(mockEq).toHaveBeenCalledWith('id', 'specific-account-123');
    });
  });

  describe('deleteTeamAccount - error handling', () => {
    it('should handle database deletion errors', async () => {
      const service = createDeleteTeamAccountService();

      const dbError = new Error('Database error');

      mockAdminClient.from.mockReturnValue({
        delete: vi.fn().mockReturnThis(),
        eq: vi.fn(() =>
          Promise.resolve({
            data: null,
            error: dbError,
          }),
        ),
      });

      const params = {
        accountId: '123e4567-e89b-12d3-a456-426614174000',
        userId: '987fcdeb-51a2-43d7-8f9e-123456789abc',
      };

      await expect(
        service.deleteTeamAccount(mockAdminClient as any, params),
      ).rejects.toThrow('Failed to delete team account');

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          error: dbError,
          accountId: params.accountId,
          userId: params.userId,
        }),
        'Failed to delete team account',
      );
    });

    it('should handle foreign key constraint errors', async () => {
      const service = createDeleteTeamAccountService();

      const constraintError = {
        code: '23503',
        message: 'violates foreign key constraint',
      };

      mockAdminClient.from.mockReturnValue({
        delete: vi.fn().mockReturnThis(),
        eq: vi.fn(() =>
          Promise.resolve({
            data: null,
            error: constraintError,
          }),
        ),
      });

      const params = {
        accountId: '123e4567-e89b-12d3-a456-426614174000',
        userId: '987fcdeb-51a2-43d7-8f9e-123456789abc',
      };

      await expect(
        service.deleteTeamAccount(mockAdminClient as any, params),
      ).rejects.toThrow('Failed to delete team account');
    });

    it('should throw error with proper logging on failure', async () => {
      const service = createDeleteTeamAccountService();

      const error = new Error('Permission denied');

      mockAdminClient.from.mockReturnValue({
        delete: vi.fn().mockReturnThis(),
        eq: vi.fn(() =>
          Promise.resolve({
            data: null,
            error,
          }),
        ),
      });

      const params = {
        accountId: '123e4567-e89b-12d3-a456-426614174000',
        userId: '987fcdeb-51a2-43d7-8f9e-123456789abc',
      };

      await expect(
        service.deleteTeamAccount(mockAdminClient as any, params),
      ).rejects.toThrow();

      expect(mockLogger.error).toHaveBeenCalled();
      expect(mockLogger.info).toHaveBeenCalledTimes(1); // Only initial log, not success
    });

    it('should handle account not found scenario', async () => {
      const service = createDeleteTeamAccountService();

      const notFoundError = {
        code: 'PGRST116',
        message: 'Not found',
      };

      mockAdminClient.from.mockReturnValue({
        delete: vi.fn().mockReturnThis(),
        eq: vi.fn(() =>
          Promise.resolve({
            data: null,
            error: notFoundError,
          }),
        ),
      });

      const params = {
        accountId: 'non-existent-account',
        userId: '987fcdeb-51a2-43d7-8f9e-123456789abc',
      };

      await expect(
        service.deleteTeamAccount(mockAdminClient as any, params),
      ).rejects.toThrow('Failed to delete team account');
    });
  });

  describe('deleteTeamAccount - admin client requirement', () => {
    it('should use admin client to bypass RLS', async () => {
      const service = createDeleteTeamAccountService();

      mockAdminClient.from.mockReturnValue({
        delete: vi.fn().mockReturnThis(),
        eq: vi.fn(() => Promise.resolve({ data: null, error: null })),
      });

      const params = {
        accountId: '123e4567-e89b-12d3-a456-426614174000',
        userId: '987fcdeb-51a2-43d7-8f9e-123456789abc',
      };

      await service.deleteTeamAccount(mockAdminClient as any, params);

      // Verify the passed admin client was used
      expect(mockAdminClient.from).toHaveBeenCalled();
    });

    it('should accept admin client as first parameter', async () => {
      const service = createDeleteTeamAccountService();

      mockAdminClient.from.mockReturnValue({
        delete: vi.fn().mockReturnThis(),
        eq: vi.fn(() => Promise.resolve({ data: null, error: null })),
      });

      const params = {
        accountId: '123e4567-e89b-12d3-a456-426614174000',
        userId: '987fcdeb-51a2-43d7-8f9e-123456789abc',
      };

      // Admin client is passed as first argument
      await expect(
        service.deleteTeamAccount(mockAdminClient as any, params),
      ).resolves.not.toThrow();
    });
  });

  describe('deleteTeamAccount - edge cases', () => {
    it('should handle very long accountId strings', async () => {
      const service = createDeleteTeamAccountService();

      mockAdminClient.from.mockReturnValue({
        delete: vi.fn().mockReturnThis(),
        eq: vi.fn(() => Promise.resolve({ data: null, error: null })),
      });

      const params = {
        accountId: '123e4567-e89b-12d3-a456-426614174000'.repeat(10),
        userId: '987fcdeb-51a2-43d7-8f9e-123456789abc',
      };

      await expect(
        service.deleteTeamAccount(mockAdminClient as any, params),
      ).resolves.not.toThrow();
    });

    it('should handle special characters in accountId', async () => {
      const service = createDeleteTeamAccountService();

      mockAdminClient.from.mockReturnValue({
        delete: vi.fn().mockReturnThis(),
        eq: vi.fn(() => Promise.resolve({ data: null, error: null })),
      });

      const params = {
        accountId: 'account-with-dashes-123',
        userId: '987fcdeb-51a2-43d7-8f9e-123456789abc',
      };

      await expect(
        service.deleteTeamAccount(mockAdminClient as any, params),
      ).resolves.not.toThrow();
    });

    it('should include userId in logging context', async () => {
      const service = createDeleteTeamAccountService();

      mockAdminClient.from.mockReturnValue({
        delete: vi.fn().mockReturnThis(),
        eq: vi.fn(() => Promise.resolve({ data: null, error: null })),
      });

      const params = {
        accountId: '123e4567-e89b-12d3-a456-426614174000',
        userId: 'user-with-special-id',
      };

      await service.deleteTeamAccount(mockAdminClient as any, params);

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'user-with-special-id',
        }),
        expect.any(String),
      );
    });
  });

  describe('deleteTeamAccount - integration scenarios', () => {
    it('should handle multiple sequential deletions', async () => {
      const service = createDeleteTeamAccountService();

      mockAdminClient.from.mockReturnValue({
        delete: vi.fn().mockReturnThis(),
        eq: vi.fn(() => Promise.resolve({ data: null, error: null })),
      });

      const userId = '987fcdeb-51a2-43d7-8f9e-123456789abc';
      const account1 = '123e4567-e89b-12d3-a456-111111111111';
      const account2 = '123e4567-e89b-12d3-a456-222222222222';

      await service.deleteTeamAccount(mockAdminClient as any, {
        accountId: account1,
        userId,
      });
      await service.deleteTeamAccount(mockAdminClient as any, {
        accountId: account2,
        userId,
      });

      expect(mockAdminClient.from).toHaveBeenCalledTimes(2);
      expect(mockLogger.info).toHaveBeenCalledTimes(4); // 2 start + 2 success
    });

    it('should not interfere with concurrent deletions', async () => {
      const service = createDeleteTeamAccountService();

      mockAdminClient.from.mockReturnValue({
        delete: vi.fn().mockReturnThis(),
        eq: vi.fn(() => Promise.resolve({ data: null, error: null })),
      });

      const deletions = [
        {
          accountId: '123e4567-e89b-12d3-a456-111111111111',
          userId: '987fcdeb-51a2-43d7-8f9e-111111111111',
        },
        {
          accountId: '123e4567-e89b-12d3-a456-222222222222',
          userId: '987fcdeb-51a2-43d7-8f9e-222222222222',
        },
        {
          accountId: '123e4567-e89b-12d3-a456-333333333333',
          userId: '987fcdeb-51a2-43d7-8f9e-333333333333',
        },
      ];

      await Promise.all(
        deletions.map((params) =>
          service.deleteTeamAccount(mockAdminClient as any, params),
        ),
      );

      expect(mockAdminClient.from).toHaveBeenCalledTimes(3);
    });
  });

  describe('deleteTeamAccount - logging namespace', () => {
    it('should use correct namespace in logs', async () => {
      const service = createDeleteTeamAccountService();

      mockAdminClient.from.mockReturnValue({
        delete: vi.fn().mockReturnThis(),
        eq: vi.fn(() => Promise.resolve({ data: null, error: null })),
      });

      const params = {
        accountId: '123e4567-e89b-12d3-a456-426614174000',
        userId: '987fcdeb-51a2-43d7-8f9e-123456789abc',
      };

      await service.deleteTeamAccount(mockAdminClient as any, params);

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'accounts.delete-team-account',
        }),
        expect.any(String),
      );
    });
  });
});
