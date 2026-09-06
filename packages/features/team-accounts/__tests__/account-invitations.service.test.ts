import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createAccountInvitationsService } from '../src/server/services/account-invitations.service';

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

// Create mock Supabase client
/**
 * These mocks resolve to `{ data, error }` where either side can be null.
 * Inferring the type from a happy-path default pins `data` to one shape and
 * `error` to `null`, making every failure case in the file a type error.
 */
interface QueryResult {
  data: unknown;
  error: unknown;
}

const createMockClient = () => ({
  from: vi.fn(() => ({
    delete: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    match: vi.fn(
      (): Promise<QueryResult> => Promise.resolve({ data: null, error: null }),
    ),
    single: vi.fn(
      (): Promise<QueryResult> =>
        Promise.resolve({
          data: { name: 'Test Account' },
          error: null,
        }),
    ),
  })),
  rpc: vi.fn(
    (): Promise<QueryResult> => Promise.resolve({ data: [], error: null }),
  ),
});

describe('AccountInvitationsService', () => {
  let mockClient: ReturnType<typeof createMockClient>;

  beforeEach(() => {
    mockClient = createMockClient();
    vi.clearAllMocks();
  });

  describe('deleteInvitation', () => {
    it('should delete invitation successfully', async () => {
      const service = createAccountInvitationsService(mockClient as any);

      mockClient.from.mockReturnValue({
        delete: vi.fn().mockReturnThis(),
        match: vi.fn(
          (): Promise<QueryResult> =>
            Promise.resolve({ data: null, error: null }),
        ),
      } as any);

      await service.deleteInvitation({ invitationId: 123 });

      expect(mockClient.from).toHaveBeenCalledWith('invitations');
    });

    it('should throw error when deletion fails', async () => {
      const service = createAccountInvitationsService(mockClient as any);
      const error = new Error('Database error');

      mockClient.from.mockReturnValue({
        delete: vi.fn().mockReturnThis(),
        match: vi.fn(
          (): Promise<QueryResult> => Promise.resolve({ data: null, error }),
        ),
      } as any);

      await expect(
        service.deleteInvitation({ invitationId: 123 }),
      ).rejects.toThrow('Database error');
    });
  });

  describe('updateInvitation', () => {
    it('should update invitation role successfully', async () => {
      const service = createAccountInvitationsService(mockClient as any);

      mockClient.from.mockReturnValue({
        update: vi.fn().mockReturnThis(),
        match: vi.fn(
          (): Promise<QueryResult> =>
            Promise.resolve({ data: null, error: null }),
        ),
      } as any);

      await service.updateInvitation({
        invitationId: 123,
        role: 'admin',
      });

      expect(mockClient.from).toHaveBeenCalledWith('invitations');
    });

    it('should throw error when update fails', async () => {
      const service = createAccountInvitationsService(mockClient as any);
      const error = new Error('Update failed');

      mockClient.from.mockReturnValue({
        update: vi.fn().mockReturnThis(),
        match: vi.fn(
          (): Promise<QueryResult> => Promise.resolve({ data: null, error }),
        ),
      } as any);

      await expect(
        service.updateInvitation({
          invitationId: 123,
          role: 'admin',
        }),
      ).rejects.toThrow('Update failed');
    });
  });

  describe('validateInvitation', () => {
    it('should validate invitation when user is not a member', async () => {
      const service = createAccountInvitationsService(mockClient as any);

      mockClient.rpc.mockResolvedValue({
        data: [
          { email: 'existing@example.com', role: 'member' },
          { email: 'another@example.com', role: 'admin' },
        ],
        error: null,
      });

      await expect(
        service.validateInvitation(
          { email: 'new@example.com', role: 'member' },
          'test-account',
        ),
      ).resolves.not.toThrow();
    });

    it('should throw error when user is already a member', async () => {
      const service = createAccountInvitationsService(mockClient as any);

      mockClient.rpc.mockResolvedValue({
        data: [
          { email: 'existing@example.com', role: 'member' },
          { email: 'another@example.com', role: 'admin' },
        ],
        error: null,
      });

      await expect(
        service.validateInvitation(
          { email: 'existing@example.com', role: 'member' },
          'test-account',
        ),
      ).rejects.toThrow('User already member of the team');
    });

    it('should throw error when RPC call fails', async () => {
      const service = createAccountInvitationsService(mockClient as any);
      const error = new Error('RPC failed');

      mockClient.rpc.mockResolvedValue({
        data: null,
        error,
      });

      await expect(
        service.validateInvitation(
          { email: 'test@example.com', role: 'member' },
          'test-account',
        ),
      ).rejects.toThrow('RPC failed');
    });
  });

  describe('sendInvitations', () => {
    it('should send invitations successfully', async () => {
      const service = createAccountInvitationsService(mockClient as any);

      mockClient.rpc
        .mockResolvedValueOnce({
          data: [],
          error: null,
        })
        .mockResolvedValueOnce({
          data: [{ id: 1 }, { id: 2 }],
          error: null,
        });

      mockClient.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn(
          (): Promise<QueryResult> =>
            Promise.resolve({
              data: { name: 'Test Account' },
              error: null,
            }),
        ),
      } as any);

      await service.sendInvitations({
        accountSlug: 'test-account',
        invitations: [
          { email: 'user1@example.com', role: 'member' },
          { email: 'user2@example.com', role: 'admin' },
        ],
      });

      expect(mockClient.rpc).toHaveBeenCalledWith('get_account_members', {
        account_slug: 'test-account',
      });
      expect(mockClient.rpc).toHaveBeenCalledWith(
        'add_invitations_to_account',
        {
          invitations: [
            { email: 'user1@example.com', role: 'member' },
            { email: 'user2@example.com', role: 'admin' },
          ],
          account_slug: 'test-account',
        },
      );
    });

    it('should throw error when validation fails', async () => {
      const service = createAccountInvitationsService(mockClient as any);

      mockClient.rpc.mockResolvedValue({
        data: [{ email: 'existing@example.com', role: 'member' }],
        error: null,
      });

      await expect(
        service.sendInvitations({
          accountSlug: 'test-account',
          invitations: [
            { email: 'existing@example.com', role: 'member' }, // Already a member
          ],
        }),
      ).rejects.toThrow('User already member of the team');
    });

    it('should throw error when account not found', async () => {
      const service = createAccountInvitationsService(mockClient as any);

      mockClient.rpc.mockResolvedValue({
        data: [],
        error: null,
      });

      mockClient.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn(
          (): Promise<QueryResult> =>
            Promise.resolve({
              data: null,
              error: null,
            }),
        ),
      } as any);

      await expect(
        service.sendInvitations({
          accountSlug: 'nonexistent',
          invitations: [{ email: 'test@example.com', role: 'member' }],
        }),
      ).rejects.toThrow('Account not found');
    });

    it('should throw error when RPC fails', async () => {
      const service = createAccountInvitationsService(mockClient as any);
      const error = new Error('RPC failed');

      mockClient.rpc
        .mockResolvedValueOnce({
          data: [],
          error: null,
        })
        .mockResolvedValueOnce({
          data: null,
          error,
        });

      mockClient.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn(
          (): Promise<QueryResult> =>
            Promise.resolve({
              data: { name: 'Test Account' },
              error: null,
            }),
        ),
      } as any);

      await expect(
        service.sendInvitations({
          accountSlug: 'test-account',
          invitations: [{ email: 'test@example.com', role: 'member' }],
        }),
      ).rejects.toThrow('RPC failed');
    });
  });

  describe('acceptInvitationToTeam', () => {
    it('should accept invitation successfully', async () => {
      const service = createAccountInvitationsService(mockClient as any);
      const mockAdminClient = createMockClient();

      mockAdminClient.rpc.mockResolvedValue({
        data: { success: true },
        error: null,
      });

      const result = await service.acceptInvitationToTeam(
        mockAdminClient as any,
        {
          userId: 'user-123',
          inviteToken: 'token-456',
        },
      );

      expect(mockAdminClient.rpc).toHaveBeenCalledWith('accept_invitation', {
        token: 'token-456',
        user_id: 'user-123',
      });
      expect(result).toEqual({ success: true });
    });

    it('should throw error when acceptance fails', async () => {
      const service = createAccountInvitationsService(mockClient as any);
      const mockAdminClient = createMockClient();
      const error = new Error('Invalid token');

      mockAdminClient.rpc.mockResolvedValue({
        data: null,
        error,
      });

      await expect(
        service.acceptInvitationToTeam(mockAdminClient as any, {
          userId: 'user-123',
          inviteToken: 'invalid-token',
        }),
      ).rejects.toThrow('Invalid token');
    });
  });

  describe('renewInvitation', () => {
    it('should renew invitation by extending expiration', async () => {
      const service = createAccountInvitationsService(mockClient as any);

      mockClient.from.mockReturnValue({
        update: vi.fn().mockReturnThis(),
        match: vi.fn(
          (): Promise<QueryResult> =>
            Promise.resolve({ data: null, error: null }),
        ),
      } as any);

      await service.renewInvitation(123);

      expect(mockClient.from).toHaveBeenCalledWith('invitations');
    });

    it('should throw error when renewal fails', async () => {
      const service = createAccountInvitationsService(mockClient as any);
      const error = new Error('Renewal failed');

      mockClient.from.mockReturnValue({
        update: vi.fn().mockReturnThis(),
        match: vi.fn(
          (): Promise<QueryResult> => Promise.resolve({ data: null, error }),
        ),
      } as any);

      await expect(service.renewInvitation(123)).rejects.toThrow(
        'Renewal failed',
      );
    });

    it('should set expiration to 7 days from now', async () => {
      const service = createAccountInvitationsService(mockClient as any);
      let capturedExpiresAt: string | undefined;

      mockClient.from.mockReturnValue({
        update: vi.fn((data: any) => {
          capturedExpiresAt = data.expires_at;
          return {
            match: vi.fn(
              (): Promise<QueryResult> =>
                Promise.resolve({ data: null, error: null }),
            ),
          };
        }),
      } as any);

      await service.renewInvitation(123);

      expect(capturedExpiresAt).toBeDefined();

      // Verify it's approximately 7 days from now (within 1 minute tolerance)
      const expirationDate = new Date(capturedExpiresAt!);
      const sevenDaysFromNow = new Date();
      sevenDaysFromNow.setDate(sevenDaysFromNow.getDate() + 7);

      const differenceInMinutes =
        Math.abs(expirationDate.getTime() - sevenDaysFromNow.getTime()) /
        (1000 * 60);

      expect(differenceInMinutes).toBeLessThan(1);
    });
  });
});
