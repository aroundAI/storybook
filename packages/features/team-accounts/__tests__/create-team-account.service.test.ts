import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createCreateTeamAccountService } from '../src/server/services/create-team-account.service';

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
  rpc: vi.fn(
    (): Promise<QueryResult> =>
      Promise.resolve({
        data: { id: 'acc-123', name: 'Test Team', slug: 'test-team' },
        error: null,
      }),
  ),
  from: vi.fn(),
});

describe('CreateTeamAccountService', () => {
  let mockClient: ReturnType<typeof createMockClient>;

  beforeEach(() => {
    mockClient = createMockClient();
    vi.clearAllMocks();
  });

  describe('service initialization', () => {
    it('should create service instance', () => {
      const service = createCreateTeamAccountService(mockClient as any);

      expect(service).toBeDefined();
      expect(typeof service.createNewOrganizationAccount).toBe('function');
    });
  });

  describe('createNewOrganizationAccount - successful creation', () => {
    it('should create team account with valid name', async () => {
      const service = createCreateTeamAccountService(mockClient as any);

      const params = {
        name: 'Test Team',
        userId: '123e4567-e89b-12d3-a456-426614174000',
      };

      const result = await service.createNewOrganizationAccount(params);

      expect(result).toBeDefined();
      expect(result.data).toEqual({
        id: 'acc-123',
        name: 'Test Team',
        slug: 'test-team',
      });
      expect(result.error).toBeNull();
    });

    it('should call create_team_account RPC with correct params', async () => {
      const service = createCreateTeamAccountService(mockClient as any);

      const params = {
        name: 'My Company',
        userId: '123e4567-e89b-12d3-a456-426614174000',
      };

      await service.createNewOrganizationAccount(params);

      expect(mockClient.rpc).toHaveBeenCalledWith('create_team_account', {
        account_name: 'My Company',
      });
    });

    it('should return created account data', async () => {
      const service = createCreateTeamAccountService(mockClient as any);

      mockClient.rpc.mockResolvedValue({
        data: {
          id: 'new-acc-456',
          name: 'New Team',
          slug: 'new-team',
          created_at: '2024-01-01',
          updated_at: '2024-01-01',
        },
        error: null,
      });

      const params = {
        name: 'New Team',
        userId: '123e4567-e89b-12d3-a456-426614174000',
      };

      const result = await service.createNewOrganizationAccount(params);

      expect(result.data).toEqual({
        id: 'new-acc-456',
        name: 'New Team',
        slug: 'new-team',
        created_at: '2024-01-01',
        updated_at: '2024-01-01',
      });
    });

    it('should log creation success', async () => {
      const service = createCreateTeamAccountService(mockClient as any);

      const params = {
        name: 'Success Team',
        userId: '123e4567-e89b-12d3-a456-426614174000',
      };

      await service.createNewOrganizationAccount(params);

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Success Team',
          userId: params.userId,
          namespace: 'accounts.create-team-account',
        }),
        'Creating new team account...',
      );

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.anything(),
        'Team account created successfully',
      );
    });
  });

  describe('createNewOrganizationAccount - team name validation', () => {
    it('should accept valid team names (2-50 chars)', async () => {
      const service = createCreateTeamAccountService(mockClient as any);

      const validNames = [
        'AB', // Minimum 2 chars
        'My Team',
        'Company Name',
        'A'.repeat(50), // Maximum 50 chars
      ];

      for (const name of validNames) {
        const params = {
          name,
          userId: '123e4567-e89b-12d3-a456-426614174000',
        };

        await expect(
          service.createNewOrganizationAccount(params),
        ).resolves.toBeDefined();
      }
    });

    it('should accept team names with allowed characters', async () => {
      const service = createCreateTeamAccountService(mockClient as any);

      const validNames = [
        'Team Name',
        'Company-Name',
        'Team_123',
        'Company & Co',
        'Team-Name_2024',
      ];

      for (const name of validNames) {
        vi.clearAllMocks();

        const params = {
          name,
          userId: '123e4567-e89b-12d3-a456-426614174000',
        };

        await expect(
          service.createNewOrganizationAccount(params),
        ).resolves.toBeDefined();
      }
    });

    it('should accept names with spaces and hyphens', async () => {
      const service = createCreateTeamAccountService(mockClient as any);

      const params = {
        name: 'My Great Team-Name',
        userId: '123e4567-e89b-12d3-a456-426614174000',
      };

      await expect(
        service.createNewOrganizationAccount(params),
      ).resolves.toBeDefined();
    });

    it('should accept names with numbers', async () => {
      const service = createCreateTeamAccountService(mockClient as any);

      const params = {
        name: 'Team 2024',
        userId: '123e4567-e89b-12d3-a456-426614174000',
      };

      await expect(
        service.createNewOrganizationAccount(params),
      ).resolves.toBeDefined();
    });

    it('should accept names with ampersands', async () => {
      const service = createCreateTeamAccountService(mockClient as any);

      const params = {
        name: 'Smith & Jones',
        userId: '123e4567-e89b-12d3-a456-426614174000',
      };

      await expect(
        service.createNewOrganizationAccount(params),
      ).resolves.toBeDefined();
    });
  });

  describe('createNewOrganizationAccount - RPC integration', () => {
    it('should handle RPC success response', async () => {
      const service = createCreateTeamAccountService(mockClient as any);

      mockClient.rpc.mockResolvedValue({
        data: { id: 'acc-789', name: 'RPC Team' },
        error: null,
      });

      const params = {
        name: 'RPC Team',
        userId: '123e4567-e89b-12d3-a456-426614174000',
      };

      const result = await service.createNewOrganizationAccount(params);

      expect(result.error).toBeNull();
      expect(result.data).toEqual({ id: 'acc-789', name: 'RPC Team' });
    });

    it('should handle RPC error response', async () => {
      const service = createCreateTeamAccountService(mockClient as any);

      const rpcError = new Error('RPC failed');

      mockClient.rpc.mockResolvedValue({
        data: null,
        error: rpcError,
      });

      const params = {
        name: 'Error Team',
        userId: '123e4567-e89b-12d3-a456-426614174000',
      };

      await expect(
        service.createNewOrganizationAccount(params),
      ).rejects.toThrow('Error creating team account');
    });

    it('should pass only account_name to RPC', async () => {
      const service = createCreateTeamAccountService(mockClient as any);

      const params = {
        name: 'Param Test',
        userId: '123e4567-e89b-12d3-a456-426614174000',
      };

      await service.createNewOrganizationAccount(params);

      // Verify RPC called with only account_name (not userId)
      expect(mockClient.rpc).toHaveBeenCalledWith('create_team_account', {
        account_name: 'Param Test',
      });

      // Ensure userId is not passed to RPC
      expect(mockClient.rpc).not.toHaveBeenCalledWith(
        'create_team_account',
        expect.objectContaining({ userId: expect.anything() }),
      );
    });
  });

  describe('createNewOrganizationAccount - error handling', () => {
    it('should throw error when RPC fails', async () => {
      const service = createCreateTeamAccountService(mockClient as any);

      const error = { code: '23505', message: 'Duplicate name' };

      mockClient.rpc.mockResolvedValue({
        data: null,
        error,
      });

      const params = {
        name: 'Duplicate Team',
        userId: '123e4567-e89b-12d3-a456-426614174000',
      };

      await expect(
        service.createNewOrganizationAccount(params),
      ).rejects.toThrow('Error creating team account');
    });

    it('should log error with context', async () => {
      const service = createCreateTeamAccountService(mockClient as any);

      const error = new Error('Database error');

      mockClient.rpc.mockResolvedValue({
        data: null,
        error,
      });

      const params = {
        name: 'Error Log Team',
        userId: '123e4567-e89b-12d3-a456-426614174000',
      };

      await expect(
        service.createNewOrganizationAccount(params),
      ).rejects.toThrow();

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          error,
          name: 'Error Log Team',
          userId: params.userId,
          namespace: 'accounts.create-team-account',
        }),
        'Error creating team account',
      );
    });

    it('should handle database constraint errors', async () => {
      const service = createCreateTeamAccountService(mockClient as any);

      const constraintError = {
        code: '23505',
        message: 'duplicate key value violates unique constraint',
      };

      mockClient.rpc.mockResolvedValue({
        data: null,
        error: constraintError,
      });

      const params = {
        name: 'Existing Team',
        userId: '123e4567-e89b-12d3-a456-426614174000',
      };

      await expect(
        service.createNewOrganizationAccount(params),
      ).rejects.toThrow();

      expect(mockLogger.error).toHaveBeenCalled();
    });
  });

  describe('createNewOrganizationAccount - edge cases', () => {
    it('should handle unicode characters in team name', async () => {
      const service = createCreateTeamAccountService(mockClient as any);

      const params = {
        name: '日本チーム', // Japanese characters
        userId: '123e4567-e89b-12d3-a456-426614174000',
      };

      await expect(
        service.createNewOrganizationAccount(params),
      ).resolves.toBeDefined();

      expect(mockClient.rpc).toHaveBeenCalledWith('create_team_account', {
        account_name: '日本チーム',
      });
    });

    it('should handle emoji in team name', async () => {
      const service = createCreateTeamAccountService(mockClient as any);

      const params = {
        name: 'Team 🚀 Rocket',
        userId: '123e4567-e89b-12d3-a456-426614174000',
      };

      await expect(
        service.createNewOrganizationAccount(params),
      ).resolves.toBeDefined();
    });

    it('should handle very long userId', async () => {
      const service = createCreateTeamAccountService(mockClient as any);

      const params = {
        name: 'UUID Team',
        userId: '123e4567-e89b-12d3-a456-426614174000-extra', // Invalid UUID but still string
      };

      await expect(
        service.createNewOrganizationAccount(params),
      ).resolves.toBeDefined();
    });
  });

  describe('createNewOrganizationAccount - integration scenarios', () => {
    it('should create multiple team accounts sequentially', async () => {
      const service = createCreateTeamAccountService(mockClient as any);

      const userId = '123e4567-e89b-12d3-a456-426614174000';

      await service.createNewOrganizationAccount({
        name: 'Team One',
        userId,
      });
      await service.createNewOrganizationAccount({
        name: 'Team Two',
        userId,
      });
      await service.createNewOrganizationAccount({
        name: 'Team Three',
        userId,
      });

      expect(mockClient.rpc).toHaveBeenCalledTimes(3);
      expect(mockLogger.info).toHaveBeenCalledTimes(6); // 3 start + 3 success
    });

    it('should return both data and error fields', async () => {
      const service = createCreateTeamAccountService(mockClient as any);

      const params = {
        name: 'Return Test',
        userId: '123e4567-e89b-12d3-a456-426614174000',
      };

      const result = await service.createNewOrganizationAccount(params);

      expect(result).toHaveProperty('data');
      expect(result).toHaveProperty('error');
      expect(result.error).toBeNull();
      expect(result.data).toBeDefined();
    });
  });
});
