import { beforeEach, describe, expect, it, vi } from 'vitest';

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
/**
 * These mocks resolve to `{ data, error }` where either side can be null.
 * Inferring the type from a happy-path default pins `data` to one shape and
 * `error` to `null`, making every failure case in the file a type error.
 */
interface QueryResult {
  data: unknown;
  error: unknown;
}

const mockDecreaseSeats = vi.fn();

vi.mock('../src/server/services/account-per-seat-billing.service', () => ({
  createAccountPerSeatBillingService: vi.fn(() => ({
    decreaseSeats: mockDecreaseSeats,
    increaseSeats: vi.fn(),
  })),
}));

// Create mock Supabase client
const createMockClient = () => ({
  from: vi.fn(() => ({
    delete: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    match: vi.fn(
      (): Promise<QueryResult> => Promise.resolve({ data: null, error: null }),
    ),
  })),
  rpc: vi.fn(
    (): Promise<QueryResult> => Promise.resolve({ data: true, error: null }),
  ),
});

describe('AccountMembersService', () => {
  let mockClient: ReturnType<typeof createMockClient>;
  let mockAdminClient: ReturnType<typeof createMockClient>;

  beforeEach(() => {
    mockClient = createMockClient();
    mockAdminClient = createMockClient();
    vi.clearAllMocks();
  });

  describe('removeMemberFromAccount', () => {
    it('should remove member successfully', async () => {
      const service = createAccountMembersService(mockClient as any);

      mockClient.from.mockReturnValue({
        delete: vi.fn().mockReturnThis(),
        match: vi.fn(
          (): Promise<QueryResult> =>
            Promise.resolve({ data: null, error: null }),
        ),
      } as any);

      await service.removeMemberFromAccount({
        accountId: 'acc-123',
        userId: 'user-456',
      });

      expect(mockClient.from).toHaveBeenCalledWith('accounts_memberships');
      expect(mockDecreaseSeats).toHaveBeenCalledWith('acc-123');
    });

    it('should throw error when removal fails', async () => {
      const service = createAccountMembersService(mockClient as any);
      const error = new Error('Database error');

      mockClient.from.mockReturnValue({
        delete: vi.fn().mockReturnThis(),
        match: vi.fn(
          (): Promise<QueryResult> => Promise.resolve({ data: null, error }),
        ),
      } as any);

      await expect(
        service.removeMemberFromAccount({
          accountId: 'acc-123',
          userId: 'user-456',
        }),
      ).rejects.toThrow('Database error');

      // Should not call decreaseSeats if removal failed
      expect(mockDecreaseSeats).not.toHaveBeenCalled();
    });

    it('should call decreaseSeats after successful removal', async () => {
      const service = createAccountMembersService(mockClient as any);

      mockClient.from.mockReturnValue({
        delete: vi.fn().mockReturnThis(),
        match: vi.fn(
          (): Promise<QueryResult> =>
            Promise.resolve({ data: null, error: null }),
        ),
      } as any);

      await service.removeMemberFromAccount({
        accountId: 'acc-123',
        userId: 'user-456',
      });

      expect(mockDecreaseSeats).toHaveBeenCalledTimes(1);
      expect(mockDecreaseSeats).toHaveBeenCalledWith('acc-123');
    });
  });

  describe('updateMemberRole', () => {
    it('should update member role successfully', async () => {
      const service = createAccountMembersService(mockClient as any);

      mockClient.rpc.mockResolvedValue({
        data: true,
        error: null,
      });

      mockAdminClient.from.mockReturnValue({
        update: vi.fn().mockReturnThis(),
        match: vi.fn(
          (): Promise<QueryResult> =>
            Promise.resolve({ data: null, error: null }),
        ),
      } as any);

      await service.updateMemberRole(
        {
          accountId: 'acc-123',
          userId: 'user-456',
          role: 'admin',
        },
        mockAdminClient as any,
      );

      expect(mockClient.rpc).toHaveBeenCalledWith('can_action_account_member', {
        target_user_id: 'user-456',
        target_team_account_id: 'acc-123',
      });
      expect(mockAdminClient.from).toHaveBeenCalledWith('accounts_memberships');
    });

    it('should throw error when permission check fails', async () => {
      const service = createAccountMembersService(mockClient as any);

      mockClient.rpc.mockResolvedValue({
        data: false,
        error: null,
      });

      await expect(
        service.updateMemberRole(
          {
            accountId: 'acc-123',
            userId: 'user-456',
            role: 'admin',
          },
          mockAdminClient as any,
        ),
      ).rejects.toThrow('Failed to validate permissions to update member role');
    });

    it('should throw error when RPC returns error', async () => {
      const service = createAccountMembersService(mockClient as any);
      const rpcError = new Error('RPC failed');

      mockClient.rpc.mockResolvedValue({
        data: null,
        error: rpcError,
      });

      await expect(
        service.updateMemberRole(
          {
            accountId: 'acc-123',
            userId: 'user-456',
            role: 'admin',
          },
          mockAdminClient as any,
        ),
      ).rejects.toThrow('Failed to validate permissions to update member role');
    });

    it('should throw error when update fails', async () => {
      const service = createAccountMembersService(mockClient as any);
      const error = new Error('Update failed');

      mockClient.rpc.mockResolvedValue({
        data: true,
        error: null,
      });

      mockAdminClient.from.mockReturnValue({
        update: vi.fn().mockReturnThis(),
        match: vi.fn(
          (): Promise<QueryResult> => Promise.resolve({ data: null, error }),
        ),
      } as any);

      await expect(
        service.updateMemberRole(
          {
            accountId: 'acc-123',
            userId: 'user-456',
            role: 'admin',
          },
          mockAdminClient as any,
        ),
      ).rejects.toThrow('Update failed');
    });

    it('should update to different roles correctly', async () => {
      const service = createAccountMembersService(mockClient as any);

      mockClient.rpc.mockResolvedValue({
        data: true,
        error: null,
      });

      let capturedRole: string | undefined;

      mockAdminClient.from.mockReturnValue({
        update: vi.fn((data: any) => {
          capturedRole = data.account_role;
          return {
            match: vi.fn(
              (): Promise<QueryResult> =>
                Promise.resolve({ data: null, error: null }),
            ),
          };
        }),
      } as any);

      await service.updateMemberRole(
        {
          accountId: 'acc-123',
          userId: 'user-456',
          role: 'member',
        },
        mockAdminClient as any,
      );

      expect(capturedRole).toBe('member');
    });

    it('should use admin client for the update', async () => {
      const service = createAccountMembersService(mockClient as any);

      mockClient.rpc.mockResolvedValue({
        data: true,
        error: null,
      });

      mockAdminClient.from.mockReturnValue({
        update: vi.fn().mockReturnThis(),
        match: vi.fn(
          (): Promise<QueryResult> =>
            Promise.resolve({ data: null, error: null }),
        ),
      } as any);

      await service.updateMemberRole(
        {
          accountId: 'acc-123',
          userId: 'user-456',
          role: 'owner',
        },
        mockAdminClient as any,
      );

      // Should use admin client, not regular client
      expect(mockAdminClient.from).toHaveBeenCalled();
    });
  });

  describe('transferOwnership', () => {
    it('should transfer ownership successfully', async () => {
      const service = createAccountMembersService(mockClient as any);

      mockAdminClient.rpc.mockResolvedValue({
        data: { success: true },
        error: null,
      });

      const result = await service.transferOwnership(
        {
          accountId: 'acc-123',
          userId: 'user-789',
          otp: 'test-otp',
        },
        mockAdminClient as any,
      );

      expect(mockAdminClient.rpc).toHaveBeenCalledWith(
        'transfer_team_account_ownership',
        {
          target_account_id: 'acc-123',
          new_owner_id: 'user-789',
        },
      );
      expect(result).toEqual({ success: true });
    });

    it('should throw error when transfer fails', async () => {
      const service = createAccountMembersService(mockClient as any);
      const error = new Error('Transfer failed');

      mockAdminClient.rpc.mockResolvedValue({
        data: null,
        error,
      });

      await expect(
        service.transferOwnership(
          {
            accountId: 'acc-123',
            userId: 'user-789',
            otp: 'test-otp',
          },
          mockAdminClient as any,
        ),
      ).rejects.toThrow('Transfer failed');
    });

    it('should use admin client for transfer', async () => {
      const service = createAccountMembersService(mockClient as any);

      mockAdminClient.rpc.mockResolvedValue({
        data: { success: true },
        error: null,
      });

      await service.transferOwnership(
        {
          accountId: 'acc-123',
          userId: 'user-789',
          otp: 'test-otp',
        },
        mockAdminClient as any,
      );

      // Should use admin client RPC
      expect(mockAdminClient.rpc).toHaveBeenCalled();
    });
  });
});
