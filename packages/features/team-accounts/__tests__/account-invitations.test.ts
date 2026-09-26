import type { SupabaseClient } from '@supabase/supabase-js';

import { addDays, formatISO } from 'date-fns';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createAccountInvitationsService } from '../src/server/services/account-invitations.service';

// Mock dependencies
vi.mock('@kit/shared/logger', () => ({
  getLogger: vi.fn(async () => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  })),
}));

// Valid UUIDs for testing
const ACCOUNT_SLUG = 'test-account';
const INVITATION_ID = 1;
const USER_ID = '550e8400-e29b-41d4-a716-446655440000';
const INVITE_TOKEN = 'test-token-12345';

// Mock Supabase client
const mockFrom = vi.fn();
const mockDelete = vi.fn();
const mockUpdate = vi.fn();
const mockSelect = vi.fn();
const mockEq = vi.fn();
const mockMatch = vi.fn();
const mockSingle = vi.fn();
const mockRpc = vi.fn();

const mockSupabaseClient = {
  from: mockFrom,
  rpc: mockRpc,
} as unknown as SupabaseClient;

const mockAdminClient = {
  rpc: mockRpc,
} as unknown as SupabaseClient;

describe('AccountInvitationsService', () => {
  let service: ReturnType<typeof createAccountInvitationsService>;

  beforeEach(() => {
    vi.clearAllMocks();
    service = createAccountInvitationsService(mockSupabaseClient);
  });

  describe('deleteInvitation', () => {
    beforeEach(() => {
      mockFrom.mockReturnValue({
        delete: mockDelete,
      });

      // The delete ends in .select() (KB-61); mockMatch still sees the filter
      mockDelete.mockReturnValue({
        match: (filter: unknown) => ({ select: () => mockMatch(filter) }),
      });
    });

    it('should delete invitation successfully', async () => {
      mockMatch.mockResolvedValue({
        data: [{ id: INVITATION_ID }],
        error: null,
      });

      const result = await service.deleteInvitation({
        invitationId: INVITATION_ID,
      });

      expect(mockFrom).toHaveBeenCalledWith('invitations');
      expect(mockMatch).toHaveBeenCalledWith({ id: INVITATION_ID });
      expect(result).toEqual([{ id: INVITATION_ID }]);
    });

    it('should throw error when deletion fails', async () => {
      mockMatch.mockResolvedValue({
        data: null,
        error: { message: 'Database error' },
      });

      await expect(
        service.deleteInvitation({ invitationId: INVITATION_ID }),
      ).rejects.toThrow();
    });

    it('should handle non-existent invitation', async () => {
      mockMatch.mockResolvedValue({
        data: null,
        error: { code: 'PGRST116', message: 'Not found' },
      });

      await expect(
        service.deleteInvitation({ invitationId: 999 }),
      ).rejects.toThrow();
    });
  });

  describe('updateInvitation', () => {
    beforeEach(() => {
      mockFrom.mockReturnValue({
        update: mockUpdate,
      });

      mockUpdate.mockReturnValue({
        match: (filter: unknown) => ({ select: () => mockMatch(filter) }),
      });
    });

    it('should update invitation role successfully', async () => {
      mockMatch.mockResolvedValue({
        data: [{ id: INVITATION_ID, role: 'admin' }],
        error: null,
      });

      const result = await service.updateInvitation({
        invitationId: INVITATION_ID,
        role: 'admin',
      });

      expect(mockFrom).toHaveBeenCalledWith('invitations');
      expect(mockUpdate).toHaveBeenCalledWith({ role: 'admin' });
      expect(result).toEqual([{ id: INVITATION_ID, role: 'admin' }]);
    });

    it('should update to different roles', async () => {
      const roles = ['owner', 'admin', 'member'] as const;

      for (const role of roles) {
        vi.clearAllMocks();

        mockFrom.mockReturnValue({
          update: mockUpdate.mockReturnValue({
            match:
              (mockMatch.mockResolvedValue({
                data: [{ id: INVITATION_ID, role }],
                error: null,
              }),
              (filter: unknown) => ({ select: () => mockMatch(filter) })),
          }),
        });

        const result = await service.updateInvitation({
          invitationId: INVITATION_ID,
          role,
        });

        expect(result).toEqual([{ id: INVITATION_ID, role }]);
      }
    });

    it('should throw error when update fails', async () => {
      mockMatch.mockResolvedValue({
        data: null,
        error: { message: 'Update failed' },
      });

      await expect(
        service.updateInvitation({
          invitationId: INVITATION_ID,
          role: 'member',
        }),
      ).rejects.toThrow();
    });
  });

  describe('validateInvitation', () => {
    it('should pass when user is not already a member', async () => {
      const mockMembers = [
        { email: 'existing@example.com', user_id: 'user-1' },
        { email: 'another@example.com', user_id: 'user-2' },
      ];

      mockRpc.mockResolvedValue({
        data: mockMembers,
        error: null,
      });

      const invitation = {
        email: 'newuser@example.com',
        role: 'member' as const,
      };

      await expect(
        service.validateInvitation(invitation, ACCOUNT_SLUG),
      ).resolves.toBeUndefined();

      expect(mockRpc).toHaveBeenCalledWith('get_account_members', {
        account_slug: ACCOUNT_SLUG,
      });
    });

    it('should throw error when user is already a member', async () => {
      const mockMembers = [
        { email: 'existing@example.com', user_id: 'user-1' },
        { email: 'duplicate@example.com', user_id: 'user-2' },
      ];

      mockRpc.mockResolvedValue({
        data: mockMembers,
        error: null,
      });

      const invitation = {
        email: 'duplicate@example.com',
        role: 'member' as const,
      };

      await expect(
        service.validateInvitation(invitation, ACCOUNT_SLUG),
      ).rejects.toThrow('User already member of the team');
    });

    it('should throw error when RPC fails', async () => {
      mockRpc.mockResolvedValue({
        data: null,
        error: { message: 'RPC failed' },
      });

      const invitation = {
        email: 'test@example.com',
        role: 'member' as const,
      };

      await expect(
        service.validateInvitation(invitation, ACCOUNT_SLUG),
      ).rejects.toThrow();
    });

    it('should be case-sensitive for email matching', async () => {
      const mockMembers = [{ email: 'User@Example.com', user_id: 'user-1' }];

      mockRpc.mockResolvedValue({
        data: mockMembers,
        error: null,
      });

      const invitation = {
        email: 'user@example.com', // Different case
        role: 'member' as const,
      };

      // Should pass because emails don't match exactly
      await expect(
        service.validateInvitation(invitation, ACCOUNT_SLUG),
      ).resolves.toBeUndefined();
    });
  });

  describe('sendInvitations', () => {
    beforeEach(() => {
      // Mock get_account_members RPC
      mockRpc.mockImplementation((fn: string) => {
        if (fn === 'get_account_members') {
          return Promise.resolve({
            data: [],
            error: null,
          });
        }
        if (fn === 'add_invitations_to_account') {
          return Promise.resolve({
            data: [{ id: 1 }, { id: 2 }],
            error: null,
          });
        }
        return Promise.resolve({ data: null, error: null });
      });

      // Mock accounts query
      mockFrom.mockReturnValue({
        select: mockSelect.mockReturnValue({
          eq: mockEq.mockReturnValue({
            single: mockSingle.mockResolvedValue({
              data: { name: 'Test Account' },
              error: null,
            }),
          }),
        }),
      });
    });

    it('should send invitations successfully', async () => {
      const invitations = [
        { email: 'user1@example.com', role: 'member' as const },
        { email: 'user2@example.com', role: 'admin' as const },
      ];

      await service.sendInvitations({
        accountSlug: ACCOUNT_SLUG,
        invitations,
      });

      expect(mockRpc).toHaveBeenCalledWith('get_account_members', {
        account_slug: ACCOUNT_SLUG,
      });
      expect(mockRpc).toHaveBeenCalledWith('add_invitations_to_account', {
        invitations,
        account_slug: ACCOUNT_SLUG,
      });
    });

    it('should validate all invitations before sending', async () => {
      const invitations = [
        { email: 'user1@example.com', role: 'member' as const },
        { email: 'user2@example.com', role: 'admin' as const },
      ];

      await service.sendInvitations({
        accountSlug: ACCOUNT_SLUG,
        invitations,
      });

      // Should call get_account_members for each validation
      expect(mockRpc).toHaveBeenCalledWith('get_account_members', {
        account_slug: ACCOUNT_SLUG,
      });
    });

    it('should throw error when validation fails', async () => {
      mockRpc.mockImplementation((fn: string) => {
        if (fn === 'get_account_members') {
          return Promise.resolve({
            data: [{ email: 'existing@example.com', user_id: 'user-1' }],
            error: null,
          });
        }
        return Promise.resolve({ data: null, error: null });
      });

      const invitations = [
        { email: 'existing@example.com', role: 'member' as const },
      ];

      await expect(
        service.sendInvitations({
          accountSlug: ACCOUNT_SLUG,
          invitations,
        }),
      ).rejects.toThrow('User already member of the team');
    });

    it('should throw error when account not found', async () => {
      mockSingle.mockResolvedValue({
        data: null,
        error: null,
      });

      const invitations = [
        { email: 'user1@example.com', role: 'member' as const },
      ];

      await expect(
        service.sendInvitations({
          accountSlug: 'non-existent',
          invitations,
        }),
      ).rejects.toThrow('Account not found');
    });

    it('should throw error when RPC fails', async () => {
      mockRpc.mockImplementation((fn: string) => {
        if (fn === 'get_account_members') {
          return Promise.resolve({ data: [], error: null });
        }
        if (fn === 'add_invitations_to_account') {
          return Promise.resolve({
            data: null,
            error: { message: 'RPC failed' },
          });
        }
        return Promise.resolve({ data: null, error: null });
      });

      const invitations = [
        { email: 'user1@example.com', role: 'member' as const },
      ];

      await expect(
        service.sendInvitations({
          accountSlug: ACCOUNT_SLUG,
          invitations,
        }),
      ).rejects.toThrow();
    });

    it('should handle single invitation response', async () => {
      mockRpc.mockImplementation((fn: string) => {
        if (fn === 'get_account_members') {
          return Promise.resolve({ data: [], error: null });
        }
        if (fn === 'add_invitations_to_account') {
          return Promise.resolve({
            data: { id: 1 }, // Single object, not array
            error: null,
          });
        }
        return Promise.resolve({ data: null, error: null });
      });

      const invitations = [
        { email: 'user1@example.com', role: 'member' as const },
      ];

      await expect(
        service.sendInvitations({
          accountSlug: ACCOUNT_SLUG,
          invitations,
        }),
      ).resolves.toBeUndefined();
    });

    it('should handle multiple invitations with different roles', async () => {
      const invitations = [
        { email: 'owner@example.com', role: 'owner' as const },
        { email: 'admin@example.com', role: 'admin' as const },
        { email: 'member@example.com', role: 'member' as const },
      ];

      await service.sendInvitations({
        accountSlug: ACCOUNT_SLUG,
        invitations,
      });

      expect(mockRpc).toHaveBeenCalledWith('add_invitations_to_account', {
        invitations,
        account_slug: ACCOUNT_SLUG,
      });
    });
  });

  describe('acceptInvitationToTeam', () => {
    it('should accept invitation successfully', async () => {
      mockRpc.mockResolvedValue({
        data: { success: true },
        error: null,
      });

      const result = await service.acceptInvitationToTeam(mockAdminClient, {
        userId: USER_ID,
        inviteToken: INVITE_TOKEN,
      });

      expect(mockRpc).toHaveBeenCalledWith('accept_invitation', {
        token: INVITE_TOKEN,
        user_id: USER_ID,
      });
      expect(result).toEqual({ success: true });
    });

    it('should throw error when RPC fails', async () => {
      mockRpc.mockResolvedValue({
        data: null,
        error: { message: 'Invalid token' },
      });

      await expect(
        service.acceptInvitationToTeam(mockAdminClient, {
          userId: USER_ID,
          inviteToken: 'invalid-token',
        }),
      ).rejects.toThrow();
    });

    it('should handle expired invitation', async () => {
      mockRpc.mockResolvedValue({
        data: null,
        error: { message: 'Invitation expired' },
      });

      await expect(
        service.acceptInvitationToTeam(mockAdminClient, {
          userId: USER_ID,
          inviteToken: INVITE_TOKEN,
        }),
      ).rejects.toThrow();
    });

    it('should handle already accepted invitation', async () => {
      mockRpc.mockResolvedValue({
        data: null,
        error: { message: 'Invitation already accepted' },
      });

      await expect(
        service.acceptInvitationToTeam(mockAdminClient, {
          userId: USER_ID,
          inviteToken: INVITE_TOKEN,
        }),
      ).rejects.toThrow();
    });
  });

  describe('renewInvitation', () => {
    beforeEach(() => {
      mockFrom.mockReturnValue({
        update: mockUpdate,
      });

      mockUpdate.mockReturnValue({
        match: (filter: unknown) => ({ select: () => mockMatch(filter) }),
      });
    });

    it('should renew invitation with 7 days extension', async () => {
      const sevenDaysFromNow = formatISO(addDays(new Date(), 7));

      mockMatch.mockResolvedValue({
        data: [{ id: INVITATION_ID, expires_at: sevenDaysFromNow }],
        error: null,
      });

      const result = await service.renewInvitation(INVITATION_ID);

      expect(mockFrom).toHaveBeenCalledWith('invitations');
      expect(mockUpdate).toHaveBeenCalledWith({
        expires_at: expect.any(String),
      });
      expect(result).toBeDefined();
    });

    it('should throw error when renewal fails', async () => {
      mockMatch.mockResolvedValue({
        data: null,
        error: { message: 'Update failed' },
      });

      await expect(service.renewInvitation(INVITATION_ID)).rejects.toThrow();
    });

    it('should handle non-existent invitation', async () => {
      mockMatch.mockResolvedValue({
        data: null,
        error: { code: 'PGRST116', message: 'Not found' },
      });

      await expect(service.renewInvitation(999)).rejects.toThrow();
    });

    it('should set expiration exactly 7 days from now', async () => {
      const beforeCall = new Date();

      mockMatch.mockImplementation((params) => {
        return Promise.resolve({
          data: [{ id: params.id }],
          error: null,
        });
      });

      await service.renewInvitation(INVITATION_ID);

      const afterCall = new Date();

      expect(mockUpdate).toHaveBeenCalledWith({
        expires_at: expect.any(String),
      });

      // Verify the date is within a reasonable range (accounting for test execution time)
      const updateCall = mockUpdate.mock.calls[0]![0] as {
        expires_at: string;
      };
      const expiresAt = new Date(updateCall.expires_at);
      const sevenDaysFromBefore = addDays(beforeCall, 7);
      const sevenDaysFromAfter = addDays(afterCall, 7);

      expect(expiresAt.getTime()).toBeGreaterThanOrEqual(
        sevenDaysFromBefore.getTime() - 1000,
      ); // Allow 1s tolerance
      expect(expiresAt.getTime()).toBeLessThanOrEqual(
        sevenDaysFromAfter.getTime() + 1000,
      );
    });
  });

  describe('Integration scenarios', () => {
    it('should handle full invitation lifecycle', async () => {
      // Setup mocks
      mockRpc.mockImplementation((fn: string) => {
        if (fn === 'get_account_members') {
          return Promise.resolve({ data: [], error: null });
        }
        if (fn === 'add_invitations_to_account') {
          return Promise.resolve({ data: [{ id: 1 }], error: null });
        }
        if (fn === 'accept_invitation') {
          return Promise.resolve({ data: { success: true }, error: null });
        }
        return Promise.resolve({ data: null, error: null });
      });

      mockFrom.mockReturnValue({
        select: mockSelect.mockReturnValue({
          eq: mockEq.mockReturnValue({
            single: mockSingle.mockResolvedValue({
              data: { name: 'Test Account' },
              error: null,
            }),
          }),
        }),
        update: mockUpdate.mockReturnValue({
          match:
            (mockMatch.mockResolvedValue({ data: [{ id: 1 }], error: null }),
            (filter: unknown) => ({ select: () => mockMatch(filter) })),
        }),
        delete: mockDelete.mockReturnValue({
          match: () => ({
            select: () => Promise.resolve({ data: [{ id: 1 }], error: null }),
          }),
        }),
      });

      // 1. Send invitation
      await service.sendInvitations({
        accountSlug: ACCOUNT_SLUG,
        invitations: [{ email: 'user@example.com', role: 'member' }],
      });

      // 2. Update invitation role
      await service.updateInvitation({
        invitationId: 1,
        role: 'admin',
      });

      // 3. Renew invitation
      await service.renewInvitation(1);

      // 4. Accept invitation
      await service.acceptInvitationToTeam(mockAdminClient, {
        userId: USER_ID,
        inviteToken: INVITE_TOKEN,
      });

      expect(mockRpc).toHaveBeenCalledTimes(3); // get_members, add, accept
      expect(mockUpdate).toHaveBeenCalledTimes(2); // update role, renew
    });

    it('should handle concurrent invitation operations', async () => {
      mockFrom.mockReturnValue({
        update: mockUpdate.mockReturnValue({
          match:
            (mockMatch.mockResolvedValue({
              data: [{ id: INVITATION_ID }],
              error: null,
            }),
            (filter: unknown) => ({ select: () => mockMatch(filter) })),
        }),
      });

      // Update and renew concurrently
      await Promise.all([
        service.updateInvitation({
          invitationId: INVITATION_ID,
          role: 'admin',
        }),
        service.renewInvitation(INVITATION_ID),
      ]);

      expect(mockUpdate).toHaveBeenCalledTimes(2);
    });
  });
});
