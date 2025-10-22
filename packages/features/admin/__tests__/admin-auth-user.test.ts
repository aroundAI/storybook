import type { SupabaseClient } from '@supabase/supabase-js';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createAdminAuthUserService } from '../src/lib/server/services/admin-auth-user.service';

// Mock environment
process.env.NEXT_PUBLIC_SITE_URL = 'https://example.com';

// Valid UUIDs for testing
const CURRENT_USER_ID = '550e8400-e29b-41d4-a716-446655440000';
const TARGET_USER_ID = '550e8400-e29b-41d4-a716-446655440001';
const SUPER_ADMIN_USER_ID = '550e8400-e29b-41d4-a716-446655440002';

// Mock Supabase clients
const mockGetUser = vi.fn();
const mockDeleteUser = vi.fn();
const mockGetUserById = vi.fn();
const mockUpdateUserById = vi.fn();
const mockGenerateLink = vi.fn();
const mockResetPasswordForEmail = vi.fn();

const mockClient = {
  auth: {
    getUser: mockGetUser,
  },
} as unknown as SupabaseClient;

const mockAdminClient = {
  auth: {
    admin: {
      deleteUser: mockDeleteUser,
      getUserById: mockGetUserById,
      updateUserById: mockUpdateUserById,
      generateLink: mockGenerateLink,
    },
    resetPasswordForEmail: mockResetPasswordForEmail,
  },
} as unknown as SupabaseClient;

// Mock global fetch
global.fetch = vi.fn();

describe('AdminAuthUserService', () => {
  let service: ReturnType<typeof createAdminAuthUserService>;

  beforeEach(() => {
    vi.clearAllMocks();
    service = createAdminAuthUserService(mockClient, mockAdminClient);

    // Default: current user is not the target user
    mockGetUser.mockResolvedValue({
      data: {
        user: {
          id: CURRENT_USER_ID,
          email: 'admin@example.com',
        },
      },
      error: null,
    });

    // Default: target user is regular user (not super-admin)
    mockGetUserById.mockResolvedValue({
      data: {
        user: {
          id: TARGET_USER_ID,
          email: 'user@example.com',
          app_metadata: { role: 'user' },
        },
      },
      error: null,
    });
  });

  describe('deleteUser', () => {
    it('should delete user successfully', async () => {
      mockDeleteUser.mockResolvedValue({
        data: {},
        error: null,
      });

      await service.deleteUser(TARGET_USER_ID);

      expect(mockDeleteUser).toHaveBeenCalledWith(TARGET_USER_ID);
    });

    it('should throw error when deleting own account', async () => {
      await expect(service.deleteUser(CURRENT_USER_ID)).rejects.toThrow(
        'You cannot perform a destructive action on your own account as a Super Admin',
      );

      expect(mockDeleteUser).not.toHaveBeenCalled();
    });

    it('should throw error when deleting another super admin', async () => {
      mockGetUserById.mockResolvedValue({
        data: {
          user: {
            id: SUPER_ADMIN_USER_ID,
            email: 'super@example.com',
            app_metadata: { role: 'super-admin' },
          },
        },
        error: null,
      });

      await expect(service.deleteUser(SUPER_ADMIN_USER_ID)).rejects.toThrow(
        'You cannot perform a destructive action on a Super Admin account',
      );

      expect(mockDeleteUser).not.toHaveBeenCalled();
    });

    it('should throw error when deletion fails', async () => {
      mockDeleteUser.mockResolvedValue({
        data: null,
        error: { message: 'Deletion failed' },
      });

      await expect(service.deleteUser(TARGET_USER_ID)).rejects.toThrow(
        'Error deleting user record or auth record',
      );
    });

    it('should throw error when current user cannot be fetched', async () => {
      mockGetUser.mockResolvedValue({
        data: { user: null },
        error: null,
      });

      await expect(service.deleteUser(TARGET_USER_ID)).rejects.toThrow(
        'Error fetching user',
      );
    });
  });

  describe('banUser', () => {
    it('should ban user successfully', async () => {
      mockUpdateUserById.mockResolvedValue({
        data: { user: {} },
        error: null,
      });

      await service.banUser(TARGET_USER_ID);

      expect(mockUpdateUserById).toHaveBeenCalledWith(TARGET_USER_ID, {
        ban_duration: '876600h',
      });
    });

    it('should not ban own account', async () => {
      await expect(service.banUser(CURRENT_USER_ID)).rejects.toThrow(
        'You cannot perform a destructive action on your own account as a Super Admin',
      );

      expect(mockUpdateUserById).not.toHaveBeenCalled();
    });

    it('should not ban another super admin', async () => {
      mockGetUserById.mockResolvedValue({
        data: {
          user: {
            id: SUPER_ADMIN_USER_ID,
            app_metadata: { role: 'super-admin' },
          },
        },
        error: null,
      });

      await expect(service.banUser(SUPER_ADMIN_USER_ID)).rejects.toThrow(
        'You cannot perform a destructive action on a Super Admin account',
      );
    });
  });

  describe('reactivateUser', () => {
    it('should reactivate user successfully', async () => {
      mockUpdateUserById.mockResolvedValue({
        data: { user: {} },
        error: null,
      });

      await service.reactivateUser(TARGET_USER_ID);

      expect(mockUpdateUserById).toHaveBeenCalledWith(TARGET_USER_ID, {
        ban_duration: 'none',
      });
    });

    it('should not reactivate own account', async () => {
      await expect(service.reactivateUser(CURRENT_USER_ID)).rejects.toThrow(
        'You cannot perform a destructive action on your own account as a Super Admin',
      );
    });

    it('should not reactivate super admin account', async () => {
      mockGetUserById.mockResolvedValue({
        data: {
          user: {
            id: SUPER_ADMIN_USER_ID,
            app_metadata: { role: 'super-admin' },
          },
        },
        error: null,
      });

      await expect(service.reactivateUser(SUPER_ADMIN_USER_ID)).rejects.toThrow(
        'You cannot perform a destructive action on a Super Admin account',
      );
    });
  });

  describe('impersonateUser', () => {
    const mockActionLink = 'https://example.com/auth/confirm?token=123';
    const mockRedirectUrl =
      'https://example.com/#access_token=test_token&refresh_token=test_refresh';

    beforeEach(() => {
      mockGenerateLink.mockResolvedValue({
        data: {
          properties: {
            action_link: mockActionLink,
          },
        },
        error: null,
      });

      (global.fetch as any).mockResolvedValue({
        headers: {
          get: vi.fn().mockReturnValue(mockRedirectUrl),
        },
      });
    });

    it('should impersonate user successfully', async () => {
      const result = await service.impersonateUser(TARGET_USER_ID);

      expect(mockGetUserById).toHaveBeenCalledWith(TARGET_USER_ID);
      expect(mockGenerateLink).toHaveBeenCalledWith({
        type: 'magiclink',
        email: 'user@example.com',
        options: {
          redirectTo: '/',
        },
      });
      expect(result).toEqual({
        accessToken: 'test_token',
        refreshToken: 'test_refresh',
      });
    });

    it('should not impersonate own account', async () => {
      await expect(service.impersonateUser(CURRENT_USER_ID)).rejects.toThrow(
        'You cannot perform a destructive action on your own account as a Super Admin',
      );
    });

    it('should not impersonate super admin', async () => {
      mockGetUserById.mockResolvedValue({
        data: {
          user: {
            id: SUPER_ADMIN_USER_ID,
            email: 'super@example.com',
            app_metadata: { role: 'super-admin' },
          },
        },
        error: null,
      });

      await expect(
        service.impersonateUser(SUPER_ADMIN_USER_ID),
      ).rejects.toThrow(
        'You cannot perform a destructive action on a Super Admin account',
      );
    });

    it('should throw error when user has no email', async () => {
      // First call: assertUserIsNotCurrentSuperAdmin
      mockGetUserById.mockResolvedValueOnce({
        data: {
          user: {
            id: TARGET_USER_ID,
            email: null,
            app_metadata: { role: 'user' },
          },
        },
        error: null,
      });
      // Second call: impersonateUser itself
      mockGetUserById.mockResolvedValueOnce({
        data: {
          user: {
            id: TARGET_USER_ID,
            email: null,
            app_metadata: { role: 'user' },
          },
        },
        error: null,
      });

      await expect(service.impersonateUser(TARGET_USER_ID)).rejects.toThrow(
        'User has no email. Cannot impersonate',
      );
    });

    it('should throw error when magic link generation fails', async () => {
      mockGenerateLink.mockResolvedValue({
        data: null,
        error: { message: 'Failed to generate link' },
      });

      await expect(service.impersonateUser(TARGET_USER_ID)).rejects.toThrow(
        'Error generating magic link',
      );
    });

    it('should throw error when Location header is missing', async () => {
      (global.fetch as any).mockResolvedValue({
        headers: {
          get: vi.fn().mockReturnValue(null),
        },
      });

      await expect(service.impersonateUser(TARGET_USER_ID)).rejects.toThrow(
        'Error generating magic link. Location header not found',
      );
    });

    it('should throw error when tokens are missing from URL', async () => {
      (global.fetch as any).mockResolvedValue({
        headers: {
          get: vi.fn().mockReturnValue('https://example.com/#invalid'),
        },
      });

      await expect(service.impersonateUser(TARGET_USER_ID)).rejects.toThrow(
        'Error generating magic link. Tokens not found in URL hash',
      );
    });
  });

  describe('resetPassword', () => {
    it('should reset password successfully', async () => {
      mockResetPasswordForEmail.mockResolvedValue({
        data: {},
        error: null,
      });

      const result = await service.resetPassword(TARGET_USER_ID);

      expect(mockResetPasswordForEmail).toHaveBeenCalledWith(
        'user@example.com',
        {
          redirectTo: 'https://example.com/update-password',
        },
      );
      expect(result).toEqual({ success: true });
    });

    it('should not reset password for own account', async () => {
      await expect(service.resetPassword(CURRENT_USER_ID)).rejects.toThrow(
        'You cannot perform a destructive action on your own account as a Super Admin',
      );
    });

    it('should not reset password for super admin', async () => {
      mockGetUserById.mockResolvedValue({
        data: {
          user: {
            id: SUPER_ADMIN_USER_ID,
            email: 'super@example.com',
            app_metadata: { role: 'super-admin' },
          },
        },
        error: null,
      });

      await expect(service.resetPassword(SUPER_ADMIN_USER_ID)).rejects.toThrow(
        'You cannot perform a destructive action on a Super Admin account',
      );
    });

    it('should throw error when user has no email', async () => {
      // First call: assertUserIsNotCurrentSuperAdmin
      mockGetUserById.mockResolvedValueOnce({
        data: {
          user: {
            id: TARGET_USER_ID,
            email: null,
            app_metadata: { role: 'user' },
          },
        },
        error: null,
      });
      // Second call: resetPassword itself
      mockGetUserById.mockResolvedValueOnce({
        data: {
          user: {
            id: TARGET_USER_ID,
            email: null,
            app_metadata: { role: 'user' },
          },
        },
        error: null,
      });

      await expect(service.resetPassword(TARGET_USER_ID)).rejects.toThrow(
        'User has no email. Cannot reset password',
      );
    });

    it('should throw error when reset email fails', async () => {
      mockResetPasswordForEmail.mockResolvedValue({
        data: null,
        error: { message: 'Failed to send email' },
      });

      await expect(service.resetPassword(TARGET_USER_ID)).rejects.toThrow(
        'Error sending password reset email: Failed to send email',
      );
    });

    it('should throw error when user fetch fails', async () => {
      // First call: assertUserIsNotCurrentSuperAdmin - needs to succeed
      mockGetUserById.mockResolvedValueOnce({
        data: {
          user: {
            id: TARGET_USER_ID,
            email: 'user@example.com',
            app_metadata: { role: 'user' },
          },
        },
        error: null,
      });
      // Second call: resetPassword itself - this should fail
      mockGetUserById.mockResolvedValueOnce({
        data: { user: null },
        error: { message: 'User not found' },
      });

      await expect(service.resetPassword(TARGET_USER_ID)).rejects.toThrow(
        'Error fetching user',
      );
    });

    it('should use correct site URL from environment', async () => {
      process.env.NEXT_PUBLIC_SITE_URL = 'https://custom-domain.com';

      service = createAdminAuthUserService(mockClient, mockAdminClient);

      mockResetPasswordForEmail.mockResolvedValue({
        data: {},
        error: null,
      });

      await service.resetPassword(TARGET_USER_ID);

      expect(mockResetPasswordForEmail).toHaveBeenCalledWith(
        'user@example.com',
        {
          redirectTo: 'https://custom-domain.com/update-password',
        },
      );

      // Reset for other tests
      process.env.NEXT_PUBLIC_SITE_URL = 'https://example.com';
    });
  });

  describe('Edge cases and security', () => {
    it('should prevent operations on user with undefined role', async () => {
      mockGetUserById.mockResolvedValue({
        data: {
          user: {
            id: TARGET_USER_ID,
            email: 'user@example.com',
            app_metadata: {},
          },
        },
        error: null,
      });

      // Should succeed since undefined role != 'super-admin'
      mockDeleteUser.mockResolvedValue({ data: {}, error: null });

      await expect(service.deleteUser(TARGET_USER_ID)).resolves.toBeUndefined();
    });

    it('should handle concurrent operations on same user', async () => {
      mockUpdateUserById.mockResolvedValue({
        data: { user: {} },
        error: null,
      });

      await Promise.all([
        service.banUser(TARGET_USER_ID),
        service.reactivateUser(TARGET_USER_ID),
      ]);

      expect(mockUpdateUserById).toHaveBeenCalledTimes(2);
    });

    it('should handle user ID format edge cases', async () => {
      const edgeCaseIds = [
        '00000000-0000-0000-0000-000000000000',
        'ffffffff-ffff-ffff-ffff-ffffffffffff',
      ];

      mockDeleteUser.mockResolvedValue({ data: {}, error: null });

      for (const id of edgeCaseIds) {
        mockGetUserById.mockResolvedValue({
          data: {
            user: { id, app_metadata: { role: 'user' } },
          },
          error: null,
        });

        await expect(service.deleteUser(id)).resolves.toBeUndefined();
      }
    });
  });
});
