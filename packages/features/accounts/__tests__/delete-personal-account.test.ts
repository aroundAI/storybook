import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createDeletePersonalAccountService } from '../src/server/services/delete-personal-account.service';

// Create a shared logger instance
const mockLogger = {
  info: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
};

// Mock logger to return the same instance
vi.mock('@kit/shared/logger', () => ({
  getLogger: vi.fn(() => Promise.resolve(mockLogger)),
}));

describe('DeletePersonalAccountService', () => {
  let service: ReturnType<typeof createDeletePersonalAccountService>;
  let mockAdminClient: any;

  beforeEach(() => {
    vi.clearAllMocks();

    // Create service
    service = createDeletePersonalAccountService();

    // Mock admin client
    mockAdminClient = {
      auth: {
        admin: {
          deleteUser: vi.fn(),
        },
      },
    };
  });

  describe('Factory function', () => {
    it('should create delete personal account service', () => {
      const service = createDeletePersonalAccountService();

      expect(service).toBeDefined();
      expect(typeof service.deletePersonalAccount).toBe('function');
    });

    it('should create independent service instances', () => {
      const service1 = createDeletePersonalAccountService();
      const service2 = createDeletePersonalAccountService();

      expect(service1).not.toBe(service2);
    });
  });

  describe('deletePersonalAccount', () => {
    it('should successfully delete user account', async () => {
      mockAdminClient.auth.admin.deleteUser.mockResolvedValueOnce({
        data: { user: null },
        error: null,
      });

      const result = await service.deletePersonalAccount({
        adminClient: mockAdminClient,
        userId: 'user-123',
        userEmail: 'user@example.com',
      });

      expect(result).toEqual({ success: true });

      expect(mockAdminClient.auth.admin.deleteUser).toHaveBeenCalledWith(
        'user-123',
      );

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'user-123',
          name: 'accounts.delete',
        }),
        'User requested to delete their personal account. Processing...',
      );

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'user-123',
        }),
        'User successfully deleted!',
      );
    });

    it('should delete user with null email', async () => {
      mockAdminClient.auth.admin.deleteUser.mockResolvedValueOnce({
        data: { user: null },
        error: null,
      });

      const result = await service.deletePersonalAccount({
        adminClient: mockAdminClient,
        userId: 'user-456',
        userEmail: null,
      });

      expect(result).toEqual({ success: true });
      expect(mockAdminClient.auth.admin.deleteUser).toHaveBeenCalledWith(
        'user-456',
      );
    });

    it('should log deletion request', async () => {
      mockAdminClient.auth.admin.deleteUser.mockResolvedValueOnce({
        data: { user: null },
        error: null,
      });

      await service.deletePersonalAccount({
        adminClient: mockAdminClient,
        userId: 'user-789',
        userEmail: 'test@example.com',
      });

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'user-789',
          name: 'accounts.delete',
        }),
        expect.stringContaining('delete their personal account'),
      );
    });

    it('should log successful deletion', async () => {
      mockAdminClient.auth.admin.deleteUser.mockResolvedValueOnce({
        data: { user: null },
        error: null,
      });

      await service.deletePersonalAccount({
        adminClient: mockAdminClient,
        userId: 'user-success',
        userEmail: 'success@example.com',
      });

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'user-success',
        }),
        'User successfully deleted!',
      );
    });
  });

  describe('Error handling', () => {
    it('should throw error when deleteUser returns error', async () => {
      const deleteError = new Error('Failed to delete user');

      mockAdminClient.auth.admin.deleteUser.mockResolvedValueOnce({
        data: null,
        error: deleteError,
      });

      await expect(
        service.deletePersonalAccount({
          adminClient: mockAdminClient,
          userId: 'user-error',
          userEmail: 'error@example.com',
        }),
      ).rejects.toThrow('Error deleting user');

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'user-error',
          error: deleteError,
        }),
        'Encountered an error deleting user',
      );
    });

    it('should throw error when deleteUser throws exception', async () => {
      const exception = new Error('Network error');

      mockAdminClient.auth.admin.deleteUser.mockRejectedValueOnce(exception);

      await expect(
        service.deletePersonalAccount({
          adminClient: mockAdminClient,
          userId: 'user-exception',
          userEmail: 'exception@example.com',
        }),
      ).rejects.toThrow('Error deleting user');

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'user-exception',
          error: exception,
        }),
        'Encountered an error deleting user',
      );
    });

    it('should log error context when deletion fails', async () => {
      const deleteError = {
        message: 'User not found',
        code: 'USER_NOT_FOUND',
      };

      mockAdminClient.auth.admin.deleteUser.mockResolvedValueOnce({
        data: null,
        error: deleteError,
      });

      await expect(
        service.deletePersonalAccount({
          adminClient: mockAdminClient,
          userId: 'missing-user',
          userEmail: 'missing@example.com',
        }),
      ).rejects.toThrow();

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'missing-user',
          name: 'accounts.delete',
          error: deleteError,
        }),
        'Encountered an error deleting user',
      );
    });

    it('should handle authorization errors', async () => {
      const authError = {
        message: 'Insufficient permissions',
        code: 'INSUFFICIENT_PERMISSIONS',
      };

      mockAdminClient.auth.admin.deleteUser.mockResolvedValueOnce({
        data: null,
        error: authError,
      });

      await expect(
        service.deletePersonalAccount({
          adminClient: mockAdminClient,
          userId: 'unauthorized-delete',
          userEmail: 'unauthorized@example.com',
        }),
      ).rejects.toThrow('Error deleting user');
    });

    it('should handle database errors', async () => {
      const dbError = new Error('Database connection failed');

      mockAdminClient.auth.admin.deleteUser.mockRejectedValueOnce(dbError);

      await expect(
        service.deletePersonalAccount({
          adminClient: mockAdminClient,
          userId: 'db-error',
          userEmail: 'db@example.com',
        }),
      ).rejects.toThrow('Error deleting user');
    });
  });

  describe('Integration scenarios', () => {
    it('should handle rapid deletion requests', async () => {
      mockAdminClient.auth.admin.deleteUser.mockResolvedValue({
        data: { user: null },
        error: null,
      });

      const deletions = [
        service.deletePersonalAccount({
          adminClient: mockAdminClient,
          userId: 'user-1',
          userEmail: 'user1@example.com',
        }),
        service.deletePersonalAccount({
          adminClient: mockAdminClient,
          userId: 'user-2',
          userEmail: 'user2@example.com',
        }),
        service.deletePersonalAccount({
          adminClient: mockAdminClient,
          userId: 'user-3',
          userEmail: 'user3@example.com',
        }),
      ];

      const results = await Promise.all(deletions);

      expect(results).toHaveLength(3);
      expect(results.every((r) => r.success)).toBe(true);
      expect(mockAdminClient.auth.admin.deleteUser).toHaveBeenCalledTimes(3);
    });

    it('should handle mixed success and failure', async () => {
      mockAdminClient.auth.admin.deleteUser
        .mockResolvedValueOnce({
          data: { user: null },
          error: null,
        })
        .mockResolvedValueOnce({
          data: null,
          error: new Error('Failed'),
        });

      const result1 = await service.deletePersonalAccount({
        adminClient: mockAdminClient,
        userId: 'user-success',
        userEmail: 'success@example.com',
      });

      expect(result1.success).toBe(true);

      await expect(
        service.deletePersonalAccount({
          adminClient: mockAdminClient,
          userId: 'user-fail',
          userEmail: 'fail@example.com',
        }),
      ).rejects.toThrow();
    });
  });

  describe('Edge cases', () => {
    it('should handle very long user IDs', async () => {
      const longUserId = 'user-' + 'a'.repeat(1000);

      mockAdminClient.auth.admin.deleteUser.mockResolvedValueOnce({
        data: { user: null },
        error: null,
      });

      const result = await service.deletePersonalAccount({
        adminClient: mockAdminClient,
        userId: longUserId,
        userEmail: 'long@example.com',
      });

      expect(result.success).toBe(true);
      expect(mockAdminClient.auth.admin.deleteUser).toHaveBeenCalledWith(
        longUserId,
      );
    });

    it('should handle very long email addresses', async () => {
      const longEmail = 'a'.repeat(100) + '@' + 'b'.repeat(100) + '.com';

      mockAdminClient.auth.admin.deleteUser.mockResolvedValueOnce({
        data: { user: null },
        error: null,
      });

      const result = await service.deletePersonalAccount({
        adminClient: mockAdminClient,
        userId: 'user-long-email',
        userEmail: longEmail,
      });

      expect(result.success).toBe(true);
    });

    it('should handle UUID format user IDs', async () => {
      const uuid = '550e8400-e29b-41d4-a716-446655440000';

      mockAdminClient.auth.admin.deleteUser.mockResolvedValueOnce({
        data: { user: null },
        error: null,
      });

      const result = await service.deletePersonalAccount({
        adminClient: mockAdminClient,
        userId: uuid,
        userEmail: 'uuid@example.com',
      });

      expect(result.success).toBe(true);
      expect(mockAdminClient.auth.admin.deleteUser).toHaveBeenCalledWith(uuid);
    });

    it('should handle special characters in email', async () => {
      const specialEmail = "user+test@example.com'<>";

      mockAdminClient.auth.admin.deleteUser.mockResolvedValueOnce({
        data: { user: null },
        error: null,
      });

      const result = await service.deletePersonalAccount({
        adminClient: mockAdminClient,
        userId: 'user-special',
        userEmail: specialEmail,
      });

      expect(result.success).toBe(true);
    });
  });

  describe('Logging behavior', () => {
    it('should use correct namespace for logging', async () => {
      mockAdminClient.auth.admin.deleteUser.mockResolvedValueOnce({
        data: { user: null },
        error: null,
      });

      await service.deletePersonalAccount({
        adminClient: mockAdminClient,
        userId: 'user-namespace',
        userEmail: 'namespace@example.com',
      });

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'accounts.delete',
        }),
        expect.any(String),
      );
    });

    it('should log both info messages in successful flow', async () => {
      mockAdminClient.auth.admin.deleteUser.mockResolvedValueOnce({
        data: { user: null },
        error: null,
      });

      await service.deletePersonalAccount({
        adminClient: mockAdminClient,
        userId: 'user-logs',
        userEmail: 'logs@example.com',
      });

      expect(mockLogger.info).toHaveBeenCalledTimes(2);
    });

    it('should log error but not success message on failure', async () => {
      mockAdminClient.auth.admin.deleteUser.mockResolvedValueOnce({
        data: null,
        error: new Error('Test error'),
      });

      await expect(
        service.deletePersonalAccount({
          adminClient: mockAdminClient,
          userId: 'user-error-log',
          userEmail: 'errorlog@example.com',
        }),
      ).rejects.toThrow();

      // Should log: 1x processing message, 0x success message, 1x error message
      expect(mockLogger.info).toHaveBeenCalledTimes(1);
      expect(mockLogger.error).toHaveBeenCalledTimes(1);
    });
  });
});
