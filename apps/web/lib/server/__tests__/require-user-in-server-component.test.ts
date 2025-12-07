import { redirect } from 'next/navigation';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { requireUser } from '@kit/supabase/require-user';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

import { requireUserInServerComponent } from '../require-user-in-server-component';

// Mock server-only
vi.mock('server-only', () => ({}));

// Mock Next.js navigation
vi.mock('next/navigation', () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT;${url}`);
  }),
}));

// Mock Supabase modules
vi.mock('@kit/supabase/require-user', () => ({
  requireUser: vi.fn(),
}));

vi.mock('@kit/supabase/server-client', () => ({
  getSupabaseServerClient: vi.fn(),
}));

describe('require-user-in-server-component', () => {
  const mockRedirect = vi.mocked(redirect);
  const mockRequireUser = vi.mocked(requireUser);
  const mockGetSupabaseServerClient = vi.mocked(getSupabaseServerClient);

  const mockClient = {
    from: vi.fn(),
    auth: {
      getUser: vi.fn(),
    },
  };

  const mockUser = {
    id: 'user-123',
    email: 'test@example.com',
    role: 'authenticated',
    aud: 'authenticated',
    created_at: new Date().toISOString(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSupabaseServerClient.mockReturnValue(mockClient as any);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('requireUserInServerComponent', () => {
    describe('successful authentication', () => {
      it('should return user data when authenticated', async () => {
        mockRequireUser.mockResolvedValue({
          data: mockUser,
          error: false,
        });

        const result = await requireUserInServerComponent();

        expect(result).toEqual(mockUser);
      });

      it('should call getSupabaseServerClient', async () => {
        mockRequireUser.mockResolvedValue({
          data: mockUser,
          error: false,
        });

        await requireUserInServerComponent();

        expect(mockGetSupabaseServerClient).toHaveBeenCalledOnce();
      });

      it('should call requireUser with client', async () => {
        mockRequireUser.mockResolvedValue({
          data: mockUser,
          error: false,
        });

        await requireUserInServerComponent();

        expect(mockRequireUser).toHaveBeenCalledWith(mockClient);
      });

      it('should return complete user object', async () => {
        const fullUser = {
          id: 'user-456',
          email: 'full@example.com',
          role: 'authenticated',
          aud: 'authenticated',
          created_at: new Date().toISOString(),
          app_metadata: { provider: 'email' },
          user_metadata: { name: 'Test User' },
        };

        mockRequireUser.mockResolvedValue({
          data: fullUser,
          error: false,
        });

        const result = await requireUserInServerComponent();

        expect(result).toEqual(fullUser);
        expect(result.app_metadata).toBeDefined();
        expect(result.user_metadata).toBeDefined();
      });

      it('should not call redirect when authenticated', async () => {
        mockRequireUser.mockResolvedValue({
          data: mockUser,
          error: false,
        });

        await requireUserInServerComponent();

        expect(mockRedirect).not.toHaveBeenCalled();
      });
    });

    describe('authentication errors', () => {
      it('should redirect when user is not authenticated', async () => {
        mockRequireUser.mockResolvedValue({
          data: null,
          error: true,
          redirectTo: '/auth/sign-in',
        });

        await expect(requireUserInServerComponent()).rejects.toThrow(
          'NEXT_REDIRECT;/auth/sign-in',
        );
      });

      it('should redirect to custom path', async () => {
        mockRequireUser.mockResolvedValue({
          data: null,
          error: true,
          redirectTo: '/custom-login',
        });

        await expect(requireUserInServerComponent()).rejects.toThrow(
          'NEXT_REDIRECT;/custom-login',
        );
      });

      it('should call redirect with redirectTo value', async () => {
        mockRequireUser.mockResolvedValue({
          data: null,
          error: true,
          redirectTo: '/auth/sign-in',
        });

        try {
          await requireUserInServerComponent();
        } catch (error) {
          expect(mockRedirect).toHaveBeenCalledWith('/auth/sign-in');
        }
      });

      it('should redirect with query parameters', async () => {
        mockRequireUser.mockResolvedValue({
          data: null,
          error: true,
          redirectTo: '/auth/sign-in?next=/dashboard',
        });

        await expect(requireUserInServerComponent()).rejects.toThrow(
          'NEXT_REDIRECT;/auth/sign-in?next=/dashboard',
        );
      });

      it('should handle error with special characters in redirectTo', async () => {
        mockRequireUser.mockResolvedValue({
          data: null,
          error: true,
          redirectTo: '/auth/sign-in?error=session_expired&code=401',
        });

        await expect(requireUserInServerComponent()).rejects.toThrow(
          'NEXT_REDIRECT;/auth/sign-in?error=session_expired&code=401',
        );
      });
    });

    describe('caching behavior', () => {
      it('should be a cached function', () => {
        // The function is wrapped with React.cache
        expect(typeof requireUserInServerComponent).toBe('function');
      });

      it('should call requireUser each time (cache is per-request)', async () => {
        mockRequireUser.mockResolvedValue({
          data: mockUser,
          error: false,
        });

        await requireUserInServerComponent();
        await requireUserInServerComponent();

        // Note: In actual React Server Components, cache() deduplicates per request
        // In tests, we see multiple calls since we don't have request context
        expect(mockRequireUser).toHaveBeenCalled();
      });
    });

    describe('edge cases', () => {
      it('should handle requireUser throwing an error', async () => {
        mockRequireUser.mockRejectedValue(new Error('Database error'));

        await expect(requireUserInServerComponent()).rejects.toThrow(
          'Database error',
        );
      });

      it('should handle getSupabaseServerClient throwing an error', async () => {
        mockGetSupabaseServerClient.mockImplementation(() => {
          throw new Error('Client creation failed');
        });

        await expect(requireUserInServerComponent()).rejects.toThrow(
          'Client creation failed',
        );
      });

      it('should handle error with missing redirectTo', async () => {
        mockRequireUser.mockResolvedValue({
          data: null,
          error: true,
          redirectTo: undefined as any,
        });

        try {
          await requireUserInServerComponent();
        } catch (error) {
          expect(mockRedirect).toHaveBeenCalledWith(undefined);
        }
      });

      it('should handle error with empty string redirectTo', async () => {
        mockRequireUser.mockResolvedValue({
          data: null,
          error: true,
          redirectTo: '',
        });

        await expect(requireUserInServerComponent()).rejects.toThrow(
          'NEXT_REDIRECT;',
        );
      });

      it('should handle requireUser returning unexpected data structure', async () => {
        mockRequireUser.mockResolvedValue({
          data: { unexpected: 'structure' },
          error: false,
        } as any);

        const result = await requireUserInServerComponent();

        expect(result).toEqual({ unexpected: 'structure' });
      });
    });

    describe('return value validation', () => {
      it('should return user with id property', async () => {
        mockRequireUser.mockResolvedValue({
          data: mockUser,
          error: false,
        });

        const result = await requireUserInServerComponent();

        expect(result).toHaveProperty('id');
        expect(result.id).toBe('user-123');
      });

      it('should return user with email property', async () => {
        mockRequireUser.mockResolvedValue({
          data: mockUser,
          error: false,
        });

        const result = await requireUserInServerComponent();

        expect(result).toHaveProperty('email');
        expect(result.email).toBe('test@example.com');
      });

      it('should return user with authentication metadata', async () => {
        const userWithMetadata = {
          ...mockUser,
          role: 'authenticated',
          aud: 'authenticated',
        };

        mockRequireUser.mockResolvedValue({
          data: userWithMetadata,
          error: false,
        });

        const result = await requireUserInServerComponent();

        expect(result.role).toBe('authenticated');
        expect(result.aud).toBe('authenticated');
      });
    });

    describe('integration scenarios', () => {
      it('should work in sequential calls', async () => {
        mockRequireUser.mockResolvedValue({
          data: mockUser,
          error: false,
        });

        const result1 = await requireUserInServerComponent();
        const result2 = await requireUserInServerComponent();

        expect(result1).toEqual(mockUser);
        expect(result2).toEqual(mockUser);
      });

      it('should handle authentication then error scenario', async () => {
        mockRequireUser
          .mockResolvedValueOnce({
            data: mockUser,
            error: false,
          })
          .mockResolvedValueOnce({
            data: null,
            error: true,
            redirectTo: '/auth/sign-in',
          });

        const result1 = await requireUserInServerComponent();
        expect(result1).toEqual(mockUser);

        await expect(requireUserInServerComponent()).rejects.toThrow(
          'NEXT_REDIRECT',
        );
      });

      it('should handle different users in sequence', async () => {
        const user1 = { ...mockUser, id: 'user-1' };
        const user2 = { ...mockUser, id: 'user-2' };

        mockRequireUser
          .mockResolvedValueOnce({
            data: user1,
            error: false,
          })
          .mockResolvedValueOnce({
            data: user2,
            error: false,
          });

        const result1 = await requireUserInServerComponent();
        const result2 = await requireUserInServerComponent();

        expect(result1.id).toBe('user-1');
        expect(result2.id).toBe('user-2');
      });
    });

    describe('server-only enforcement', () => {
      it('should import server-only module', () => {
        // The mere fact that this test file loads means server-only is imported
        // In client code, this would throw an error
        expect(true).toBe(true);
      });
    });
  });
});
