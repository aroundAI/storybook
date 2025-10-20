import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createAuthCallbackService } from '../src/auth-callback.service';

describe('AuthCallbackService', () => {
  let mockSupabaseClient: {
    auth: {
      verifyOtp: ReturnType<typeof vi.fn>;
      exchangeCodeForSession: ReturnType<typeof vi.fn>;
    };
  };

  let mockRequest: Request;
  let service: ReturnType<typeof createAuthCallbackService>;

  beforeEach(() => {
    // Reset mocks
    vi.clearAllMocks();

    // Reset console.error spy
    vi.spyOn(console, 'error').mockImplementation(() => {});

    // Create mock Supabase client
    mockSupabaseClient = {
      auth: {
        verifyOtp: vi.fn().mockResolvedValue({ data: {}, error: null }),
        exchangeCodeForSession: vi
          .fn()
          .mockResolvedValue({ data: {}, error: null }),
      },
    };

    // Create service instance
    service = createAuthCallbackService(mockSupabaseClient as any);

    // Create mock request
    mockRequest = new Request('https://example.com/auth/callback');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('verifyTokenHash', () => {
    const params = {
      joinTeamPath: '/join',
      redirectPath: '/dashboard',
      errorPath: '/error',
    };

    describe('successful verification', () => {
      it('should verify OTP and return redirect URL', async () => {
        const request = new Request(
          'https://example.com/callback?token_hash=abc123&type=email',
        );

        const result = await service.verifyTokenHash(request, params);

        expect(mockSupabaseClient.auth.verifyOtp).toHaveBeenCalledWith({
          type: 'email',
          token_hash: 'abc123',
        });

        expect(result.pathname).toBe('/dashboard');
        expect(result.searchParams.has('token_hash')).toBe(false);
        expect(result.searchParams.has('type')).toBe(false);
      });

      it('should use next parameter for redirect path', async () => {
        const request = new Request(
          'https://example.com/callback?token_hash=abc123&type=email&next=https://example.com/profile',
        );

        const result = await service.verifyTokenHash(request, params);

        expect(result.pathname).toBe('/profile');
      });

      it('should handle callback parameter with next path', async () => {
        const request = new Request(
          'https://example.com/callback?token_hash=abc123&type=email&callback=https://example.com/settings?next=/account',
        );

        const result = await service.verifyTokenHash(request, params);

        expect(result.pathname).toBe('/account');
      });
    });

    describe('team invite handling', () => {
      it('should redirect to join team path with invite token', async () => {
        const request = new Request(
          'https://example.com/callback?token_hash=abc123&type=email&callback=https://example.com?invite_token=invite123&email=user@example.com',
        );

        const result = await service.verifyTokenHash(request, params);

        expect(result.pathname).toBe('/join');
        expect(result.searchParams.get('invite_token')).toBe('invite123');
        expect(result.searchParams.get('email')).toBe('user@example.com');
      });

      it('should handle invite token without email', async () => {
        const request = new Request(
          'https://example.com/callback?token_hash=abc123&type=email&callback=https://example.com?invite_token=invite123',
        );

        const result = await service.verifyTokenHash(request, params);

        expect(result.pathname).toBe('/join');
        expect(result.searchParams.get('invite_token')).toBe('invite123');
        expect(result.searchParams.has('email')).toBe(false);
      });
    });

    describe('error handling', () => {
      it('should redirect to error page on verification failure', async () => {
        mockSupabaseClient.auth.verifyOtp.mockResolvedValueOnce({
          data: null,
          error: {
            message: 'Invalid OTP',
            code: 'otp_invalid',
          },
        });

        const request = new Request(
          'https://example.com/callback?token_hash=abc123&type=email',
        );

        const result = await service.verifyTokenHash(request, params);

        expect(result.pathname).toBe('/error');
        expect(result.searchParams.has('error')).toBe(true);
        expect(result.searchParams.get('code')).toBe('otp_invalid');
      });

      it('should handle OTP expired error', async () => {
        mockSupabaseClient.auth.verifyOtp.mockResolvedValueOnce({
          data: null,
          error: {
            message: 'OTP has expired',
            code: 'otp_expired',
          },
        });

        const request = new Request(
          'https://example.com/callback?token_hash=abc123&type=email',
        );

        const result = await service.verifyTokenHash(request, params);

        expect(result.pathname).toBe('/error');
        expect(result.searchParams.get('error')).toBe('auth:errors.otp_expired');
      });

      it('should redirect to error page when token_hash is missing', async () => {
        const request = new Request(
          'https://example.com/callback?type=email',
        );

        const result = await service.verifyTokenHash(request, params);

        expect(result.pathname).toBe('/error');
        expect(mockSupabaseClient.auth.verifyOtp).not.toHaveBeenCalled();
      });

      it('should redirect to error page when type is missing', async () => {
        const request = new Request(
          'https://example.com/callback?token_hash=abc123',
        );

        const result = await service.verifyTokenHash(request, params);

        expect(result.pathname).toBe('/error');
        expect(mockSupabaseClient.auth.verifyOtp).not.toHaveBeenCalled();
      });

      it('should use default error path when not provided', async () => {
        const paramsWithoutErrorPath = {
          joinTeamPath: '/join',
          redirectPath: '/dashboard',
        };

        const request = new Request(
          'https://example.com/callback?type=email',
        );

        const result = await service.verifyTokenHash(
          request,
          paramsWithoutErrorPath,
        );

        expect(result.pathname).toBe('/auth/callback/error');
      });
    });

    describe('localhost development handling', () => {
      it('should adjust URL host for localhost development', async () => {
        const requestWithLocalhost = {
          url: 'http://localhost:3000/callback?token_hash=abc123&type=email',
          headers: new Headers({ host: 'example.com' }),
        } as Request;

        const result = await service.verifyTokenHash(
          requestWithLocalhost,
          params,
        );

        expect(result.host).toBe('example.com');
      });

      it('should not adjust URL when host is already correct', async () => {
        const request = new Request(
          'https://example.com/callback?token_hash=abc123&type=email',
        );

        const result = await service.verifyTokenHash(request, params);

        expect(result.host).toBe('example.com');
      });
    });

    describe('OTP types', () => {
      it('should handle email OTP type', async () => {
        const request = new Request(
          'https://example.com/callback?token_hash=abc123&type=email',
        );

        await service.verifyTokenHash(request, params);

        expect(mockSupabaseClient.auth.verifyOtp).toHaveBeenCalledWith({
          type: 'email',
          token_hash: 'abc123',
        });
      });

      it('should handle signup OTP type', async () => {
        const request = new Request(
          'https://example.com/callback?token_hash=abc123&type=signup',
        );

        await service.verifyTokenHash(request, params);

        expect(mockSupabaseClient.auth.verifyOtp).toHaveBeenCalledWith({
          type: 'signup',
          token_hash: 'abc123',
        });
      });

      it('should handle recovery OTP type', async () => {
        const request = new Request(
          'https://example.com/callback?token_hash=abc123&type=recovery',
        );

        await service.verifyTokenHash(request, params);

        expect(mockSupabaseClient.auth.verifyOtp).toHaveBeenCalledWith({
          type: 'recovery',
          token_hash: 'abc123',
        });
      });
    });
  });

  describe('exchangeCodeForSession', () => {
    const params = {
      joinTeamPath: '/join',
      redirectPath: '/dashboard',
      errorPath: '/error',
    };

    describe('successful code exchange', () => {
      it('should exchange auth code for session', async () => {
        const request = new Request(
          'https://example.com/callback?code=auth_code_123',
        );

        const result = await service.exchangeCodeForSession(request, params);

        expect(
          mockSupabaseClient.auth.exchangeCodeForSession,
        ).toHaveBeenCalledWith('auth_code_123');
        expect(result.nextPath).toBe('/dashboard');
      });

      it('should use next parameter for redirect', async () => {
        const request = new Request(
          'https://example.com/callback?code=auth_code_123&next=/profile',
        );

        const result = await service.exchangeCodeForSession(request, params);

        expect(result.nextPath).toBe('/profile');
      });

      it('should not call exchangeCodeForSession when code is missing', async () => {
        const request = new Request('https://example.com/callback');

        const result = await service.exchangeCodeForSession(request, params);

        expect(
          mockSupabaseClient.auth.exchangeCodeForSession,
        ).not.toHaveBeenCalled();
        expect(result.nextPath).toBe('/dashboard');
      });
    });

    describe('team invite handling', () => {
      it('should redirect to join team path with invite token', async () => {
        const request = new Request(
          'https://example.com/callback?code=auth_code_123&invite_token=invite123&email=user@example.com',
        );

        const result = await service.exchangeCodeForSession(request, params);

        expect(result.nextPath).toContain('/join');
        expect(result.nextPath).toContain('invite_token=invite123');
        expect(result.nextPath).toContain('email=user%40example.com');
      });

      it('should handle invite token without email', async () => {
        const request = new Request(
          'https://example.com/callback?code=auth_code_123&invite_token=invite123',
        );

        const result = await service.exchangeCodeForSession(request, params);

        expect(result.nextPath).toContain('/join');
        expect(result.nextPath).toContain('invite_token=invite123');
        expect(result.nextPath).toContain('email=');
      });
    });

    describe('error handling', () => {
      it('should redirect to error page on exchange failure', async () => {
        mockSupabaseClient.auth.exchangeCodeForSession.mockResolvedValueOnce({
          data: null,
          error: {
            message: 'Invalid auth code',
            code: 'invalid_code',
          },
        });

        const request = new Request(
          'https://example.com/callback?code=auth_code_123',
        );

        const result = await service.exchangeCodeForSession(request, params);

        expect(result.nextPath).toContain('/error');
        expect(result.nextPath).toContain('error=');
        expect(result.nextPath).toContain('code=invalid_code');
      });

      it('should handle error parameter in URL', async () => {
        const request = new Request(
          'https://example.com/callback?error=access_denied',
        );

        const result = await service.exchangeCodeForSession(request, params);

        expect(result.nextPath).toContain('/error');
        expect(result.nextPath).toContain('error=');
      });

      it('should handle exception during code exchange', async () => {
        mockSupabaseClient.auth.exchangeCodeForSession.mockRejectedValueOnce(
          new Error('Network error'),
        );

        const request = new Request(
          'https://example.com/callback?code=auth_code_123',
        );

        const result = await service.exchangeCodeForSession(request, params);

        expect(result.nextPath).toContain('/error');
        expect(console.error).toHaveBeenCalled();
      });

      it('should use default error path when not provided', async () => {
        const paramsWithoutErrorPath = {
          joinTeamPath: '/join',
          redirectPath: '/dashboard',
        };

        const request = new Request(
          'https://example.com/callback?error=access_denied',
        );

        const result = await service.exchangeCodeForSession(
          request,
          paramsWithoutErrorPath,
        );

        expect(result.nextPath).toContain('/auth/callback/error');
      });

      it('should handle code verifier mismatch error', async () => {
        mockSupabaseClient.auth.exchangeCodeForSession.mockResolvedValueOnce({
          data: null,
          error: {
            message:
              'both auth code and code verifier should be non-empty',
            code: 'auth_code_verifier_error',
          },
        });

        const request = new Request(
          'https://example.com/callback?code=auth_code_123',
        );

        const result = await service.exchangeCodeForSession(request, params);

        expect(result.nextPath).toContain('/error');
        // Error message is URL-encoded in the query string
        expect(decodeURIComponent(result.nextPath)).toContain(
          'auth:errors.codeVerifierMismatch',
        );
      });

      it('should handle OTP expired error in code exchange', async () => {
        mockSupabaseClient.auth.exchangeCodeForSession.mockResolvedValueOnce({
          data: null,
          error: {
            message: 'OTP expired',
            code: 'otp_expired',
          },
        });

        const request = new Request(
          'https://example.com/callback?code=auth_code_123',
        );

        const result = await service.exchangeCodeForSession(request, params);

        expect(result.nextPath).toContain('/error');
        // Error message is URL-encoded in the query string
        expect(decodeURIComponent(result.nextPath)).toContain(
          'auth:errors.otp_expired',
        );
      });
    });

    describe('edge cases', () => {
      it('should handle empty search params', async () => {
        const request = new Request('https://example.com/callback');

        const result = await service.exchangeCodeForSession(request, params);

        expect(result.nextPath).toBe('/dashboard');
      });

      it('should handle multiple error scenarios', async () => {
        const request = new Request(
          'https://example.com/callback?error=access_denied&code=should_be_ignored',
        );

        // Error parameter takes precedence
        const result = await service.exchangeCodeForSession(request, params);

        expect(result.nextPath).toContain('/error');
        expect(result.nextPath).toContain('error=');
      });

      it('should log errors with proper context', async () => {
        mockSupabaseClient.auth.exchangeCodeForSession.mockRejectedValueOnce(
          new Error('Test error'),
        );

        const request = new Request(
          'https://example.com/callback?code=auth_code_123',
        );

        await service.exchangeCodeForSession(request, params);

        expect(console.error).toHaveBeenCalledWith(
          expect.objectContaining({
            error: expect.any(Error),
            name: 'auth.callback',
          }),
          'An error occurred while exchanging code for session',
        );
      });
    });
  });

  describe('service creation', () => {
    it('should create service instance with client', () => {
      const service = createAuthCallbackService(mockSupabaseClient as any);

      expect(service).toBeDefined();
      expect(typeof service.verifyTokenHash).toBe('function');
      expect(typeof service.exchangeCodeForSession).toBe('function');
    });
  });
});
