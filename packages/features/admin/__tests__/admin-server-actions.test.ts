import { describe, expect, it, vi, beforeEach } from 'vitest';

// Mock dependencies
vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT;${url}`);
  }),
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
}));

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

// Mock Supabase clients
const mockSupabaseClient = {
  auth: {
    getUser: vi.fn(),
    getClaims: vi.fn(),
    mfa: {
      getAuthenticatorAssuranceLevel: vi.fn().mockResolvedValue({
        data: { currentLevel: 'aal2', nextLevel: 'aal2' },
        error: null,
      }),
    },
  },
  rpc: vi.fn(),
};

const mockAdminClient = {
  auth: {
    admin: {
      createUser: vi.fn(),
      deleteUser: vi.fn(),
      getUserById: vi.fn(),
      updateUserById: vi.fn(),
      generateLink: vi.fn(),
    },
    resetPasswordForEmail: vi.fn(),
  },
  from: vi.fn(() => ({
    delete: vi.fn().mockReturnThis(),
    eq: vi.fn().mockResolvedValue({ data: null, error: null }),
  })),
};

vi.mock('@kit/supabase/server-client', () => ({
  getSupabaseServerClient: vi.fn(() => mockSupabaseClient),
}));

vi.mock('@kit/supabase/server-admin-client', () => ({
  getSupabaseServerAdminClient: vi.fn(() => mockAdminClient),
}));

// Mock admin check
vi.mock('../src/lib/server/utils/is-super-admin', () => ({
  isSuperAdmin: vi.fn(),
}));

// Import after mocking
import { isSuperAdmin } from '../src/lib/server/utils/is-super-admin';
import { notFound, redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import {
  banUserAction,
  createUserAction,
  deleteAccountAction,
  deleteUserAction,
  impersonateUserAction,
  reactivateUserAction,
  resetPasswordAction,
} from '../src/lib/server/admin-server-actions';

describe('Admin Server Actions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_SITE_URL = 'https://example.com';

    // Set default getClaims response for authentication
    mockSupabaseClient.auth.getClaims.mockResolvedValue({
      data: {
        claims: {
          sub: 'admin-id',
          email: 'admin@example.com',
          aal: 'aal2',
        },
      },
      error: null,
    });
  });

  describe('banUserAction', () => {
    const validBanRequest = {
      userId: '123e4567-e89b-12d3-a456-426614174000',
      confirmation: 'CONFIRM',
    };

    describe('authorization', () => {
      it('should reject when user is not admin', async () => {
        vi.mocked(isSuperAdmin).mockResolvedValue(false);

        await expect(banUserAction(validBanRequest)).rejects.toThrow(
          'NEXT_NOT_FOUND',
        );

        expect(notFound).toHaveBeenCalled();
      });

      it('should allow when user is admin', async () => {
        vi.mocked(isSuperAdmin).mockResolvedValue(true);
        mockSupabaseClient.auth.getUser.mockResolvedValue({
          data: { user: { id: 'admin-id' } },
        });
        mockAdminClient.auth.admin.getUserById.mockResolvedValue({
          data: { user: { app_metadata: { role: 'user' } } },
        });
        mockAdminClient.auth.admin.updateUserById.mockResolvedValue({
          data: {},
          error: null,
        });

        await expect(banUserAction(validBanRequest)).rejects.toThrow(
          'NEXT_REDIRECT',
        );
      });
    });

    describe('validation', () => {
      beforeEach(() => {
        vi.mocked(isSuperAdmin).mockResolvedValue(true);
      });

      it('should reject invalid userId format', async () => {
        await expect(
          banUserAction({
            userId: 'invalid-uuid',
            confirmation: 'CONFIRM',
          }),
        ).rejects.toThrow();
      });

      it('should reject missing confirmation', async () => {
        await expect(
          banUserAction({
            userId: '123e4567-e89b-12d3-a456-426614174000',
            confirmation: 'WRONG',
          }),
        ).rejects.toThrow();
      });

      it('should accept valid input', async () => {
        mockSupabaseClient.auth.getUser.mockResolvedValue({
          data: { user: { id: 'admin-id' } },
        });
        mockAdminClient.auth.admin.getUserById.mockResolvedValue({
          data: { user: { app_metadata: { role: 'user' } } },
        });
        mockAdminClient.auth.admin.updateUserById.mockResolvedValue({
          data: {},
          error: null,
        });

        await expect(banUserAction(validBanRequest)).rejects.toThrow(
          'NEXT_REDIRECT',
        );
      });
    });

    describe('security', () => {
      beforeEach(() => {
        vi.mocked(isSuperAdmin).mockResolvedValue(true);
      });

      it('should prevent admin from banning themselves', async () => {
        mockSupabaseClient.auth.getUser.mockResolvedValue({
          data: { user: { id: validBanRequest.userId } },
        });

        await expect(banUserAction(validBanRequest)).rejects.toThrow(
          'You cannot perform a destructive action on your own account',
        );
      });

      it('should prevent banning another super admin', async () => {
        mockSupabaseClient.auth.getUser.mockResolvedValue({
          data: { user: { id: 'admin-id' } },
        });
        mockAdminClient.auth.admin.getUserById.mockResolvedValue({
          data: { user: { app_metadata: { role: 'super-admin' } } },
        });

        await expect(banUserAction(validBanRequest)).rejects.toThrow(
          'You cannot perform a destructive action on a Super Admin account',
        );
      });
    });

    describe('success cases', () => {
      beforeEach(() => {
        vi.mocked(isSuperAdmin).mockResolvedValue(true);
        mockSupabaseClient.auth.getUser.mockResolvedValue({
          data: { user: { id: 'admin-id' } },
        });
        mockAdminClient.auth.admin.getUserById.mockResolvedValue({
          data: { user: { app_metadata: { role: 'user' } } },
        });
      });

      it('should ban user successfully', async () => {
        mockAdminClient.auth.admin.updateUserById.mockResolvedValue({
          data: {},
          error: null,
        });

        await expect(banUserAction(validBanRequest)).rejects.toThrow(
          'NEXT_REDIRECT;/admin/accounts/123e4567-e89b-12d3-a456-426614174000',
        );

        expect(mockAdminClient.auth.admin.updateUserById).toHaveBeenCalledWith(
          validBanRequest.userId,
          { ban_duration: '876600h' },
        );
      });

      it('should revalidate admin paths after ban', async () => {
        mockAdminClient.auth.admin.updateUserById.mockResolvedValue({
          data: {},
          error: null,
        });

        await expect(banUserAction(validBanRequest)).rejects.toThrow(
          'NEXT_REDIRECT',
        );

        expect(revalidatePath).toHaveBeenCalledWith(
          '/admin/accounts/[id]',
          'page',
        );
      });

      it('should redirect to user page after ban', async () => {
        mockAdminClient.auth.admin.updateUserById.mockResolvedValue({
          data: {},
          error: null,
        });

        await expect(banUserAction(validBanRequest)).rejects.toThrow(
          'NEXT_REDIRECT;/admin/accounts/123e4567-e89b-12d3-a456-426614174000',
        );

        expect(redirect).toHaveBeenCalledWith(
          '/admin/accounts/123e4567-e89b-12d3-a456-426614174000',
        );
      });
    });

    describe('error handling', () => {
      beforeEach(() => {
        vi.mocked(isSuperAdmin).mockResolvedValue(true);
        mockSupabaseClient.auth.getUser.mockResolvedValue({
          data: { user: { id: 'admin-id' } },
        });
        mockAdminClient.auth.admin.getUserById.mockResolvedValue({
          data: { user: { app_metadata: { role: 'user' } } },
        });
      });

      it('should handle ban errors gracefully', async () => {
        mockAdminClient.auth.admin.updateUserById.mockResolvedValue({
          data: null,
          error: { message: 'Database error' },
        });

        const result = await banUserAction(validBanRequest);

        expect(result).toEqual({ success: false });
      });
    });
  });

  describe('reactivateUserAction', () => {
    const validReactivateRequest = {
      userId: '123e4567-e89b-12d3-a456-426614174000',
      confirmation: 'CONFIRM',
    };

    describe('authorization', () => {
      it('should reject when user is not admin', async () => {
        vi.mocked(isSuperAdmin).mockResolvedValue(false);

        await expect(
          reactivateUserAction(validReactivateRequest),
        ).rejects.toThrow('NEXT_NOT_FOUND');
      });
    });

    describe('success cases', () => {
      beforeEach(() => {
        vi.mocked(isSuperAdmin).mockResolvedValue(true);
        mockSupabaseClient.auth.getUser.mockResolvedValue({
          data: { user: { id: 'admin-id' } },
        });
        mockAdminClient.auth.admin.getUserById.mockResolvedValue({
          data: { user: { app_metadata: { role: 'user' } } },
        });
      });

      it('should reactivate user successfully', async () => {
        mockAdminClient.auth.admin.updateUserById.mockResolvedValue({
          data: {},
          error: null,
        });

        await expect(
          reactivateUserAction(validReactivateRequest),
        ).rejects.toThrow('NEXT_REDIRECT');

        expect(mockAdminClient.auth.admin.updateUserById).toHaveBeenCalledWith(
          validReactivateRequest.userId,
          { ban_duration: 'none' },
        );
      });

      it('should revalidate admin paths after reactivation', async () => {
        mockAdminClient.auth.admin.updateUserById.mockResolvedValue({
          data: {},
          error: null,
        });

        await expect(
          reactivateUserAction(validReactivateRequest),
        ).rejects.toThrow('NEXT_REDIRECT');

        expect(revalidatePath).toHaveBeenCalledWith(
          '/admin/accounts/[id]',
          'page',
        );
      });
    });

    describe('error handling', () => {
      beforeEach(() => {
        vi.mocked(isSuperAdmin).mockResolvedValue(true);
        mockSupabaseClient.auth.getUser.mockResolvedValue({
          data: { user: { id: 'admin-id' } },
        });
        mockAdminClient.auth.admin.getUserById.mockResolvedValue({
          data: { user: { app_metadata: { role: 'user' } } },
        });
      });

      it('should handle reactivation errors gracefully', async () => {
        mockAdminClient.auth.admin.updateUserById.mockResolvedValue({
          data: null,
          error: { message: 'Database error' },
        });

        const result = await reactivateUserAction(validReactivateRequest);

        expect(result).toEqual({ success: false });
      });
    });
  });

  describe('impersonateUserAction', () => {
    const validImpersonateRequest = {
      userId: '123e4567-e89b-12d3-a456-426614174000',
      confirmation: 'CONFIRM',
    };

    describe('authorization', () => {
      it('should reject when user is not admin', async () => {
        vi.mocked(isSuperAdmin).mockResolvedValue(false);

        await expect(
          impersonateUserAction(validImpersonateRequest),
        ).rejects.toThrow('NEXT_NOT_FOUND');
      });
    });

    describe('security', () => {
      beforeEach(() => {
        vi.mocked(isSuperAdmin).mockResolvedValue(true);
      });

      it('should prevent admin from impersonating themselves', async () => {
        mockSupabaseClient.auth.getUser.mockResolvedValue({
          data: { user: { id: validImpersonateRequest.userId } },
        });

        await expect(
          impersonateUserAction(validImpersonateRequest),
        ).rejects.toThrow(
          'You cannot perform a destructive action on your own account',
        );
      });

      it('should prevent impersonating another super admin', async () => {
        mockSupabaseClient.auth.getUser.mockResolvedValue({
          data: { user: { id: 'admin-id' } },
        });
        mockAdminClient.auth.admin.getUserById.mockResolvedValue({
          data: { user: { app_metadata: { role: 'super-admin' } } },
        });

        await expect(
          impersonateUserAction(validImpersonateRequest),
        ).rejects.toThrow(
          'You cannot perform a destructive action on a Super Admin account',
        );
      });
    });

    describe('success cases', () => {
      beforeEach(() => {
        vi.mocked(isSuperAdmin).mockResolvedValue(true);
        mockSupabaseClient.auth.getUser.mockResolvedValue({
          data: { user: { id: 'admin-id' } },
        });
      });

      it('should generate impersonation tokens successfully', async () => {
        mockAdminClient.auth.admin.getUserById.mockResolvedValue({
          data: {
            user: {
              id: validImpersonateRequest.userId,
              email: 'user@example.com',
              app_metadata: { role: 'user' },
            },
          },
          error: null,
        });

        mockAdminClient.auth.admin.generateLink.mockResolvedValue({
          data: {
            properties: {
              action_link: 'https://example.com/auth/confirm',
            },
          },
          error: null,
        });

        global.fetch = vi.fn().mockResolvedValue({
          headers: new Headers({
            Location:
              'https://example.com/#access_token=test-access&refresh_token=test-refresh',
          }),
        });

        const result = await impersonateUserAction(validImpersonateRequest);

        expect(result).toEqual({
          accessToken: 'test-access',
          refreshToken: 'test-refresh',
        });
      });

      it('should call Supabase admin generateLink', async () => {
        mockAdminClient.auth.admin.getUserById.mockResolvedValue({
          data: {
            user: {
              email: 'user@example.com',
              app_metadata: { role: 'user' },
            },
          },
          error: null,
        });

        mockAdminClient.auth.admin.generateLink.mockResolvedValue({
          data: {
            properties: {
              action_link: 'https://example.com/auth/confirm',
            },
          },
          error: null,
        });

        global.fetch = vi.fn().mockResolvedValue({
          headers: new Headers({
            Location:
              'https://example.com/#access_token=test-access&refresh_token=test-refresh',
          }),
        });

        await impersonateUserAction(validImpersonateRequest);

        expect(mockAdminClient.auth.admin.generateLink).toHaveBeenCalledWith({
          type: 'magiclink',
          email: 'user@example.com',
          options: {
            redirectTo: '/',
          },
        });
      });
    });

    describe('error handling', () => {
      beforeEach(() => {
        vi.mocked(isSuperAdmin).mockResolvedValue(true);
        mockSupabaseClient.auth.getUser.mockResolvedValue({
          data: { user: { id: 'admin-id' } },
        });
      });

      it('should handle user without email', async () => {
        mockAdminClient.auth.admin.getUserById.mockResolvedValue({
          data: {
            user: {
              id: validImpersonateRequest.userId,
              email: null,
              app_metadata: { role: 'user' },
            },
          },
          error: null,
        });

        await expect(
          impersonateUserAction(validImpersonateRequest),
        ).rejects.toThrow('User has no email. Cannot impersonate');
      });

      it('should handle getUserById errors', async () => {
        mockAdminClient.auth.admin.getUserById.mockResolvedValue({
          data: { user: null },
          error: { message: 'User not found' },
        });

        await expect(
          impersonateUserAction(validImpersonateRequest),
        ).rejects.toThrow('Error fetching user');
      });

      it('should handle generateLink errors', async () => {
        mockAdminClient.auth.admin.getUserById.mockResolvedValue({
          data: {
            user: {
              email: 'user@example.com',
              app_metadata: { role: 'user' },
            },
          },
          error: null,
        });

        mockAdminClient.auth.admin.generateLink.mockResolvedValue({
          data: null,
          error: { message: 'Link generation failed' },
        });

        await expect(
          impersonateUserAction(validImpersonateRequest),
        ).rejects.toThrow('Error generating magic link');
      });

      it('should handle missing Location header', async () => {
        mockAdminClient.auth.admin.getUserById.mockResolvedValue({
          data: {
            user: {
              email: 'user@example.com',
              app_metadata: { role: 'user' },
            },
          },
          error: null,
        });

        mockAdminClient.auth.admin.generateLink.mockResolvedValue({
          data: {
            properties: {
              action_link: 'https://example.com/auth/confirm',
            },
          },
          error: null,
        });

        global.fetch = vi.fn().mockResolvedValue({
          headers: new Headers({}),
        });

        await expect(
          impersonateUserAction(validImpersonateRequest),
        ).rejects.toThrow('Location header not found');
      });

      it('should handle missing tokens in URL', async () => {
        mockAdminClient.auth.admin.getUserById.mockResolvedValue({
          data: {
            user: {
              email: 'user@example.com',
              app_metadata: { role: 'user' },
            },
          },
          error: null,
        });

        mockAdminClient.auth.admin.generateLink.mockResolvedValue({
          data: {
            properties: {
              action_link: 'https://example.com/auth/confirm',
            },
          },
          error: null,
        });

        global.fetch = vi.fn().mockResolvedValue({
          headers: new Headers({
            Location: 'https://example.com/#invalid_params',
          }),
        });

        await expect(
          impersonateUserAction(validImpersonateRequest),
        ).rejects.toThrow('Tokens not found in URL hash');
      });
    });
  });

  describe('deleteUserAction', () => {
    const validDeleteRequest = {
      userId: '123e4567-e89b-12d3-a456-426614174000',
      confirmation: 'CONFIRM',
    };

    describe('authorization', () => {
      it('should reject when user is not admin', async () => {
        vi.mocked(isSuperAdmin).mockResolvedValue(false);

        await expect(deleteUserAction(validDeleteRequest)).rejects.toThrow(
          'NEXT_NOT_FOUND',
        );
      });
    });

    describe('security', () => {
      beforeEach(() => {
        vi.mocked(isSuperAdmin).mockResolvedValue(true);
      });

      it('should prevent admin from deleting themselves', async () => {
        mockSupabaseClient.auth.getUser.mockResolvedValue({
          data: { user: { id: validDeleteRequest.userId } },
        });

        await expect(deleteUserAction(validDeleteRequest)).rejects.toThrow(
          'You cannot perform a destructive action on your own account',
        );
      });

      it('should prevent deleting another super admin', async () => {
        mockSupabaseClient.auth.getUser.mockResolvedValue({
          data: { user: { id: 'admin-id' } },
        });
        mockAdminClient.auth.admin.getUserById.mockResolvedValue({
          data: { user: { app_metadata: { role: 'super-admin' } } },
        });

        await expect(deleteUserAction(validDeleteRequest)).rejects.toThrow(
          'You cannot perform a destructive action on a Super Admin account',
        );
      });
    });

    describe('success cases', () => {
      beforeEach(() => {
        vi.mocked(isSuperAdmin).mockResolvedValue(true);
        mockSupabaseClient.auth.getUser.mockResolvedValue({
          data: { user: { id: 'admin-id' } },
        });
        mockAdminClient.auth.admin.getUserById.mockResolvedValue({
          data: { user: { app_metadata: { role: 'user' } } },
        });
      });

      it('should delete user successfully', async () => {
        mockAdminClient.auth.admin.deleteUser.mockResolvedValue({
          data: {},
          error: null,
        });

        await expect(deleteUserAction(validDeleteRequest)).rejects.toThrow(
          'NEXT_REDIRECT;/admin/accounts',
        );

        expect(mockAdminClient.auth.admin.deleteUser).toHaveBeenCalledWith(
          validDeleteRequest.userId,
        );
      });

      it('should redirect to accounts list after deletion', async () => {
        mockAdminClient.auth.admin.deleteUser.mockResolvedValue({
          data: {},
          error: null,
        });

        await expect(deleteUserAction(validDeleteRequest)).rejects.toThrow(
          'NEXT_REDIRECT;/admin/accounts',
        );

        expect(redirect).toHaveBeenCalledWith('/admin/accounts');
      });
    });

    describe('error handling', () => {
      beforeEach(() => {
        vi.mocked(isSuperAdmin).mockResolvedValue(true);
        mockSupabaseClient.auth.getUser.mockResolvedValue({
          data: { user: { id: 'admin-id' } },
        });
        mockAdminClient.auth.admin.getUserById.mockResolvedValue({
          data: { user: { app_metadata: { role: 'user' } } },
        });
      });

      it('should handle delete errors', async () => {
        mockAdminClient.auth.admin.deleteUser.mockResolvedValue({
          data: null,
          error: { message: 'Delete failed' },
        });

        await expect(deleteUserAction(validDeleteRequest)).rejects.toThrow(
          'Error deleting user record or auth record',
        );
      });
    });
  });

  describe('deleteAccountAction', () => {
    const validDeleteAccountRequest = {
      accountId: '123e4567-e89b-12d3-a456-426614174000',
      confirmation: 'CONFIRM',
    };

    describe('authorization', () => {
      it('should reject when user is not admin', async () => {
        vi.mocked(isSuperAdmin).mockResolvedValue(false);

        await expect(
          deleteAccountAction(validDeleteAccountRequest),
        ).rejects.toThrow('NEXT_NOT_FOUND');
      });
    });

    describe('success cases', () => {
      beforeEach(() => {
        vi.mocked(isSuperAdmin).mockResolvedValue(true);
      });

      it('should redirect to accounts list after deletion', async () => {
        // The actual deletion logic is in the service, which we don't mock here
        // We just verify the redirect happens
        await expect(
          deleteAccountAction(validDeleteAccountRequest),
        ).rejects.toThrow('NEXT_REDIRECT;/admin/accounts');

        expect(redirect).toHaveBeenCalledWith('/admin/accounts');
      });

      it('should revalidate admin paths after deletion', async () => {
        await expect(
          deleteAccountAction(validDeleteAccountRequest),
        ).rejects.toThrow('NEXT_REDIRECT');

        expect(revalidatePath).toHaveBeenCalledWith(
          '/admin/accounts/[id]',
          'page',
        );
      });
    });
  });

  describe('createUserAction', () => {
    const validCreateRequest = {
      email: 'newuser@example.com',
      password: 'SecurePass123!',
      emailConfirm: true,
    };

    describe('authorization', () => {
      it('should reject when user is not admin', async () => {
        vi.mocked(isSuperAdmin).mockResolvedValue(false);

        await expect(createUserAction(validCreateRequest)).rejects.toThrow(
          'NEXT_NOT_FOUND',
        );
      });
    });

    describe('validation', () => {
      beforeEach(() => {
        vi.mocked(isSuperAdmin).mockResolvedValue(true);
      });

      it('should reject invalid email format', async () => {
        await expect(
          createUserAction({
            email: 'invalid-email',
            password: 'SecurePass123!',
            emailConfirm: true,
          }),
        ).rejects.toThrow();
      });

      it('should reject weak password', async () => {
        await expect(
          createUserAction({
            email: 'user@example.com',
            password: '123',
            emailConfirm: true,
          }),
        ).rejects.toThrow();
      });
    });

    describe('success cases', () => {
      beforeEach(() => {
        vi.mocked(isSuperAdmin).mockResolvedValue(true);
      });

      it('should create user successfully', async () => {
        const newUser = {
          id: 'new-user-id',
          email: validCreateRequest.email,
        };

        mockAdminClient.auth.admin.createUser.mockResolvedValue({
          data: { user: newUser },
          error: null,
        });

        const result = await createUserAction(validCreateRequest);

        expect(result).toEqual({
          success: true,
          user: newUser,
        });

        expect(mockAdminClient.auth.admin.createUser).toHaveBeenCalledWith({
          email: validCreateRequest.email,
          password: validCreateRequest.password,
          email_confirm: validCreateRequest.emailConfirm,
        });
      });

      it('should revalidate accounts path after creation', async () => {
        mockAdminClient.auth.admin.createUser.mockResolvedValue({
          data: { user: { id: 'new-user-id' } },
          error: null,
        });

        await createUserAction(validCreateRequest);

        expect(revalidatePath).toHaveBeenCalledWith('/admin/accounts');
      });
    });

    describe('error handling', () => {
      beforeEach(() => {
        vi.mocked(isSuperAdmin).mockResolvedValue(true);
      });

      it('should handle duplicate email errors', async () => {
        mockAdminClient.auth.admin.createUser.mockResolvedValue({
          data: { user: null },
          error: { message: 'User already registered' },
        });

        await expect(createUserAction(validCreateRequest)).rejects.toThrow(
          'Error creating user: User already registered',
        );
      });

      it('should handle general creation errors', async () => {
        mockAdminClient.auth.admin.createUser.mockResolvedValue({
          data: { user: null },
          error: { message: 'Database error' },
        });

        await expect(createUserAction(validCreateRequest)).rejects.toThrow(
          'Error creating user: Database error',
        );
      });
    });
  });

  describe('resetPasswordAction', () => {
    const validResetRequest = {
      userId: '123e4567-e89b-12d3-a456-426614174000',
      confirmation: 'CONFIRM',
    };

    describe('authorization', () => {
      it('should reject when user is not admin', async () => {
        vi.mocked(isSuperAdmin).mockResolvedValue(false);

        await expect(resetPasswordAction(validResetRequest)).rejects.toThrow(
          'NEXT_NOT_FOUND',
        );
      });
    });

    describe('security', () => {
      beforeEach(() => {
        vi.mocked(isSuperAdmin).mockResolvedValue(true);
      });

      it('should prevent admin from resetting their own password', async () => {
        mockSupabaseClient.auth.getUser.mockResolvedValue({
          data: { user: { id: validResetRequest.userId } },
        });

        await expect(resetPasswordAction(validResetRequest)).rejects.toThrow(
          'You cannot perform a destructive action on your own account',
        );
      });

      it('should prevent resetting password of another super admin', async () => {
        mockSupabaseClient.auth.getUser.mockResolvedValue({
          data: { user: { id: 'admin-id' } },
        });
        mockAdminClient.auth.admin.getUserById.mockResolvedValue({
          data: { user: { app_metadata: { role: 'super-admin' } } },
        });

        await expect(resetPasswordAction(validResetRequest)).rejects.toThrow(
          'You cannot perform a destructive action on a Super Admin account',
        );
      });
    });

    describe('success cases', () => {
      beforeEach(() => {
        vi.mocked(isSuperAdmin).mockResolvedValue(true);
        mockSupabaseClient.auth.getUser.mockResolvedValue({
          data: { user: { id: 'admin-id' } },
        });
      });

      it('should send password reset email successfully', async () => {
        mockAdminClient.auth.admin.getUserById.mockResolvedValue({
          data: {
            user: {
              id: validResetRequest.userId,
              email: 'user@example.com',
              app_metadata: { role: 'user' },
            },
          },
          error: null,
        });

        mockAdminClient.auth.resetPasswordForEmail.mockResolvedValue({
          data: {},
          error: null,
        });

        const result = await resetPasswordAction(validResetRequest);

        expect(result).toEqual({ success: true });

        expect(
          mockAdminClient.auth.resetPasswordForEmail,
        ).toHaveBeenCalledWith('user@example.com', {
          redirectTo: 'https://example.com/update-password',
        });
      });

      it('should use correct redirect URL from environment', async () => {
        process.env.NEXT_PUBLIC_SITE_URL = 'https://custom-domain.com';

        mockAdminClient.auth.admin.getUserById.mockResolvedValue({
          data: {
            user: {
              email: 'user@example.com',
              app_metadata: { role: 'user' },
            },
          },
          error: null,
        });

        mockAdminClient.auth.resetPasswordForEmail.mockResolvedValue({
          data: {},
          error: null,
        });

        await resetPasswordAction(validResetRequest);

        expect(
          mockAdminClient.auth.resetPasswordForEmail,
        ).toHaveBeenCalledWith('user@example.com', {
          redirectTo: 'https://custom-domain.com/update-password',
        });
      });
    });

    describe('error handling', () => {
      beforeEach(() => {
        vi.mocked(isSuperAdmin).mockResolvedValue(true);
        mockSupabaseClient.auth.getUser.mockResolvedValue({
          data: { user: { id: 'admin-id' } },
        });
      });

      it('should handle user without email', async () => {
        mockAdminClient.auth.admin.getUserById.mockResolvedValue({
          data: {
            user: {
              id: validResetRequest.userId,
              email: null,
              app_metadata: { role: 'user' },
            },
          },
          error: null,
        });

        await expect(resetPasswordAction(validResetRequest)).rejects.toThrow(
          'User has no email. Cannot reset password',
        );
      });

      it('should handle getUserById errors', async () => {
        mockAdminClient.auth.admin.getUserById.mockResolvedValue({
          data: { user: null },
          error: { message: 'User not found' },
        });

        await expect(resetPasswordAction(validResetRequest)).rejects.toThrow(
          'Error fetching user',
        );
      });

      it('should handle resetPasswordForEmail errors', async () => {
        mockAdminClient.auth.admin.getUserById.mockResolvedValue({
          data: {
            user: {
              email: 'user@example.com',
              app_metadata: { role: 'user' },
            },
          },
          error: null,
        });

        mockAdminClient.auth.resetPasswordForEmail.mockResolvedValue({
          data: null,
          error: { message: 'Email service unavailable' },
        });

        await expect(resetPasswordAction(validResetRequest)).rejects.toThrow(
          'Error sending password reset email: Email service unavailable',
        );
      });
    });
  });
});
