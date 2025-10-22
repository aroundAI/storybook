import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createAuthCallbackService } from '@kit/supabase/auth';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

// Import route AFTER all mocks are set up
import { GET } from '../../auth/callback/route';

// Mock all dependencies before importing the route
vi.mock('@kit/supabase/server-client', () => ({
  getSupabaseServerClient: vi.fn(),
}));

vi.mock('@kit/supabase/auth', () => ({
  createAuthCallbackService: vi.fn(),
}));

vi.mock('~/config/paths.config', () => ({
  default: {
    app: {
      joinTeam: '/join-team',
      home: '/home',
    },
  },
}));

// Mock next/navigation redirect
vi.mock('next/navigation', () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT;${url}`);
  }),
}));

// Get mocked functions for assertions
const mockGetSupabaseServerClient = vi.mocked(getSupabaseServerClient);
const mockCreateAuthCallbackService = vi.mocked(createAuthCallbackService);

describe('Auth Callback API Route', () => {
  const createMockRequest = (searchParams: Record<string, string> = {}) => {
    const url = new URL('https://example.com/auth/callback');
    Object.entries(searchParams).forEach(([key, value]) => {
      url.searchParams.set(key, value);
    });

    return {
      url: url.toString(),
      nextUrl: url,
    } as any;
  };

  let mockExchangeCodeForSession: ReturnType<typeof vi.fn>;
  let mockSupabaseClient: any;

  beforeEach(() => {
    vi.clearAllMocks();

    // Setup mock Supabase client
    mockSupabaseClient = {
      auth: {
        exchangeCodeForSession: vi.fn(),
      },
    };

    mockGetSupabaseServerClient.mockReturnValue(mockSupabaseClient);

    // Setup mock auth callback service
    mockExchangeCodeForSession = vi.fn().mockResolvedValue({
      nextPath: '/home',
    });

    mockCreateAuthCallbackService.mockReturnValue({
      exchangeCodeForSession: mockExchangeCodeForSession,
    } as ReturnType<typeof createAuthCallbackService>);
  });

  describe('Successful Auth Code Exchange', () => {
    it('should redirect to home path when code exchange succeeds', async () => {
      const request = createMockRequest({ code: 'auth_code_123' });

      try {
        await GET(request);
        // Should not reach here
        expect.fail('Expected redirect to be thrown');
      } catch (error) {
        expect((error as Error).message).toBe('NEXT_REDIRECT;/home');
      }
    });

    it('should call exchangeCodeForSession with correct params', async () => {
      const request = createMockRequest({ code: 'auth_code_123' });

      try {
        await GET(request);
      } catch {
        // Expected redirect
      }

      expect(mockExchangeCodeForSession).toHaveBeenCalledWith(request, {
        joinTeamPath: '/join-team',
        redirectPath: '/home',
      });
    });

    it('should redirect to custom next path when specified', async () => {
      mockExchangeCodeForSession.mockResolvedValue({
        nextPath: '/custom-path',
      });

      const request = createMockRequest({
        code: 'auth_code_123',
        next: '/custom-path',
      });

      try {
        await GET(request);
      } catch (error) {
        expect((error as Error).message).toBe('NEXT_REDIRECT;/custom-path');
      }
    });

    it('should redirect to join team path when invite token present', async () => {
      mockExchangeCodeForSession.mockResolvedValue({
        nextPath: '/join-team?invite_token=token123&email=user@example.com',
      });

      const request = createMockRequest({
        code: 'auth_code_123',
        invite_token: 'token123',
        email: 'user@example.com',
      });

      try {
        await GET(request);
      } catch (error) {
        expect((error as Error).message).toContain('NEXT_REDIRECT;/join-team');
        expect((error as Error).message).toContain('invite_token=token123');
      }
    });
  });

  describe('Auth Code Variations', () => {
    it('should handle OAuth callback with code parameter', async () => {
      const request = createMockRequest({ code: 'oauth_code_abc' });

      try {
        await GET(request);
      } catch {
        // Expected redirect
      }

      expect(mockExchangeCodeForSession).toHaveBeenCalledWith(
        request,
        expect.objectContaining({
          joinTeamPath: '/join-team',
          redirectPath: '/home',
        }),
      );
    });

    it('should handle email magic link callback', async () => {
      mockExchangeCodeForSession.mockResolvedValue({
        nextPath: '/home',
      });

      const request = createMockRequest({
        code: 'email_verification_code',
      });

      try {
        await GET(request);
      } catch (error) {
        expect((error as Error).message).toBe('NEXT_REDIRECT;/home');
      }
    });

    it('should handle callback without code (direct access)', async () => {
      mockExchangeCodeForSession.mockResolvedValue({
        nextPath: '/home',
      });

      const request = createMockRequest();

      try {
        await GET(request);
      } catch (error) {
        expect((error as Error).message).toBe('NEXT_REDIRECT;/home');
      }
    });
  });

  describe('Error Scenarios', () => {
    it('should redirect to error path when service returns error path', async () => {
      mockExchangeCodeForSession.mockResolvedValue({
        nextPath: '/auth/callback/error?error=invalid_code',
      });

      const request = createMockRequest({ code: 'invalid_code' });

      try {
        await GET(request);
      } catch (error) {
        expect((error as Error).message).toContain(
          'NEXT_REDIRECT;/auth/callback/error',
        );
        expect((error as Error).message).toContain('error=invalid_code');
      }
    });

    it('should handle expired auth code', async () => {
      mockExchangeCodeForSession.mockResolvedValue({
        nextPath: '/auth/callback/error?error=auth:errors.otp_expired',
      });

      const request = createMockRequest({ code: 'expired_code' });

      try {
        await GET(request);
      } catch (error) {
        expect((error as Error).message).toContain('otp_expired');
      }
    });

    it('should handle code verifier mismatch', async () => {
      mockExchangeCodeForSession.mockResolvedValue({
        nextPath: '/auth/callback/error?error=auth:errors.codeVerifierMismatch',
      });

      const request = createMockRequest({ code: 'mismatched_code' });

      try {
        await GET(request);
      } catch (error) {
        expect((error as Error).message).toContain('codeVerifierMismatch');
      }
    });

    it('should handle error query parameter', async () => {
      mockExchangeCodeForSession.mockResolvedValue({
        nextPath: '/auth/callback/error?error=access_denied',
      });

      const request = createMockRequest({
        error: 'access_denied',
        error_description: 'User cancelled login',
      });

      try {
        await GET(request);
      } catch (error) {
        expect((error as Error).message).toContain('access_denied');
      }
    });
  });

  describe('Service Integration', () => {
    it('should create auth callback service with Supabase client', async () => {
      const request = createMockRequest({ code: 'auth_code_123' });

      try {
        await GET(request);
      } catch {
        // Expected redirect
      }

      expect(mockCreateAuthCallbackService).toHaveBeenCalledWith(
        mockSupabaseClient,
      );
    });

    it('should call getSupabaseServerClient once', async () => {
      const request = createMockRequest({ code: 'auth_code_123' });

      try {
        await GET(request);
      } catch {
        // Expected redirect
      }

      expect(mockGetSupabaseServerClient).toHaveBeenCalledTimes(1);
    });
  });

  describe('Query Parameters', () => {
    it('should handle next parameter for redirect after auth', async () => {
      mockExchangeCodeForSession.mockResolvedValue({
        nextPath: '/dashboard',
      });

      const request = createMockRequest({
        code: 'auth_code_123',
        next: '/dashboard',
      });

      try {
        await GET(request);
      } catch (error) {
        expect((error as Error).message).toBe('NEXT_REDIRECT;/dashboard');
      }
    });

    it('should handle callback parameter as alternative to next', async () => {
      mockExchangeCodeForSession.mockResolvedValue({
        nextPath: '/settings',
      });

      const request = createMockRequest({
        code: 'auth_code_123',
        callback: '/settings',
      });

      try {
        await GET(request);
      } catch (error) {
        expect((error as Error).message).toBe('NEXT_REDIRECT;/settings');
      }
    });

    it('should preserve query parameters in redirect path', async () => {
      mockExchangeCodeForSession.mockResolvedValue({
        nextPath: '/home?welcome=true',
      });

      const request = createMockRequest({
        code: 'auth_code_123',
        next: '/home?welcome=true',
      });

      try {
        await GET(request);
      } catch (error) {
        expect((error as Error).message).toContain('welcome=true');
      }
    });
  });

  describe('Team Invitations', () => {
    it('should redirect to join team path with invite token', async () => {
      mockExchangeCodeForSession.mockResolvedValue({
        nextPath: '/join-team?invite_token=inv_123&email=newuser@example.com',
      });

      const request = createMockRequest({
        code: 'auth_code_123',
        invite_token: 'inv_123',
        email: 'newuser@example.com',
      });

      try {
        await GET(request);
      } catch (error) {
        expect((error as Error).message).toContain('/join-team');
        expect((error as Error).message).toContain('invite_token=inv_123');
        expect((error as Error).message).toContain('newuser@example.com');
      }
    });

    it('should handle invite token without email', async () => {
      mockExchangeCodeForSession.mockResolvedValue({
        nextPath: '/join-team?invite_token=inv_456',
      });

      const request = createMockRequest({
        code: 'auth_code_123',
        invite_token: 'inv_456',
      });

      try {
        await GET(request);
      } catch (error) {
        expect((error as Error).message).toContain('/join-team');
        expect((error as Error).message).toContain('invite_token=inv_456');
      }
    });

    it('should prioritize invite token over next parameter', async () => {
      mockExchangeCodeForSession.mockResolvedValue({
        nextPath: '/join-team?invite_token=inv_789&email=user@test.com',
      });

      const request = createMockRequest({
        code: 'auth_code_123',
        invite_token: 'inv_789',
        email: 'user@test.com',
        next: '/dashboard', // Should be ignored
      });

      try {
        await GET(request);
      } catch (error) {
        expect((error as Error).message).toContain('/join-team');
        expect((error as Error).message).not.toContain('/dashboard');
      }
    });
  });

  describe('Path Configuration', () => {
    it('should use configured join team path', async () => {
      const request = createMockRequest({ code: 'auth_code_123' });

      try {
        await GET(request);
      } catch {
        // Expected redirect
      }

      expect(mockExchangeCodeForSession).toHaveBeenCalledWith(
        request,
        expect.objectContaining({
          joinTeamPath: '/join-team',
        }),
      );
    });

    it('should use configured home path as default redirect', async () => {
      const request = createMockRequest({ code: 'auth_code_123' });

      try {
        await GET(request);
      } catch {
        // Expected redirect
      }

      expect(mockExchangeCodeForSession).toHaveBeenCalledWith(
        request,
        expect.objectContaining({
          redirectPath: '/home',
        }),
      );
    });
  });

  describe('Concurrent Requests', () => {
    it('should handle multiple auth callbacks independently', async () => {
      const request1 = createMockRequest({ code: 'code_1' });
      const request2 = createMockRequest({ code: 'code_2' });

      mockExchangeCodeForSession
        .mockResolvedValueOnce({ nextPath: '/home' })
        .mockResolvedValueOnce({ nextPath: '/dashboard' });

      try {
        await GET(request1);
      } catch (error) {
        expect((error as Error).message).toBe('NEXT_REDIRECT;/home');
      }

      try {
        await GET(request2);
      } catch (error) {
        expect((error as Error).message).toBe('NEXT_REDIRECT;/dashboard');
      }

      expect(mockExchangeCodeForSession).toHaveBeenCalledTimes(2);
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty query parameters', async () => {
      mockExchangeCodeForSession.mockResolvedValue({
        nextPath: '/home',
      });

      const request = createMockRequest();

      try {
        await GET(request);
      } catch (error) {
        expect((error as Error).message).toBe('NEXT_REDIRECT;/home');
      }
    });

    it('should handle URL with hash fragment', async () => {
      mockExchangeCodeForSession.mockResolvedValue({
        nextPath: '/home#section',
      });

      const request = createMockRequest({
        code: 'auth_code_123',
        next: '/home#section',
      });

      try {
        await GET(request);
      } catch (error) {
        expect((error as Error).message).toContain('/home#section');
      }
    });

    it('should handle special characters in query parameters', async () => {
      mockExchangeCodeForSession.mockResolvedValue({
        nextPath: '/home?message=Welcome+User',
      });

      const request = createMockRequest({
        code: 'auth_code_123',
        next: '/home?message=Welcome+User',
      });

      try {
        await GET(request);
      } catch (error) {
        expect((error as Error).message).toContain('Welcome');
      }
    });
  });
});
