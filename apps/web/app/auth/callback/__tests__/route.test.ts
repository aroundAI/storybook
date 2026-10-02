import type { NextRequest } from 'next/server';

import { beforeEach, describe, expect, it, vi } from 'vitest';

// Get mocked functions
import { createAuthCallbackService } from '@kit/supabase/auth';

import { GET } from '../route';

// Mock dependencies before importing
vi.mock('@kit/supabase/auth', () => ({
  createAuthCallbackService: vi.fn(),
}));

vi.mock('@kit/supabase/server-client', () => ({
  getSupabaseServerClient: vi.fn(() => ({})),
}));

vi.mock('next/navigation', () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT;${url}`);
  }),
}));

vi.mock('~/config/paths.config', () => ({
  default: {
    app: {
      home: '/home',
      joinTeam: '/join-team',
    },
  },
}));

const mockCreateAuthCallbackService = vi.mocked(createAuthCallbackService);

describe('Auth Callback API Route', () => {
  let mockExchangeCodeForSession: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();

    // Setup mock auth callback service
    mockExchangeCodeForSession = vi.fn().mockResolvedValue({
      nextPath: '/home',
    });

    mockCreateAuthCallbackService.mockReturnValue({
      exchangeCodeForSession: mockExchangeCodeForSession,
    } as any);
  });

  describe('Successful authentication callback', () => {
    it('should redirect to home path on successful authentication', async () => {
      const request = new Request(
        'http://localhost:3000/auth/callback?code=auth_code_123',
      ) as NextRequest;

      try {
        await GET(request);
        expect.fail('Expected redirect to be thrown');
      } catch (error) {
        expect((error as Error).message).toBe('NEXT_REDIRECT;/home');
      }
    });

    it('should call exchangeCodeForSession with request and paths', async () => {
      const request = new Request(
        'http://localhost:3000/auth/callback?code=auth_code_123',
      ) as NextRequest;

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

    it('should create auth callback service with Supabase client', async () => {
      const request = new Request(
        'http://localhost:3000/auth/callback?code=auth_code_123',
      ) as NextRequest;

      try {
        await GET(request);
      } catch {
        // Expected redirect
      }

      expect(mockCreateAuthCallbackService).toHaveBeenCalledWith({});
    });
  });

  describe('Different redirect paths', () => {
    it('should redirect to custom next path', async () => {
      mockExchangeCodeForSession.mockResolvedValue({
        nextPath: '/dashboard',
      });

      const request = new Request(
        'http://localhost:3000/auth/callback?code=auth_code_123',
      ) as NextRequest;

      try {
        await GET(request);
      } catch (error) {
        expect((error as Error).message).toBe('NEXT_REDIRECT;/dashboard');
      }
    });

    it('should redirect to join team path for team invites', async () => {
      mockExchangeCodeForSession.mockResolvedValue({
        nextPath: '/join-team?invite_token=abc123',
      });

      const request = new Request(
        'http://localhost:3000/auth/callback?code=auth_code_123&invite_token=abc123',
      ) as NextRequest;

      try {
        await GET(request);
      } catch (error) {
        expect((error as Error).message).toBe(
          'NEXT_REDIRECT;/join-team?invite_token=abc123',
        );
      }
    });

    it('should redirect to next parameter if provided', async () => {
      mockExchangeCodeForSession.mockResolvedValue({
        nextPath: '/home/projects',
      });

      const request = new Request(
        'http://localhost:3000/auth/callback?code=auth_code_123&next=/home/projects',
      ) as NextRequest;

      try {
        await GET(request);
      } catch (error) {
        expect((error as Error).message).toBe('NEXT_REDIRECT;/home/projects');
      }
    });
  });

  describe('Query parameters handling', () => {
    it('should handle callback with OAuth code', async () => {
      const request = new Request(
        'http://localhost:3000/auth/callback?code=oauth_code_xyz789',
      ) as NextRequest;

      try {
        await GET(request);
      } catch {
        // Expected redirect
      }

      expect(mockExchangeCodeForSession).toHaveBeenCalledWith(
        request,
        expect.any(Object),
      );
    });

    it('should handle callback with state parameter', async () => {
      const request = new Request(
        'http://localhost:3000/auth/callback?code=auth_code_123&state=random_state',
      ) as NextRequest;

      try {
        await GET(request);
      } catch {
        // Expected redirect
      }

      expect(mockExchangeCodeForSession).toHaveBeenCalled();
    });

    it('should handle callback with error parameter', async () => {
      const request = new Request(
        'http://localhost:3000/auth/callback?error=access_denied',
      ) as NextRequest;

      try {
        await GET(request);
      } catch {
        // Expected redirect or error
      }

      expect(mockExchangeCodeForSession).toHaveBeenCalled();
    });

    it('should handle callback with multiple parameters', async () => {
      const request = new Request(
        'http://localhost:3000/auth/callback?code=auth_code_123&next=/dashboard&invite_token=xyz',
      ) as NextRequest;

      try {
        await GET(request);
      } catch {
        // Expected redirect
      }

      expect(mockExchangeCodeForSession).toHaveBeenCalled();
    });
  });

  describe('OAuth provider callbacks', () => {
    it('should handle Google OAuth callback', async () => {
      const request = new Request(
        'http://localhost:3000/auth/callback?code=google_auth_code&provider=google',
      ) as NextRequest;

      try {
        await GET(request);
      } catch {
        // Expected redirect
      }

      expect(mockExchangeCodeForSession).toHaveBeenCalled();
    });

    it('should handle GitHub OAuth callback', async () => {
      const request = new Request(
        'http://localhost:3000/auth/callback?code=github_auth_code&provider=github',
      ) as NextRequest;

      try {
        await GET(request);
      } catch {
        // Expected redirect
      }

      expect(mockExchangeCodeForSession).toHaveBeenCalled();
    });

    it('should handle other OAuth providers', async () => {
      const providers = ['facebook', 'twitter', 'github'];

      for (const provider of providers) {
        const request = new Request(
          `http://localhost:3000/auth/callback?code=auth_code_${provider}&provider=${provider}`,
        ) as NextRequest;

        try {
          await GET(request);
        } catch {
          // Expected redirect
        }

        expect(mockExchangeCodeForSession).toHaveBeenCalled();
      }

      vi.clearAllMocks();
    });
  });

  describe('Error handling', () => {
    it('should propagate errors from exchangeCodeForSession', async () => {
      mockExchangeCodeForSession.mockRejectedValue(
        new Error('Code exchange failed'),
      );

      const request = new Request(
        'http://localhost:3000/auth/callback?code=invalid_code',
      ) as NextRequest;

      await expect(GET(request)).rejects.toThrow('Code exchange failed');
    });

    it('should handle authentication errors', async () => {
      mockExchangeCodeForSession.mockRejectedValue(
        new Error('Invalid or expired code'),
      );

      const request = new Request(
        'http://localhost:3000/auth/callback?code=expired_code',
      ) as NextRequest;

      await expect(GET(request)).rejects.toThrow('Invalid or expired code');
    });

    it('should handle network errors', async () => {
      mockExchangeCodeForSession.mockRejectedValue(
        new Error('Network request failed'),
      );

      const request = new Request(
        'http://localhost:3000/auth/callback?code=auth_code_123',
      ) as NextRequest;

      await expect(GET(request)).rejects.toThrow('Network request failed');
    });
  });

  describe('Integration scenarios', () => {
    it('should handle password reset callback', async () => {
      mockExchangeCodeForSession.mockResolvedValue({
        nextPath: '/auth/reset-password',
      });

      const request = new Request(
        'http://localhost:3000/auth/callback?type=recovery&token=reset_token_123',
      ) as NextRequest;

      try {
        await GET(request);
      } catch (error) {
        expect((error as Error).message).toBe(
          'NEXT_REDIRECT;/auth/reset-password',
        );
      }
    });

    it('should handle email verification callback', async () => {
      mockExchangeCodeForSession.mockResolvedValue({
        nextPath: '/home',
      });

      const request = new Request(
        'http://localhost:3000/auth/callback?type=email&token=verify_token_123',
      ) as NextRequest;

      try {
        await GET(request);
      } catch {
        // Expected redirect
      }

      expect(mockExchangeCodeForSession).toHaveBeenCalled();
    });

    it('should handle magic link callback', async () => {
      mockExchangeCodeForSession.mockResolvedValue({
        nextPath: '/home',
      });

      const request = new Request(
        'http://localhost:3000/auth/callback?type=magiclink&token=magic_token_123',
      ) as NextRequest;

      try {
        await GET(request);
      } catch {
        // Expected redirect
      }

      expect(mockExchangeCodeForSession).toHaveBeenCalled();
    });

    it('should handle team invite acceptance', async () => {
      mockExchangeCodeForSession.mockResolvedValue({
        nextPath:
          '/join-team?invite_token=team_invite_123&email=test@example.com',
      });

      const request = new Request(
        'http://localhost:3000/auth/callback?code=auth_code_123&invite_token=team_invite_123&email=test@example.com',
      ) as NextRequest;

      try {
        await GET(request);
      } catch (error) {
        expect((error as Error).message).toContain('NEXT_REDIRECT;/join-team');
        expect((error as Error).message).toContain(
          'invite_token=team_invite_123',
        );
      }
    });
  });

  describe('Edge cases', () => {
    it('should handle callback without any query parameters', async () => {
      const request = new Request(
        'http://localhost:3000/auth/callback',
      ) as NextRequest;

      try {
        await GET(request);
      } catch {
        // Expected redirect or error
      }

      expect(mockExchangeCodeForSession).toHaveBeenCalled();
    });

    it('should handle very long query parameters', async () => {
      const longCode = 'a'.repeat(1000);

      const request = new Request(
        `http://localhost:3000/auth/callback?code=${longCode}`,
      ) as NextRequest;

      try {
        await GET(request);
      } catch {
        // Expected redirect
      }

      expect(mockExchangeCodeForSession).toHaveBeenCalled();
    });

    it('should handle special characters in query parameters', async () => {
      const request = new Request(
        'http://localhost:3000/auth/callback?next=/home?tab=settings&view=profile',
      ) as NextRequest;

      try {
        await GET(request);
      } catch {
        // Expected redirect
      }

      expect(mockExchangeCodeForSession).toHaveBeenCalled();
    });

    it('should handle URL-encoded query parameters', async () => {
      const request = new Request(
        'http://localhost:3000/auth/callback?next=%2Fhome%2Fprojects',
      ) as NextRequest;

      try {
        await GET(request);
      } catch {
        // Expected redirect
      }

      expect(mockExchangeCodeForSession).toHaveBeenCalled();
    });
  });

  describe('Concurrent callback handling', () => {
    it('should handle concurrent callback requests', async () => {
      const requests = Array.from({ length: 5 }, (_, i) =>
        GET(
          new Request(
            `http://localhost:3000/auth/callback?code=auth_code_${i}`,
          ) as NextRequest,
        ).catch(() => {
          // Expected redirect throws
        }),
      );

      await Promise.all(requests);

      expect(mockExchangeCodeForSession).toHaveBeenCalledTimes(5);
    });
  });
});
