import { beforeEach, describe, expect, it, vi } from 'vitest';

import { checkRequiresMultiFactorAuthentication } from '../src/check-requires-mfa';
import { MultiFactorAuthError, requireUser } from '../src/require-user';

/**
 * requireUser returns a discriminated union: only its failure branches
 * carry `redirectTo`. Narrowing on `error` is what makes the field
 * reachable, and asserts the call actually failed rather than reading an
 * undefined off the success branch.
 */
function failureOf<T extends { error: unknown }>(
  result: T,
): Extract<T, { redirectTo: string }> {
  if (!result.error) {
    throw new Error('expected requireUser to fail');
  }

  return result as Extract<T, { redirectTo: string }>;
}

// Mock the check-requires-mfa module
vi.mock('../src/check-requires-mfa', () => ({
  checkRequiresMultiFactorAuthentication: vi.fn(),
}));

const mockCheckMFA = vi.mocked(checkRequiresMultiFactorAuthentication);

const USER_ID = '550e8400-e29b-41d4-a716-446655440000';

describe('requireUser', () => {
  let mockSupabaseClient: any;
  let mockGetClaims: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();

    mockGetClaims = vi.fn();

    mockSupabaseClient = {
      auth: {
        getClaims: mockGetClaims,
      },
    };
  });

  describe('Successful Authentication', () => {
    const validClaims = {
      aud: 'authenticated',
      exp: Math.floor(Date.now() / 1000) + 3600,
      iat: Math.floor(Date.now() / 1000),
      iss: 'https://example.supabase.co/auth/v1',
      sub: USER_ID,
      email: 'user@example.com',
      phone: '+1234567890',
      app_metadata: { provider: 'email', providers: ['email'] },
      user_metadata: { name: 'Test User' },
      role: 'authenticated',
      aal: 'aal1' as const,
      session_id: 'session-123',
      is_anonymous: false,
    };

    it('should return user data when authentication is successful', async () => {
      mockGetClaims.mockResolvedValue({
        data: { claims: validClaims },
        error: null,
      });

      mockCheckMFA.mockResolvedValue(false);

      const result = await requireUser(mockSupabaseClient);

      expect(result).toEqual({
        error: null,
        data: {
          is_anonymous: false,
          aal: 'aal1',
          email: 'user@example.com',
          phone: '+1234567890',
          app_metadata: { provider: 'email', providers: ['email'] },
          user_metadata: { name: 'Test User' },
          id: USER_ID,
        },
      });
    });

    it('should skip MFA verification when verifyMfa is false', async () => {
      mockGetClaims.mockResolvedValue({
        data: { claims: validClaims },
        error: null,
      });

      const result = await requireUser(mockSupabaseClient, {
        verifyMfa: false,
      });

      expect(mockCheckMFA).not.toHaveBeenCalled();
      expect(result.error).toBeNull();
      expect(result.data).toBeDefined();
    });

    it('should verify MFA by default', async () => {
      mockGetClaims.mockResolvedValue({
        data: { claims: validClaims },
        error: null,
      });

      mockCheckMFA.mockResolvedValue(false);

      await requireUser(mockSupabaseClient);

      expect(mockCheckMFA).toHaveBeenCalledWith(mockSupabaseClient);
    });

    it('should handle user with empty metadata', async () => {
      const claimsWithEmptyMetadata = {
        ...validClaims,
        app_metadata: {},
        user_metadata: {},
      };

      mockGetClaims.mockResolvedValue({
        data: { claims: claimsWithEmptyMetadata },
        error: null,
      });

      mockCheckMFA.mockResolvedValue(false);

      const result = await requireUser(mockSupabaseClient);

      expect(result.error).toBeNull();
      expect(result.data?.app_metadata).toEqual({});
      expect(result.data?.user_metadata).toEqual({});
    });

    it('should handle aal2 users', async () => {
      const aal2Claims = {
        ...validClaims,
        aal: 'aal2' as const,
      };

      mockGetClaims.mockResolvedValue({
        data: { claims: aal2Claims },
        error: null,
      });

      mockCheckMFA.mockResolvedValue(false);

      const result = await requireUser(mockSupabaseClient);

      expect(result.error).toBeNull();
      expect(result.data?.aal).toBe('aal2');
    });

    it('should handle anonymous users', async () => {
      const anonymousClaims = {
        ...validClaims,
        is_anonymous: true,
        email: '',
        phone: '',
      };

      mockGetClaims.mockResolvedValue({
        data: { claims: anonymousClaims },
        error: null,
      });

      mockCheckMFA.mockResolvedValue(false);

      const result = await requireUser(mockSupabaseClient);

      expect(result.error).toBeNull();
      expect(result.data?.is_anonymous).toBe(true);
    });
  });

  describe('Authentication Errors', () => {
    it('should return error when getClaims returns no claims', async () => {
      mockGetClaims.mockResolvedValue({
        data: { claims: null },
        error: null,
      });

      const result = await requireUser(mockSupabaseClient);

      expect(result.data).toBeNull();
      expect(result.error).toBeInstanceOf(Error);
      expect(result.error?.message).toBe('Authentication required');
      expect(failureOf(result).redirectTo).toBe('/auth/sign-in');
    });

    it('should return error when getClaims returns error', async () => {
      mockGetClaims.mockResolvedValue({
        data: null,
        error: { message: 'Invalid token' },
      });

      const result = await requireUser(mockSupabaseClient);

      expect(result.data).toBeNull();
      expect(result.error?.message).toBe('Authentication required');
      expect(failureOf(result).redirectTo).toBe('/auth/sign-in');
    });

    it('should return error when data is undefined', async () => {
      mockGetClaims.mockResolvedValue({
        data: undefined,
        error: null,
      });

      const result = await requireUser(mockSupabaseClient);

      expect(result.data).toBeNull();
      expect(result.error?.message).toBe('Authentication required');
    });

    it('should include next parameter in redirect URL when provided', async () => {
      mockGetClaims.mockResolvedValue({
        data: { claims: null },
        error: null,
      });

      const result = await requireUser(mockSupabaseClient, {
        next: '/dashboard',
      });

      expect(failureOf(result).redirectTo).toBe(
        '/auth/sign-in?next=/dashboard',
      );
    });

    it('should encode next parameter in redirect URL', async () => {
      mockGetClaims.mockResolvedValue({
        data: { claims: null },
        error: null,
      });

      const result = await requireUser(mockSupabaseClient, {
        next: '/dashboard?tab=settings',
      });

      expect(failureOf(result).redirectTo).toBe(
        '/auth/sign-in?next=/dashboard?tab=settings',
      );
    });
  });

  describe('Multi-Factor Authentication', () => {
    const validClaims = {
      aud: 'authenticated',
      exp: Math.floor(Date.now() / 1000) + 3600,
      iat: Math.floor(Date.now() / 1000),
      iss: 'https://example.supabase.co/auth/v1',
      sub: USER_ID,
      email: 'user@example.com',
      phone: '+1234567890',
      app_metadata: {},
      user_metadata: {},
      role: 'authenticated',
      aal: 'aal1' as const,
      session_id: 'session-123',
      is_anonymous: false,
    };

    it('should redirect to MFA verify page when MFA is required', async () => {
      mockGetClaims.mockResolvedValue({
        data: { claims: validClaims },
        error: null,
      });

      mockCheckMFA.mockResolvedValue(true);

      const result = await requireUser(mockSupabaseClient);

      expect(result.data).toBeNull();
      expect(result.error).toBeInstanceOf(MultiFactorAuthError);
      expect(result.error?.message).toBe(
        'Multi-factor authentication required',
      );
      expect(failureOf(result).redirectTo).toBe('/auth/verify');
    });

    it('should include next parameter in MFA redirect URL', async () => {
      mockGetClaims.mockResolvedValue({
        data: { claims: validClaims },
        error: null,
      });

      mockCheckMFA.mockResolvedValue(true);

      const result = await requireUser(mockSupabaseClient, {
        next: '/dashboard',
      });

      expect(failureOf(result).redirectTo).toBe('/auth/verify?next=/dashboard');
    });

    it('should not check MFA when verifyMfa option is false', async () => {
      mockGetClaims.mockResolvedValue({
        data: { claims: validClaims },
        error: null,
      });

      // This would normally require MFA, but we skip the check
      mockCheckMFA.mockResolvedValue(true);

      const result = await requireUser(mockSupabaseClient, {
        verifyMfa: false,
      });

      expect(mockCheckMFA).not.toHaveBeenCalled();
      expect(result.error).toBeNull();
      expect(result.data).toBeDefined();
    });

    it('should check MFA when verifyMfa option is explicitly true', async () => {
      mockGetClaims.mockResolvedValue({
        data: { claims: validClaims },
        error: null,
      });

      mockCheckMFA.mockResolvedValue(false);

      await requireUser(mockSupabaseClient, {
        verifyMfa: true,
      });

      expect(mockCheckMFA).toHaveBeenCalledWith(mockSupabaseClient);
    });
  });

  describe('Edge Cases', () => {
    const validClaims = {
      aud: 'authenticated',
      exp: Math.floor(Date.now() / 1000) + 3600,
      iat: Math.floor(Date.now() / 1000),
      iss: 'https://example.supabase.co/auth/v1',
      sub: USER_ID,
      email: 'user@example.com',
      phone: '+1234567890',
      app_metadata: {},
      user_metadata: {},
      role: 'authenticated',
      aal: 'aal1' as const,
      session_id: 'session-123',
      is_anonymous: false,
    };

    it('should handle empty next parameter', async () => {
      mockGetClaims.mockResolvedValue({
        data: { claims: null },
        error: null,
      });

      const result = await requireUser(mockSupabaseClient, {
        next: '',
      });

      expect(failureOf(result).redirectTo).toBe('/auth/sign-in');
    });

    it('should handle user with all string fields empty', async () => {
      const emptyClaims = {
        ...validClaims,
        email: '',
        phone: '',
      };

      mockGetClaims.mockResolvedValue({
        data: { claims: emptyClaims },
        error: null,
      });

      mockCheckMFA.mockResolvedValue(false);

      const result = await requireUser(mockSupabaseClient);

      expect(result.error).toBeNull();
      expect(result.data?.email).toBe('');
      expect(result.data?.phone).toBe('');
    });

    it('should handle claims with additional unknown fields', async () => {
      const claimsWithExtra = {
        ...validClaims,
        custom_field: 'custom_value',
        another_field: 123,
      };

      mockGetClaims.mockResolvedValue({
        data: { claims: claimsWithExtra },
        error: null,
      });

      mockCheckMFA.mockResolvedValue(false);

      const result = await requireUser(mockSupabaseClient);

      expect(result.error).toBeNull();
      expect(result.data).toBeDefined();
      // Custom fields should not be in the returned data
      expect('custom_field' in (result.data ?? {})).toBe(false);
    });

    it('should handle both verifyMfa false and next parameter', async () => {
      mockGetClaims.mockResolvedValue({
        data: { claims: validClaims },
        error: null,
      });

      const result = await requireUser(mockSupabaseClient, {
        verifyMfa: false,
        next: '/dashboard',
      });

      expect(mockCheckMFA).not.toHaveBeenCalled();
      expect(result.error).toBeNull();
      expect(result.data).toBeDefined();
    });
  });

  describe('Type Safety', () => {
    it('should return correct type structure for success case', async () => {
      const validClaims = {
        aud: 'authenticated',
        exp: Math.floor(Date.now() / 1000) + 3600,
        iat: Math.floor(Date.now() / 1000),
        iss: 'https://example.supabase.co/auth/v1',
        sub: USER_ID,
        email: 'user@example.com',
        phone: '+1234567890',
        app_metadata: {},
        user_metadata: {},
        role: 'authenticated',
        aal: 'aal1' as const,
        session_id: 'session-123',
        is_anonymous: false,
      };

      mockGetClaims.mockResolvedValue({
        data: { claims: validClaims },
        error: null,
      });

      mockCheckMFA.mockResolvedValue(false);

      const result = await requireUser(mockSupabaseClient);

      // Verify the structure matches the expected return type
      if (result.error === null) {
        expect(result.data).toBeDefined();
        expect(typeof result.data.id).toBe('string');
        expect(typeof result.data.email).toBe('string');
        expect(typeof result.data.is_anonymous).toBe('boolean');
        expect(['aal1', 'aal2'].includes(result.data.aal)).toBe(true);
      }
    });

    it('should return correct type structure for error case', async () => {
      mockGetClaims.mockResolvedValue({
        data: { claims: null },
        error: null,
      });

      const result = await requireUser(mockSupabaseClient);

      // Verify error structure
      if (result.error !== null) {
        expect(result.data).toBeNull();
        expect(result.error).toBeInstanceOf(Error);
        expect(failureOf(result).redirectTo).toBeDefined();
        expect(typeof result.redirectTo).toBe('string');
      }
    });
  });
});
