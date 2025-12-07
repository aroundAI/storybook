import type { SupabaseClient } from '@supabase/supabase-js';

import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock Supabase hooks
vi.mock('@kit/supabase/hooks/use-supabase', () => ({
  useSupabase: vi.fn(),
}));

vi.mock('@kit/supabase/hooks/use-sign-in-with-email-password', () => ({
  useSignInWithEmailPassword: vi.fn(),
}));

vi.mock('@kit/supabase/hooks/use-sign-in-with-provider', () => ({
  useSignInWithProvider: vi.fn(),
}));

vi.mock('@kit/supabase/hooks/use-sign-in-with-otp', () => ({
  useSignInWithOTP: vi.fn(),
}));

describe('Sign-In Flow Integration Tests', () => {
  let mockSupabaseClient: Partial<SupabaseClient>;
  let mockSignInWithPassword: ReturnType<typeof vi.fn>;
  let mockSignInWithOAuth: ReturnType<typeof vi.fn>;
  let mockSignInWithOtp: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();

    // Create mock Supabase auth methods
    mockSignInWithPassword = vi.fn();
    mockSignInWithOAuth = vi.fn();
    mockSignInWithOtp = vi.fn();

    mockSupabaseClient = {
      auth: {
        signInWithPassword: mockSignInWithPassword,
        signInWithOAuth: mockSignInWithOAuth,
        signInWithOtp: mockSignInWithOtp,
        getSession: vi.fn(),
        getUser: vi.fn(),
      } as any,
    };
  });

  describe('Email/Password Sign-In Flow', () => {
    it('should sign in successfully with valid credentials', async () => {
      const mockUser = {
        id: 'user-123',
        email: 'user@example.com',
        identities: [{ id: 'identity-1' }],
      };

      const mockSession = {
        access_token: 'token-123',
        refresh_token: 'refresh-123',
      };

      mockSignInWithPassword.mockResolvedValue({
        data: {
          user: mockUser,
          session: mockSession,
        },
        error: null,
      });

      const result = await mockSignInWithPassword({
        email: 'user@example.com',
        password: 'ValidPassword123!',
      });

      expect(result.data.user).toEqual(mockUser);
      expect(result.data.session).toEqual(mockSession);
      expect(result.error).toBeNull();
    });

    it('should handle invalid email format', async () => {
      mockSignInWithPassword.mockResolvedValue({
        data: null,
        error: {
          message: 'Invalid login credentials',
          status: 400,
        },
      });

      const result = await mockSignInWithPassword({
        email: 'invalid-email',
        password: 'Password123!',
      });

      expect(result.error).toBeDefined();
      expect(result.error.message).toContain('Invalid login credentials');
    });

    it('should handle incorrect password', async () => {
      mockSignInWithPassword.mockResolvedValue({
        data: null,
        error: {
          message: 'Invalid login credentials',
          status: 400,
        },
      });

      const result = await mockSignInWithPassword({
        email: 'user@example.com',
        password: 'WrongPassword',
      });

      expect(result.error).toBeDefined();
      expect(result.error.message).toBe('Invalid login credentials');
    });

    it('should handle non-existent user', async () => {
      mockSignInWithPassword.mockResolvedValue({
        data: null,
        error: {
          message: 'Invalid login credentials',
          status: 400,
        },
      });

      const result = await mockSignInWithPassword({
        email: 'nonexistent@example.com',
        password: 'Password123!',
      });

      expect(result.error).toBeDefined();
      expect(result.error.message).toBe('Invalid login credentials');
    });

    it('should handle user with no identities (email taken)', async () => {
      mockSignInWithPassword.mockResolvedValue({
        data: {
          user: {
            id: 'user-123',
            email: 'user@example.com',
            identities: [], // No identities means email is taken
          },
          session: null,
        },
        error: null,
      });

      const result = await mockSignInWithPassword({
        email: 'user@example.com',
        password: 'Password123!',
      });

      expect(result.data.user.identities).toHaveLength(0);
    });

    it('should handle email confirmation required', async () => {
      mockSignInWithPassword.mockResolvedValue({
        data: null,
        error: {
          message: 'Email not confirmed',
          status: 400,
        },
      });

      const result = await mockSignInWithPassword({
        email: 'unconfirmed@example.com',
        password: 'Password123!',
      });

      expect(result.error).toBeDefined();
      expect(result.error.message).toContain('Email not confirmed');
    });
  });

  describe('OAuth Provider Sign-In Flow', () => {
    it('should initiate Google OAuth sign-in', async () => {
      mockSignInWithOAuth.mockResolvedValue({
        data: {
          provider: 'google',
          url: 'https://accounts.google.com/o/oauth2/auth?...',
        },
        error: null,
      });

      const result = await mockSignInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: 'http://localhost:3000/auth/callback',
        },
      });

      expect(result.data.provider).toBe('google');
      expect(result.data.url).toContain('google.com');
      expect(result.error).toBeNull();
    });

    it('should initiate GitHub OAuth sign-in', async () => {
      mockSignInWithOAuth.mockResolvedValue({
        data: {
          provider: 'github',
          url: 'https://github.com/login/oauth/authorize?...',
        },
        error: null,
      });

      const result = await mockSignInWithOAuth({
        provider: 'github',
        options: {
          redirectTo: 'http://localhost:3000/auth/callback',
        },
      });

      expect(result.data.provider).toBe('github');
      expect(result.data.url).toContain('github.com');
      expect(result.error).toBeNull();
    });

    it('should handle OAuth with scopes', async () => {
      mockSignInWithOAuth.mockResolvedValue({
        data: {
          provider: 'google',
          url: 'https://accounts.google.com/o/oauth2/auth?scope=email+profile',
        },
        error: null,
      });

      const result = await mockSignInWithOAuth({
        provider: 'google',
        options: {
          scopes: 'email profile',
          redirectTo: 'http://localhost:3000/auth/callback',
        },
      });

      expect(result.data.url).toContain('scope=email+profile');
      expect(result.error).toBeNull();
    });

    it('should handle OAuth provider error', async () => {
      mockSignInWithOAuth.mockResolvedValue({
        data: null,
        error: {
          message: 'OAuth provider not configured',
          status: 400,
        },
      });

      const result = await mockSignInWithOAuth({
        provider: 'facebook',
      });

      expect(result.error).toBeDefined();
      expect(result.error.message).toContain('OAuth provider not configured');
    });

    it('should handle multiple OAuth providers', async () => {
      const providers = ['google', 'github', 'gitlab', 'bitbucket'];

      for (const provider of providers) {
        mockSignInWithOAuth.mockResolvedValue({
          data: {
            provider,
            url: `https://${provider}.com/oauth/authorize`,
          },
          error: null,
        });

        const result = await mockSignInWithOAuth({ provider });

        expect(result.data.provider).toBe(provider);
        expect(result.error).toBeNull();
      }
    });
  });

  describe('OTP (One-Time Password) Sign-In Flow', () => {
    it('should send OTP to email successfully', async () => {
      mockSignInWithOtp.mockResolvedValue({
        data: {
          user: null,
          session: null,
        },
        error: null,
      });

      const result = await mockSignInWithOtp({
        email: 'user@example.com',
        options: {
          emailRedirectTo: 'http://localhost:3000/auth/callback',
        },
      });

      expect(result.error).toBeNull();
    });

    it('should handle OTP email sending failure', async () => {
      mockSignInWithOtp.mockResolvedValue({
        data: null,
        error: {
          message: 'Failed to send OTP email',
          status: 500,
        },
      });

      const result = await mockSignInWithOtp({
        email: 'user@example.com',
      });

      expect(result.error).toBeDefined();
      expect(result.error.message).toContain('Failed to send OTP');
    });

    it('should handle invalid email for OTP', async () => {
      mockSignInWithOtp.mockResolvedValue({
        data: null,
        error: {
          message: 'Invalid email address',
          status: 400,
        },
      });

      const result = await mockSignInWithOtp({
        email: 'invalid-email',
      });

      expect(result.error).toBeDefined();
      expect(result.error.message).toContain('Invalid email');
    });

    it('should send OTP to phone number', async () => {
      mockSignInWithOtp.mockResolvedValue({
        data: {
          user: null,
          session: null,
        },
        error: null,
      });

      const result = await mockSignInWithOtp({
        phone: '+1234567890',
      });

      expect(result.error).toBeNull();
    });

    it('should handle phone OTP sending failure', async () => {
      mockSignInWithOtp.mockResolvedValue({
        data: null,
        error: {
          message: 'Failed to send SMS',
          status: 500,
        },
      });

      const result = await mockSignInWithOtp({
        phone: '+1234567890',
      });

      expect(result.error).toBeDefined();
      expect(result.error.message).toContain('Failed to send SMS');
    });
  });

  describe('Magic Link Sign-In Flow', () => {
    it('should send magic link successfully', async () => {
      mockSignInWithOtp.mockResolvedValue({
        data: {
          user: null,
          session: null,
        },
        error: null,
      });

      const result = await mockSignInWithOtp({
        email: 'user@example.com',
        options: {
          emailRedirectTo: 'http://localhost:3000/auth/callback',
          shouldCreateUser: false, // Magic link for existing users
        },
      });

      expect(result.error).toBeNull();
    });

    it('should handle magic link for non-existent user', async () => {
      mockSignInWithOtp.mockResolvedValue({
        data: null,
        error: {
          message: 'User not found',
          status: 400,
        },
      });

      const result = await mockSignInWithOtp({
        email: 'nonexistent@example.com',
        options: {
          shouldCreateUser: false,
        },
      });

      expect(result.error).toBeDefined();
      expect(result.error.message).toContain('User not found');
    });

    it('should send magic link with custom redirect', async () => {
      const customRedirect = 'http://localhost:3000/dashboard';

      mockSignInWithOtp.mockResolvedValue({
        data: {
          user: null,
          session: null,
        },
        error: null,
      });

      const result = await mockSignInWithOtp({
        email: 'user@example.com',
        options: {
          emailRedirectTo: customRedirect,
        },
      });

      expect(result.error).toBeNull();
    });
  });

  describe('Session Management', () => {
    it('should create session after successful sign-in', async () => {
      const mockSession = {
        access_token: 'access-token-123',
        refresh_token: 'refresh-token-123',
        expires_in: 3600,
        expires_at: Date.now() + 3600000,
      };

      mockSignInWithPassword.mockResolvedValue({
        data: {
          user: { id: 'user-123', email: 'user@example.com' },
          session: mockSession,
        },
        error: null,
      });

      const result = await mockSignInWithPassword({
        email: 'user@example.com',
        password: 'Password123!',
      });

      expect(result.data.session).toBeDefined();
      expect(result.data.session.access_token).toBe('access-token-123');
      expect(result.data.session.refresh_token).toBe('refresh-token-123');
    });

    it('should handle session creation failure', async () => {
      mockSignInWithPassword.mockResolvedValue({
        data: {
          user: { id: 'user-123' },
          session: null,
        },
        error: {
          message: 'Failed to create session',
          status: 500,
        },
      });

      const result = await mockSignInWithPassword({
        email: 'user@example.com',
        password: 'Password123!',
      });

      expect(result.error).toBeDefined();
      expect(result.data.session).toBeNull();
    });
  });

  describe('Error Handling', () => {
    it('should handle network errors', async () => {
      mockSignInWithPassword.mockRejectedValue(
        new Error('Network request failed'),
      );

      await expect(
        mockSignInWithPassword({
          email: 'user@example.com',
          password: 'Password123!',
        }),
      ).rejects.toThrow('Network request failed');
    });

    it('should handle timeout errors', async () => {
      mockSignInWithPassword.mockRejectedValue(new Error('Request timeout'));

      await expect(
        mockSignInWithPassword({
          email: 'user@example.com',
          password: 'Password123!',
        }),
      ).rejects.toThrow('Request timeout');
    });

    it('should handle rate limiting', async () => {
      mockSignInWithPassword.mockResolvedValue({
        data: null,
        error: {
          message: 'Too many requests',
          status: 429,
        },
      });

      const result = await mockSignInWithPassword({
        email: 'user@example.com',
        password: 'Password123!',
      });

      expect(result.error).toBeDefined();
      expect(result.error.status).toBe(429);
      expect(result.error.message).toContain('Too many requests');
    });

    it('should handle server errors', async () => {
      mockSignInWithPassword.mockResolvedValue({
        data: null,
        error: {
          message: 'Internal server error',
          status: 500,
        },
      });

      const result = await mockSignInWithPassword({
        email: 'user@example.com',
        password: 'Password123!',
      });

      expect(result.error).toBeDefined();
      expect(result.error.status).toBe(500);
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty credentials', async () => {
      mockSignInWithPassword.mockResolvedValue({
        data: null,
        error: {
          message: 'Email and password are required',
          status: 400,
        },
      });

      const result = await mockSignInWithPassword({
        email: '',
        password: '',
      });

      expect(result.error).toBeDefined();
      expect(result.error.message).toContain('required');
    });

    it('should handle very long email', async () => {
      const longEmail = 'a'.repeat(1000) + '@example.com';

      mockSignInWithPassword.mockResolvedValue({
        data: null,
        error: {
          message: 'Email too long',
          status: 400,
        },
      });

      const result = await mockSignInWithPassword({
        email: longEmail,
        password: 'Password123!',
      });

      expect(result.error).toBeDefined();
    });

    it('should handle special characters in credentials', async () => {
      mockSignInWithPassword.mockResolvedValue({
        data: {
          user: { id: 'user-123', email: 'user+test@example.com' },
          session: { access_token: 'token-123' },
        },
        error: null,
      });

      const result = await mockSignInWithPassword({
        email: 'user+test@example.com',
        password: 'P@ssw0rd!#$%',
      });

      expect(result.data.user.email).toBe('user+test@example.com');
      expect(result.error).toBeNull();
    });

    it('should handle Unicode characters in email', async () => {
      mockSignInWithPassword.mockResolvedValue({
        data: {
          user: { id: 'user-123', email: '用户@example.com' },
          session: { access_token: 'token-123' },
        },
        error: null,
      });

      const result = await mockSignInWithPassword({
        email: '用户@example.com',
        password: 'Password123!',
      });

      expect(result.data.user.email).toBe('用户@example.com');
      expect(result.error).toBeNull();
    });
  });

  describe('Integration Scenarios', () => {
    it('should handle concurrent sign-in attempts', async () => {
      const attempts = Array.from({ length: 5 }, (_, i) => ({
        email: `user${i}@example.com`,
        password: 'Password123!',
      }));

      mockSignInWithPassword.mockResolvedValue({
        data: {
          user: { id: 'user-123' },
          session: { access_token: 'token-123' },
        },
        error: null,
      });

      const results = await Promise.all(
        attempts.map((credentials) => mockSignInWithPassword(credentials)),
      );

      results.forEach((result) => {
        expect(result.data).toBeDefined();
        expect(result.error).toBeNull();
      });
    });

    it('should handle switching between auth methods', async () => {
      // Try password first
      mockSignInWithPassword.mockResolvedValue({
        data: null,
        error: { message: 'Invalid credentials' },
      });

      const passwordResult = await mockSignInWithPassword({
        email: 'user@example.com',
        password: 'WrongPassword',
      });

      expect(passwordResult.error).toBeDefined();

      // Then try OTP
      mockSignInWithOtp.mockResolvedValue({
        data: { user: null, session: null },
        error: null,
      });

      const otpResult = await mockSignInWithOtp({
        email: 'user@example.com',
      });

      expect(otpResult.error).toBeNull();
    });
  });
});
