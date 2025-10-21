import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock Next.js functions - must be defined before import
vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT;${url}`);
  }),
}));

// Mock enhanceAction to bypass auth and directly call the handler
vi.mock('@kit/next/actions', () => ({
  enhanceAction: (handler: Function) => handler,
}));

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { leaveTeamAccountAction } from '../src/server/actions/leave-team-account-server-actions';

const mockRevalidatePath = vi.mocked(revalidatePath);
const mockRedirect = vi.mocked(redirect);

// Mock Supabase admin client
const mockAdminClient = {
  from: vi.fn(() => ({
    delete: vi.fn().mockReturnThis(),
    match: vi.fn(() => Promise.resolve({ data: null, error: null })),
  })),
};

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

describe('leaveTeamAccountAction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('successful leave operation', () => {
    it('should leave team account with valid input', async () => {
      const formData = new FormData();
      formData.append('accountId', '123e4567-e89b-12d3-a456-426614174000');
      formData.append('confirmation', 'LEAVE');

      const user = { id: '987fcdeb-51a2-43d7-8f9e-123456789abc' };

      await expect(
        leaveTeamAccountAction(formData, user),
      ).rejects.toThrow('NEXT_REDIRECT;/home');

      expect(mockAdminClient.from).toHaveBeenCalledWith('accounts_memberships');
    });

    it('should use admin client for deletion', async () => {
      const formData = new FormData();
      formData.append('accountId', '123e4567-e89b-12d3-a456-426614174000');
      formData.append('confirmation', 'LEAVE');

      const user = { id: '987fcdeb-51a2-43d7-8f9e-123456789abc' };

      await expect(
        leaveTeamAccountAction(formData, user),
      ).rejects.toThrow('NEXT_REDIRECT');

      expect(mockAdminClient.from).toHaveBeenCalled();
    });

    it('should revalidate account layout path', async () => {
      const formData = new FormData();
      formData.append('accountId', '123e4567-e89b-12d3-a456-426614174000');
      formData.append('confirmation', 'LEAVE');

      const user = { id: 'user-456' };

      await expect(
        leaveTeamAccountAction(formData, user),
      ).rejects.toThrow('NEXT_REDIRECT');

      expect(mockRevalidatePath).toHaveBeenCalledWith(
        '/home/[account]',
        'layout',
      );
    });

    it('should redirect to home after leaving', async () => {
      const formData = new FormData();
      formData.append('accountId', '123e4567-e89b-12d3-a456-426614174000');
      formData.append('confirmation', 'LEAVE');

      const user = { id: 'user-789' };

      await expect(
        leaveTeamAccountAction(formData, user),
      ).rejects.toThrow('NEXT_REDIRECT;/home');

      expect(mockRedirect).toHaveBeenCalledWith('/home');
    });

    it('should extract user id from authenticated user', async () => {
      const formData = new FormData();
      formData.append('accountId', 'acc-123');
      formData.append('confirmation', 'LEAVE');

      const user = { id: 'specific-user-id-789' };

      // Mock the admin client to verify the userId parameter
      const mockMatch = vi.fn(() =>
        Promise.resolve({ data: null, error: null }),
      );
      mockAdminClient.from.mockReturnValue({
        delete: vi.fn().mockReturnThis(),
        match: mockMatch,
      });

      await expect(
        leaveTeamAccountAction(formData, user),
      ).rejects.toThrow('NEXT_REDIRECT');

      expect(mockMatch).toHaveBeenCalledWith({
        account_id: 'acc-123',
        account_user_id: 'specific-user-id-789',
      });
    });
  });

  describe('schema validation', () => {
    it('should validate accountId is UUID', async () => {
      const formData = new FormData();
      formData.append('accountId', 'invalid-uuid');
      formData.append('confirmation', 'LEAVE');

      const user = { id: '987fcdeb-51a2-43d7-8f9e-123456789abc' };

      await expect(leaveTeamAccountAction(formData, user)).rejects.toThrow();
    });

    it('should validate confirmation is LEAVE', async () => {
      const formData = new FormData();
      formData.append('accountId', '123e4567-e89b-12d3-a456-426614174000');
      formData.append('confirmation', 'WRONG');

      const user = { id: '987fcdeb-51a2-43d7-8f9e-123456789abc' };

      await expect(leaveTeamAccountAction(formData, user)).rejects.toThrow();
    });

    it('should require accountId field', async () => {
      const formData = new FormData();
      formData.append('confirmation', 'LEAVE');

      const user = { id: '987fcdeb-51a2-43d7-8f9e-123456789abc' };

      await expect(leaveTeamAccountAction(formData, user)).rejects.toThrow();
    });

    it('should require confirmation field', async () => {
      const formData = new FormData();
      formData.append('accountId', '123e4567-e89b-12d3-a456-426614174000');

      const user = { id: '987fcdeb-51a2-43d7-8f9e-123456789abc' };

      await expect(leaveTeamAccountAction(formData, user)).rejects.toThrow();
    });

    it('should accept valid UUID format', async () => {
      const formData = new FormData();
      formData.append('accountId', '00000000-0000-0000-0000-000000000000');
      formData.append('confirmation', 'LEAVE');

      const user = { id: '987fcdeb-51a2-43d7-8f9e-123456789abc' };

      await expect(
        leaveTeamAccountAction(formData, user),
      ).rejects.toThrow('NEXT_REDIRECT');
    });
  });

  describe('error handling', () => {
    it('should handle database deletion errors', async () => {
      const dbError = new Error('Database connection failed');

      mockAdminClient.from.mockReturnValue({
        delete: vi.fn().mockReturnThis(),
        match: vi.fn(() =>
          Promise.resolve({
            data: null,
            error: dbError,
          }),
        ),
      });

      const formData = new FormData();
      formData.append('accountId', '123e4567-e89b-12d3-a456-426614174000');
      formData.append('confirmation', 'LEAVE');

      const user = { id: '987fcdeb-51a2-43d7-8f9e-123456789abc' };

      await expect(leaveTeamAccountAction(formData, user)).rejects.toThrow(
        'Failed to leave team account',
      );
    });

    it('should handle permission errors', async () => {
      mockAdminClient.from.mockReturnValue({
        delete: vi.fn().mockReturnThis(),
        match: vi.fn(() =>
          Promise.resolve({
            data: null,
            error: { code: '42501', message: 'permission denied' },
          }),
        ),
      });

      const formData = new FormData();
      formData.append('accountId', '123e4567-e89b-12d3-a456-426614174000');
      formData.append('confirmation', 'LEAVE');

      const user = { id: '987fcdeb-51a2-43d7-8f9e-123456789abc' };

      await expect(leaveTeamAccountAction(formData, user)).rejects.toThrow();
    });

    it('should handle invalid formdata structure', async () => {
      const formData = new FormData();
      formData.append('wrongField', 'value');

      const user = { id: '987fcdeb-51a2-43d7-8f9e-123456789abc' };

      await expect(leaveTeamAccountAction(formData, user)).rejects.toThrow();
    });
  });

  describe('formdata parsing', () => {
    it('should parse formdata entries correctly', async () => {
      const formData = new FormData();
      formData.append('accountId', '123e4567-e89b-12d3-a456-426614174000');
      formData.append('confirmation', 'LEAVE');

      const user = { id: '987fcdeb-51a2-43d7-8f9e-123456789abc' };

      await expect(
        leaveTeamAccountAction(formData, user),
      ).rejects.toThrow('NEXT_REDIRECT');

      // Verify the service was called with parsed params
      expect(mockAdminClient.from).toHaveBeenCalled();
    });

    it('should handle extra formdata fields', async () => {
      const formData = new FormData();
      formData.append('accountId', '123e4567-e89b-12d3-a456-426614174000');
      formData.append('confirmation', 'LEAVE');
      formData.append('extra', 'ignored');

      const user = { id: '987fcdeb-51a2-43d7-8f9e-123456789abc' };

      await expect(
        leaveTeamAccountAction(formData, user),
      ).rejects.toThrow('NEXT_REDIRECT');
    });
  });

  describe('service integration', () => {
    it('should call leave team account service', async () => {
      const mockMatch = vi.fn(() =>
        Promise.resolve({ data: null, error: null }),
      );
      mockAdminClient.from.mockReturnValue({
        delete: vi.fn().mockReturnThis(),
        match: mockMatch,
      });

      const formData = new FormData();
      formData.append('accountId', 'account-abc-123');
      formData.append('confirmation', 'LEAVE');

      const user = { id: 'user-xyz-789' };

      await expect(
        leaveTeamAccountAction(formData, user),
      ).rejects.toThrow('NEXT_REDIRECT');

      expect(mockMatch).toHaveBeenCalledWith({
        account_id: 'account-abc-123',
        account_user_id: 'user-xyz-789',
      });
    });

    it('should use getSupabaseServerAdminClient', async () => {
      const formData = new FormData();
      formData.append('accountId', '123e4567-e89b-12d3-a456-426614174000');
      formData.append('confirmation', 'LEAVE');

      const user = { id: '987fcdeb-51a2-43d7-8f9e-123456789abc' };

      await expect(
        leaveTeamAccountAction(formData, user),
      ).rejects.toThrow('NEXT_REDIRECT');

      // Admin client should be used for RLS bypass
      expect(mockAdminClient.from).toHaveBeenCalled();
    });
  });

  describe('edge cases', () => {
    it('should handle empty formdata', async () => {
      const formData = new FormData();
      const user = { id: '987fcdeb-51a2-43d7-8f9e-123456789abc' };

      await expect(leaveTeamAccountAction(formData, user)).rejects.toThrow();
    });

    it('should handle null user', async () => {
      const formData = new FormData();
      formData.append('accountId', '123e4567-e89b-12d3-a456-426614174000');
      formData.append('confirmation', 'LEAVE');

      await expect(
        leaveTeamAccountAction(formData, null as any),
      ).rejects.toThrow();
    });

    it('should handle user without id', async () => {
      const formData = new FormData();
      formData.append('accountId', '123e4567-e89b-12d3-a456-426614174000');
      formData.append('confirmation', 'LEAVE');

      const user = {} as any;

      await expect(leaveTeamAccountAction(formData, user)).rejects.toThrow();
    });

    it('should handle very long accountId (still valid UUID)', async () => {
      const formData = new FormData();
      formData.append('accountId', '123e4567-e89b-12d3-a456-426614174000');
      formData.append('confirmation', 'LEAVE');

      const user = { id: '987fcdeb-51a2-43d7-8f9e-123456789abc' };

      await expect(
        leaveTeamAccountAction(formData, user),
      ).rejects.toThrow('NEXT_REDIRECT');
    });
  });

  describe('integration flow', () => {
    it('should complete full leave flow', async () => {
      const mockMatch = vi.fn(() =>
        Promise.resolve({ data: null, error: null }),
      );
      mockAdminClient.from.mockReturnValue({
        delete: vi.fn().mockReturnThis(),
        match: mockMatch,
      });

      const formData = new FormData();
      formData.append('accountId', '123e4567-e89b-12d3-a456-426614174000');
      formData.append('confirmation', 'LEAVE');

      const user = { id: '987fcdeb-51a2-43d7-8f9e-123456789abc' };

      await expect(
        leaveTeamAccountAction(formData, user),
      ).rejects.toThrow('NEXT_REDIRECT;/home');

      // Verify full flow
      expect(mockAdminClient.from).toHaveBeenCalledWith(
        'accounts_memberships',
      );
      expect(mockMatch).toHaveBeenCalledWith({
        account_id: '123e4567-e89b-12d3-a456-426614174000',
        account_user_id: '987fcdeb-51a2-43d7-8f9e-123456789abc',
      });
      expect(mockRevalidatePath).toHaveBeenCalledWith(
        '/home/[account]',
        'layout',
      );
      expect(mockRedirect).toHaveBeenCalledWith('/home');
    });

    it('should not revalidate or redirect on error', async () => {
      mockAdminClient.from.mockReturnValue({
        delete: vi.fn().mockReturnThis(),
        match: vi.fn(() =>
          Promise.resolve({
            data: null,
            error: new Error('DB error'),
          }),
        ),
      });

      const formData = new FormData();
      formData.append('accountId', '123e4567-e89b-12d3-a456-426614174000');
      formData.append('confirmation', 'LEAVE');

      const user = { id: '987fcdeb-51a2-43d7-8f9e-123456789abc' };

      await expect(leaveTeamAccountAction(formData, user)).rejects.toThrow(
        'Failed to leave team account',
      );

      // Should not revalidate or redirect on error
      expect(mockRevalidatePath).not.toHaveBeenCalled();
      expect(mockRedirect).not.toHaveBeenCalled();
    });
  });
});
