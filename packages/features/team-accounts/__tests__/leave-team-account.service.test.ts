import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createLeaveTeamAccountService } from '../src/server/services/leave-team-account.service';

// Mock logger
/**
 * These mocks resolve to `{ data, error }` where either side can be null.
 * Inferring the type from a happy-path default pins `data` to one shape and
 * `error` to `null`, making every failure case in the file a type error.
 */
interface QueryResult {
  data: unknown;
  error: unknown;
}

const mockLogger = {
  info: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
};

vi.mock('@kit/shared/logger', () => ({
  getLogger: vi.fn(() => Promise.resolve(mockLogger)),
}));

// Create mock Supabase client
const createMockClient = () => ({
  from: vi.fn(() => ({
    delete: vi.fn().mockReturnThis(),
    match: vi.fn(
      (): Promise<QueryResult> => Promise.resolve({ data: null, error: null }),
    ),
  })),
  rpc: vi.fn(
    (): Promise<QueryResult> => Promise.resolve({ data: null, error: null }),
  ),
});

describe('LeaveTeamAccountService', () => {
  let mockClient: ReturnType<typeof createMockClient>;

  beforeEach(() => {
    mockClient = createMockClient();
    vi.clearAllMocks();
  });

  describe('service initialization', () => {
    it('should create service instance with admin client', () => {
      const service = createLeaveTeamAccountService(mockClient as any);

      expect(service).toBeDefined();
      expect(typeof service.leaveTeamAccount).toBe('function');
    });
  });

  describe('leaveTeamAccount - successful operations', () => {
    it('should leave team account successfully', async () => {
      const service = createLeaveTeamAccountService(mockClient as any);

      mockClient.from.mockReturnValue({
        delete: vi.fn().mockReturnThis(),
        match: vi.fn(
          (): Promise<QueryResult> =>
            Promise.resolve({ data: null, error: null }),
        ),
      });

      const params = {
        accountId: '123e4567-e89b-12d3-a456-426614174000',
        userId: '987fcdeb-51a2-43d7-8f9e-123456789abc',
      };

      await expect(service.leaveTeamAccount(params)).resolves.not.toThrow();

      expect(mockClient.from).toHaveBeenCalledWith('accounts_memberships');
    });

    it('should delete membership record from database', async () => {
      const service = createLeaveTeamAccountService(mockClient as any);

      const mockDelete = vi.fn().mockReturnThis();
      const mockMatch = vi.fn(
        (): Promise<QueryResult> =>
          Promise.resolve({ data: null, error: null }),
      );

      mockClient.from.mockReturnValue({
        delete: mockDelete,
        match: mockMatch,
      });

      const params = {
        accountId: '123e4567-e89b-12d3-a456-426614174000',
        userId: '987fcdeb-51a2-43d7-8f9e-123456789abc',
      };

      await service.leaveTeamAccount(params);

      expect(mockDelete).toHaveBeenCalled();
      expect(mockMatch).toHaveBeenCalledWith({
        account_id: params.accountId,
        user_id: params.userId,
      });
    });

    it('should log success messages', async () => {
      const service = createLeaveTeamAccountService(mockClient as any);

      mockClient.from.mockReturnValue({
        delete: vi.fn().mockReturnThis(),
        match: vi.fn(
          (): Promise<QueryResult> =>
            Promise.resolve({ data: null, error: null }),
        ),
      });

      const params = {
        accountId: '123e4567-e89b-12d3-a456-426614174000',
        userId: '987fcdeb-51a2-43d7-8f9e-123456789abc',
      };

      await service.leaveTeamAccount(params);

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          accountId: params.accountId,
          userId: params.userId,
          name: 'leave-team-account',
        }),
        'Leaving team account...',
      );

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          accountId: params.accountId,
          userId: params.userId,
        }),
        'Successfully left team account',
      );
    });
  });

  describe('leaveTeamAccount - schema validation', () => {
    it('should validate accountId is UUID format', async () => {
      const service = createLeaveTeamAccountService(mockClient as any);

      const params = {
        accountId: 'invalid-uuid',
        userId: '987fcdeb-51a2-43d7-8f9e-123456789abc',
      };

      await expect(service.leaveTeamAccount(params)).rejects.toThrow();
    });

    it('should validate userId is UUID format', async () => {
      const service = createLeaveTeamAccountService(mockClient as any);

      const params = {
        accountId: '123e4567-e89b-12d3-a456-426614174000',
        userId: 'not-a-uuid',
      };

      await expect(service.leaveTeamAccount(params)).rejects.toThrow();
    });

    it('should reject both invalid UUIDs', async () => {
      const service = createLeaveTeamAccountService(mockClient as any);

      const params = {
        accountId: 'invalid',
        userId: 'also-invalid',
      };

      await expect(service.leaveTeamAccount(params)).rejects.toThrow();
    });
  });

  describe('leaveTeamAccount - error handling', () => {
    it('should handle database deletion errors', async () => {
      const service = createLeaveTeamAccountService(mockClient as any);

      const dbError = new Error('Database error');

      mockClient.from.mockReturnValue({
        delete: vi.fn().mockReturnThis(),
        match: vi.fn(
          (): Promise<QueryResult> =>
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

      await expect(service.leaveTeamAccount(params)).rejects.toThrow(
        'Failed to leave team account',
      );

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          error: dbError,
        }),
        'Failed to leave team account',
      );
    });

    it('should handle missing membership records', async () => {
      const service = createLeaveTeamAccountService(mockClient as any);

      const error = { code: 'PGRST116', message: 'Not found' };

      mockClient.from.mockReturnValue({
        delete: vi.fn().mockReturnThis(),
        match: vi.fn(
          (): Promise<QueryResult> =>
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

      await expect(service.leaveTeamAccount(params)).rejects.toThrow();
    });

    it('should throw error with proper logging on failure', async () => {
      const service = createLeaveTeamAccountService(mockClient as any);

      const error = new Error('Constraint violation');

      mockClient.from.mockReturnValue({
        delete: vi.fn().mockReturnThis(),
        match: vi.fn(
          (): Promise<QueryResult> =>
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

      await expect(service.leaveTeamAccount(params)).rejects.toThrow();

      expect(mockLogger.error).toHaveBeenCalled();
      expect(mockLogger.info).toHaveBeenCalledTimes(1); // Only initial log, not success
    });
  });

  describe('leaveTeamAccount - edge cases', () => {
    it('should handle null parameters gracefully', async () => {
      const service = createLeaveTeamAccountService(mockClient as any);

      const params = {
        accountId: null as any,
        userId: null as any,
      };

      await expect(service.leaveTeamAccount(params)).rejects.toThrow();
    });

    it('should handle undefined parameters gracefully', async () => {
      const service = createLeaveTeamAccountService(mockClient as any);

      const params = {
        accountId: undefined as any,
        userId: undefined as any,
      };

      await expect(service.leaveTeamAccount(params)).rejects.toThrow();
    });

    it('should handle empty string UUIDs', async () => {
      const service = createLeaveTeamAccountService(mockClient as any);

      const params = {
        accountId: '',
        userId: '',
      };

      await expect(service.leaveTeamAccount(params)).rejects.toThrow();
    });
  });

  describe('leaveTeamAccount - integration scenarios', () => {
    it('should use admin client for deletion', async () => {
      const service = createLeaveTeamAccountService(mockClient as any);

      mockClient.from.mockReturnValue({
        delete: vi.fn().mockReturnThis(),
        match: vi.fn(
          (): Promise<QueryResult> =>
            Promise.resolve({ data: null, error: null }),
        ),
      });

      const params = {
        accountId: '123e4567-e89b-12d3-a456-426614174000',
        userId: '987fcdeb-51a2-43d7-8f9e-123456789abc',
      };

      await service.leaveTeamAccount(params);

      // Verify client.from was called (indicates admin client usage)
      expect(mockClient.from).toHaveBeenCalledWith('accounts_memberships');
    });

    it('should handle multiple users leaving same account', async () => {
      const service = createLeaveTeamAccountService(mockClient as any);

      mockClient.from.mockReturnValue({
        delete: vi.fn().mockReturnThis(),
        match: vi.fn(
          (): Promise<QueryResult> =>
            Promise.resolve({ data: null, error: null }),
        ),
      });

      const accountId = '123e4567-e89b-12d3-a456-426614174000';
      const user1 = '987fcdeb-51a2-43d7-8f9e-111111111111';
      const user2 = '987fcdeb-51a2-43d7-8f9e-222222222222';

      await service.leaveTeamAccount({ accountId, userId: user1 });
      await service.leaveTeamAccount({ accountId, userId: user2 });

      expect(mockClient.from).toHaveBeenCalledTimes(2);
      expect(mockLogger.info).toHaveBeenCalledTimes(4); // 2 start + 2 success logs
    });
  });
});
