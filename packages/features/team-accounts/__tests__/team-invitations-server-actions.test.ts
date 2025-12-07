import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  acceptInvitationAction,
  createInvitationsAction,
  deleteInvitationAction,
  renewInvitationAction,
  updateInvitationAction,
} from '../src/server/actions/team-invitations-server-actions';

// Mock Next.js functions - must be defined before import
vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT;${url}`);
  }),
}));

// Mock enhanceAction to apply schema validation but bypass auth
vi.mock('@kit/next/actions', () => ({
  enhanceAction: (handler: Function, options?: any) => {
    return async (...args: any[]) => {
      // Apply schema validation if provided
      if (options?.schema) {
        const dataToValidate = args[0];
        options.schema.parse(dataToValidate);
      }
      // Call handler with all args
      return handler(...args);
    };
  },
}));

const mockRevalidatePath = vi.mocked(revalidatePath);
const mockRedirect = vi.mocked(redirect);

// Mock Supabase clients
const mockClient = {
  from: vi.fn(() => ({
    select: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    delete: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    single: vi.fn(() => Promise.resolve({ data: null, error: null })),
  })),
};

const mockAdminClient = {
  from: vi.fn(() => ({
    select: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    delete: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    single: vi.fn(() => Promise.resolve({ data: null, error: null })),
  })),
};

vi.mock('@kit/supabase/server-client', () => ({
  getSupabaseServerClient: vi.fn(() => mockClient),
}));

vi.mock('@kit/supabase/server-admin-client', () => ({
  getSupabaseServerAdminClient: vi.fn(() => mockAdminClient),
}));

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

// Mock account invitations service
const mockSendInvitations = vi.fn(() => Promise.resolve());
const mockDeleteInvitation = vi.fn(() => Promise.resolve());
const mockUpdateInvitation = vi.fn(() => Promise.resolve());
const mockAcceptInvitationToTeam = vi.fn(() =>
  Promise.resolve('123e4567-e89b-12d3-a456-426614174000'),
);
const mockRenewInvitation = vi.fn(() => Promise.resolve());

vi.mock('../src/server/services/account-invitations.service', () => ({
  createAccountInvitationsService: vi.fn(() => ({
    sendInvitations: mockSendInvitations,
    deleteInvitation: mockDeleteInvitation,
    updateInvitation: mockUpdateInvitation,
    acceptInvitationToTeam: mockAcceptInvitationToTeam,
    renewInvitation: mockRenewInvitation,
  })),
}));

// Mock per-seat billing service
const mockIncreaseSeats = vi.fn(() => Promise.resolve());

vi.mock('../src/server/services/account-per-seat-billing.service', () => ({
  createAccountPerSeatBillingService: vi.fn(() => ({
    increaseSeats: mockIncreaseSeats,
  })),
}));

describe('team-invitations-server-actions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('createInvitationsAction', () => {
    describe('successful invitation creation', () => {
      it('should create invitations with valid data', async () => {
        const params = {
          accountSlug: 'test-team',
          invitations: [
            { email: 'user1@example.com', role: 'member' },
            { email: 'user2@example.com', role: 'admin' },
          ],
        };

        const result = await createInvitationsAction(params);

        expect(result).toEqual({ success: true });
        expect(mockSendInvitations).toHaveBeenCalledWith(params);
      });

      it('should revalidate member page after creation', async () => {
        const params = {
          accountSlug: 'test-team',
          invitations: [{ email: 'user@example.com', role: 'member' }],
        };

        await createInvitationsAction(params);

        expect(mockRevalidatePath).toHaveBeenCalledWith(
          '/home/[account]/members',
          'page',
        );
      });

      it('should handle single invitation', async () => {
        const params = {
          accountSlug: 'my-team',
          invitations: [{ email: 'single@example.com', role: 'viewer' }],
        };

        const result = await createInvitationsAction(params);

        expect(result.success).toBe(true);
        expect(mockSendInvitations).toHaveBeenCalledTimes(1);
      });

      it('should handle maximum invitations (5)', async () => {
        const params = {
          accountSlug: 'large-team',
          invitations: [
            { email: 'user1@example.com', role: 'member' },
            { email: 'user2@example.com', role: 'member' },
            { email: 'user3@example.com', role: 'member' },
            { email: 'user4@example.com', role: 'member' },
            { email: 'user5@example.com', role: 'member' },
          ],
        };

        const result = await createInvitationsAction(params);

        expect(result.success).toBe(true);
        expect(mockSendInvitations).toHaveBeenCalledWith(params);
      });
    });

    describe('schema validation', () => {
      it('should reject empty invitations array', async () => {
        const params = {
          accountSlug: 'test-team',
          invitations: [],
        };

        await expect(createInvitationsAction(params)).rejects.toThrow();
      });

      it('should reject more than 5 invitations', async () => {
        const params = {
          accountSlug: 'test-team',
          invitations: [
            { email: 'user1@example.com', role: 'member' },
            { email: 'user2@example.com', role: 'member' },
            { email: 'user3@example.com', role: 'member' },
            { email: 'user4@example.com', role: 'member' },
            { email: 'user5@example.com', role: 'member' },
            { email: 'user6@example.com', role: 'member' },
          ],
        };

        await expect(createInvitationsAction(params)).rejects.toThrow();
      });

      it('should reject duplicate emails', async () => {
        const params = {
          accountSlug: 'test-team',
          invitations: [
            { email: 'user@example.com', role: 'member' },
            { email: 'user@example.com', role: 'admin' },
          ],
        };

        await expect(createInvitationsAction(params)).rejects.toThrow(
          'Duplicate emails are not allowed',
        );
      });

      it('should reject invalid email format', async () => {
        const params = {
          accountSlug: 'test-team',
          invitations: [{ email: 'invalid-email', role: 'member' }],
        };

        await expect(createInvitationsAction(params)).rejects.toThrow();
      });

      it('should reject empty role', async () => {
        const params = {
          accountSlug: 'test-team',
          invitations: [{ email: 'user@example.com', role: '' }],
        };

        await expect(createInvitationsAction(params)).rejects.toThrow();
      });

      it('should reject missing accountSlug', async () => {
        const params = {
          invitations: [{ email: 'user@example.com', role: 'member' }],
        };

        await expect(createInvitationsAction(params as any)).rejects.toThrow();
      });
    });

    describe('error handling', () => {
      it('should propagate service errors', async () => {
        mockSendInvitations.mockRejectedValueOnce(
          new Error('Email service unavailable'),
        );

        const params = {
          accountSlug: 'test-team',
          invitations: [{ email: 'user@example.com', role: 'member' }],
        };

        await expect(createInvitationsAction(params)).rejects.toThrow(
          'Email service unavailable',
        );
      });
    });
  });

  describe('deleteInvitationAction', () => {
    describe('successful deletion', () => {
      it('should delete invitation with valid ID', async () => {
        const data = { invitationId: 123 };

        const result = await deleteInvitationAction(data);

        expect(result).toEqual({ success: true });
        expect(mockDeleteInvitation).toHaveBeenCalledWith(data);
      });

      it('should revalidate member page after deletion', async () => {
        const data = { invitationId: 456 };

        await deleteInvitationAction(data);

        expect(mockRevalidatePath).toHaveBeenCalledWith(
          '/home/[account]/members',
          'page',
        );
      });
    });

    describe('schema validation', () => {
      it('should reject non-integer invitation ID', async () => {
        const data = { invitationId: 123.45 };

        await expect(deleteInvitationAction(data)).rejects.toThrow();
      });

      it('should reject missing invitation ID', async () => {
        await expect(deleteInvitationAction({} as any)).rejects.toThrow();
      });
    });

    describe('error handling', () => {
      it('should propagate deletion errors', async () => {
        mockDeleteInvitation.mockRejectedValueOnce(
          new Error('Invitation not found'),
        );

        const data = { invitationId: 999 };

        await expect(deleteInvitationAction(data)).rejects.toThrow(
          'Invitation not found',
        );
      });
    });
  });

  describe('updateInvitationAction', () => {
    describe('successful update', () => {
      it('should update invitation with valid data', async () => {
        const data = { invitationId: 123, role: 'admin' };

        const result = await updateInvitationAction(data);

        expect(result).toEqual({ success: true });
        expect(mockUpdateInvitation).toHaveBeenCalledWith(data);
      });

      it('should revalidate member page after update', async () => {
        const data = { invitationId: 456, role: 'member' };

        await updateInvitationAction(data);

        expect(mockRevalidatePath).toHaveBeenCalledWith(
          '/home/[account]/members',
          'page',
        );
      });
    });

    describe('schema validation', () => {
      it('should reject empty role', async () => {
        const data = { invitationId: 123, role: '' };

        await expect(updateInvitationAction(data)).rejects.toThrow();
      });

      it('should reject missing invitation ID', async () => {
        const data = { role: 'admin' };

        await expect(updateInvitationAction(data as any)).rejects.toThrow();
      });

      it('should reject missing role', async () => {
        const data = { invitationId: 123 };

        await expect(updateInvitationAction(data as any)).rejects.toThrow();
      });
    });

    describe('error handling', () => {
      it('should propagate update errors', async () => {
        mockUpdateInvitation.mockRejectedValueOnce(new Error('Invalid role'));

        const data = { invitationId: 123, role: 'invalid-role' };

        await expect(updateInvitationAction(data)).rejects.toThrow(
          'Invalid role',
        );
      });
    });
  });

  describe('acceptInvitationAction', () => {
    describe('successful acceptance', () => {
      it('should accept invitation with valid token', async () => {
        const formData = new FormData();
        formData.append('inviteToken', '123e4567-e89b-12d3-a456-426614174000');
        formData.append('nextPath', '/home/test-team');

        const user = { id: '987fcdeb-51a2-43d7-8f9e-123456789abc' };

        await expect(acceptInvitationAction(formData, user)).rejects.toThrow(
          'NEXT_REDIRECT;/home/test-team',
        );

        expect(mockAcceptInvitationToTeam).toHaveBeenCalledWith(
          mockAdminClient,
          {
            inviteToken: '123e4567-e89b-12d3-a456-426614174000',
            userId: user.id,
          },
        );
      });

      it('should increase seats after accepting invitation', async () => {
        const formData = new FormData();
        formData.append('inviteToken', '223e4567-e89b-12d3-a456-426614174000');
        formData.append('nextPath', '/home/new-team');

        const user = { id: '887fcdeb-51a2-43d7-8f9e-123456789abc' };

        await expect(acceptInvitationAction(formData, user)).rejects.toThrow(
          'NEXT_REDIRECT',
        );

        expect(mockIncreaseSeats).toHaveBeenCalledWith(
          '123e4567-e89b-12d3-a456-426614174000',
        );
      });

      it('should redirect to specified next path', async () => {
        const formData = new FormData();
        formData.append('inviteToken', '323e4567-e89b-12d3-a456-426614174000');
        formData.append('nextPath', '/home/custom-path');

        const user = { id: '787fcdeb-51a2-43d7-8f9e-123456789abc' };

        await expect(acceptInvitationAction(formData, user)).rejects.toThrow(
          'NEXT_REDIRECT;/home/custom-path',
        );

        expect(mockRedirect).toHaveBeenCalledWith('/home/custom-path');
      });

      it('should use admin client for acceptance', async () => {
        const formData = new FormData();
        formData.append('inviteToken', '423e4567-e89b-12d3-a456-426614174000');
        formData.append('nextPath', '/home/team');

        const user = { id: '687fcdeb-51a2-43d7-8f9e-123456789abc' };

        await expect(acceptInvitationAction(formData, user)).rejects.toThrow(
          'NEXT_REDIRECT',
        );

        expect(mockAcceptInvitationToTeam).toHaveBeenCalledWith(
          mockAdminClient,
          expect.any(Object),
        );
      });
    });

    describe('schema validation', () => {
      it('should reject invalid UUID token', async () => {
        const formData = new FormData();
        formData.append('inviteToken', 'invalid-token');
        formData.append('nextPath', '/home/team');

        const user = { id: '587fcdeb-51a2-43d7-8f9e-123456789abc' };

        await expect(acceptInvitationAction(formData, user)).rejects.toThrow();
      });

      it('should reject empty next path', async () => {
        const formData = new FormData();
        formData.append('inviteToken', '523e4567-e89b-12d3-a456-426614174000');
        formData.append('nextPath', '');

        const user = { id: '487fcdeb-51a2-43d7-8f9e-123456789abc' };

        await expect(acceptInvitationAction(formData, user)).rejects.toThrow();
      });

      it('should reject missing invite token', async () => {
        const formData = new FormData();
        formData.append('nextPath', '/home/team');

        const user = { id: '387fcdeb-51a2-43d7-8f9e-123456789abc' };

        await expect(acceptInvitationAction(formData, user)).rejects.toThrow();
      });

      it('should reject missing next path', async () => {
        const formData = new FormData();
        formData.append('inviteToken', '623e4567-e89b-12d3-a456-426614174000');

        const user = { id: '287fcdeb-51a2-43d7-8f9e-123456789abc' };

        await expect(acceptInvitationAction(formData, user)).rejects.toThrow();
      });
    });

    describe('error handling', () => {
      it('should throw error when account ID is not returned', async () => {
        mockAcceptInvitationToTeam.mockResolvedValueOnce(null);

        const formData = new FormData();
        formData.append('inviteToken', '723e4567-e89b-12d3-a456-426614174000');
        formData.append('nextPath', '/home/team');

        const user = { id: '187fcdeb-51a2-43d7-8f9e-123456789abc' };

        await expect(acceptInvitationAction(formData, user)).rejects.toThrow(
          'Failed to accept invitation',
        );
      });

      it('should propagate service errors', async () => {
        mockAcceptInvitationToTeam.mockRejectedValueOnce(
          new Error('Invalid invitation token'),
        );

        const formData = new FormData();
        formData.append('inviteToken', '823e4567-e89b-12d3-a456-426614174000');
        formData.append('nextPath', '/home/team');

        const user = { id: '087fcdeb-51a2-43d7-8f9e-123456789abc' };

        await expect(acceptInvitationAction(formData, user)).rejects.toThrow(
          'Invalid invitation token',
        );
      });

      it('should handle billing service errors', async () => {
        mockIncreaseSeats.mockRejectedValueOnce(
          new Error('Billing service error'),
        );

        const formData = new FormData();
        formData.append('inviteToken', '923e4567-e89b-12d3-a456-426614174000');
        formData.append('nextPath', '/home/team');

        const user = { id: 'f87fcdeb-51a2-43d7-8f9e-123456789abc' };

        await expect(acceptInvitationAction(formData, user)).rejects.toThrow(
          'Billing service error',
        );
      });
    });

    describe('edge cases', () => {
      it('should handle null user', async () => {
        const formData = new FormData();
        formData.append('inviteToken', 'a23e4567-e89b-12d3-a456-426614174000');
        formData.append('nextPath', '/home/team');

        await expect(
          acceptInvitationAction(formData, null as any),
        ).rejects.toThrow();
      });
    });
  });

  describe('renewInvitationAction', () => {
    describe('successful renewal', () => {
      it('should renew invitation with valid ID', async () => {
        const params = { invitationId: 123 };

        const result = await renewInvitationAction(params);

        expect(result).toEqual({ success: true });
        expect(mockRenewInvitation).toHaveBeenCalledWith(123);
      });

      it('should revalidate member page after renewal', async () => {
        const params = { invitationId: 456 };

        await renewInvitationAction(params);

        expect(mockRevalidatePath).toHaveBeenCalledWith(
          '/home/[account]/members',
          'page',
        );
      });
    });

    describe('schema validation', () => {
      it('should reject negative invitation ID', async () => {
        const params = { invitationId: -1 };

        await expect(renewInvitationAction(params)).rejects.toThrow();
      });

      it('should reject zero invitation ID', async () => {
        const params = { invitationId: 0 };

        await expect(renewInvitationAction(params)).rejects.toThrow();
      });

      it('should reject missing invitation ID', async () => {
        await expect(renewInvitationAction({} as any)).rejects.toThrow();
      });

      it('should accept positive invitation ID', async () => {
        const params = { invitationId: 1 };

        const result = await renewInvitationAction(params);

        expect(result.success).toBe(true);
      });
    });

    describe('error handling', () => {
      it('should propagate renewal errors', async () => {
        mockRenewInvitation.mockRejectedValueOnce(
          new Error('Invitation expired'),
        );

        const params = { invitationId: 999 };

        await expect(renewInvitationAction(params)).rejects.toThrow(
          'Invitation expired',
        );
      });
    });
  });

  describe('integration flows', () => {
    it('should complete full invitation lifecycle', async () => {
      // Create invitation
      const createParams = {
        accountSlug: 'test-team',
        invitations: [{ email: 'newuser@example.com', role: 'member' }],
      };

      await createInvitationsAction(createParams);

      expect(mockSendInvitations).toHaveBeenCalledWith(createParams);

      // Update invitation
      const updateData = { invitationId: 1, role: 'admin' };
      await updateInvitationAction(updateData);

      expect(mockUpdateInvitation).toHaveBeenCalledWith(updateData);

      // Renew invitation
      const renewData = { invitationId: 1 };
      await renewInvitationAction(renewData);

      expect(mockRenewInvitation).toHaveBeenCalledWith(1);

      // Accept invitation
      const formData = new FormData();
      formData.append('inviteToken', 'b23e4567-e89b-12d3-a456-426614174000');
      formData.append('nextPath', '/home/test-team');

      const user = { id: 'e87fcdeb-51a2-43d7-8f9e-123456789abc' };

      await expect(acceptInvitationAction(formData, user)).rejects.toThrow(
        'NEXT_REDIRECT',
      );

      expect(mockAcceptInvitationToTeam).toHaveBeenCalled();
      expect(mockIncreaseSeats).toHaveBeenCalled();
    });
  });
});
