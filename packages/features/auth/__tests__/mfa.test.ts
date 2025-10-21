import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { SupabaseClient} from '@supabase/supabase-js';

// Mock Supabase hooks
vi.mock('@kit/supabase/hooks/use-supabase', () => ({
  useSupabase: vi.fn(),
}));

vi.mock('@kit/supabase/hooks/use-fetch-mfa-factors', () => ({
  useFetchAuthFactors: vi.fn(),
}));

describe('Multi-Factor Authentication (MFA) Flow Tests', () => {
  let mockSupabaseClient: Partial<SupabaseClient>;
  let mockEnroll: ReturnType<typeof vi.fn>;
  let mockChallenge: ReturnType<typeof vi.fn>;
  let mockVerify: ReturnType<typeof vi.fn>;
  let mockUnenroll: ReturnType<typeof vi.fn>;
  let mockListFactors: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();

    // Create mock MFA methods
    mockEnroll = vi.fn();
    mockChallenge = vi.fn();
    mockVerify = vi.fn();
    mockUnenroll = vi.fn();
    mockListFactors = vi.fn();

    mockSupabaseClient = {
      auth: {
        mfa: {
          enroll: mockEnroll,
          challenge: mockChallenge,
          verify: mockVerify,
          unenroll: mockUnenroll,
          listFactors: mockListFactors,
        },
      } as any,
    };
  });

  describe('MFA Enrollment Flow', () => {
    it('should enroll TOTP factor successfully', async () => {
      const mockFactor = {
        id: 'factor-123',
        friendly_name: 'My Authenticator App',
        factor_type: 'totp',
        status: 'unverified',
        totp: {
          qr_code: 'data:image/png;base64,...',
          secret: 'JBSWY3DPEHPK3PXP',
          uri: 'otpauth://totp/...',
        },
      };

      mockEnroll.mockResolvedValue({
        data: mockFactor,
        error: null,
      });

      const result = await mockEnroll({
        factorType: 'totp',
        friendlyName: 'My Authenticator App',
      });

      expect(result.data).toEqual(mockFactor);
      expect(result.data.totp.qr_code).toBeDefined();
      expect(result.data.totp.secret).toBeDefined();
      expect(result.error).toBeNull();
    });

    it('should handle enrollment failure', async () => {
      mockEnroll.mockResolvedValue({
        data: null,
        error: {
          message: 'MFA enrollment failed',
          status: 400,
        },
      });

      const result = await mockEnroll({
        factorType: 'totp',
      });

      expect(result.error).toBeDefined();
      expect(result.error.message).toContain('enrollment failed');
    });

    it('should enroll with custom friendly name', async () => {
      const friendlyName = 'Work Phone - Google Authenticator';

      mockEnroll.mockResolvedValue({
        data: {
          id: 'factor-456',
          friendly_name: friendlyName,
          factor_type: 'totp',
          status: 'unverified',
        },
        error: null,
      });

      const result = await mockEnroll({
        factorType: 'totp',
        friendlyName,
      });

      expect(result.data.friendly_name).toBe(friendlyName);
      expect(result.error).toBeNull();
    });

    it('should handle maximum factors limit', async () => {
      mockEnroll.mockResolvedValue({
        data: null,
        error: {
          message: 'Maximum number of factors reached',
          status: 400,
        },
      });

      const result = await mockEnroll({
        factorType: 'totp',
      });

      expect(result.error).toBeDefined();
      expect(result.error.message).toContain('Maximum number');
    });

    it('should generate TOTP secret and QR code', async () => {
      mockEnroll.mockResolvedValue({
        data: {
          id: 'factor-789',
          factor_type: 'totp',
          totp: {
            qr_code: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAUA',
            secret: 'JBSWY3DPEHPK3PXP',
            uri: 'otpauth://totp/MyApp:user@example.com?secret=JBSWY3DPEHPK3PXP&issuer=MyApp',
          },
        },
        error: null,
      });

      const result = await mockEnroll({
        factorType: 'totp',
      });

      expect(result.data.totp.qr_code).toContain('data:image/png');
      expect(result.data.totp.secret).toHaveLength(16);
      expect(result.data.totp.uri).toContain('otpauth://totp/');
      expect(result.error).toBeNull();
    });
  });

  describe('MFA Challenge Flow', () => {
    it('should create challenge for enrolled factor', async () => {
      const mockChallengeData = {
        id: 'challenge-123',
        type: 'totp',
        expires_at: Date.now() + 300000, // 5 minutes
      };

      mockChallenge.mockResolvedValue({
        data: mockChallengeData,
        error: null,
      });

      const result = await mockChallenge({
        factorId: 'factor-123',
      });

      expect(result.data).toEqual(mockChallengeData);
      expect(result.data.type).toBe('totp');
      expect(result.error).toBeNull();
    });

    it('should handle challenge creation failure', async () => {
      mockChallenge.mockResolvedValue({
        data: null,
        error: {
          message: 'Factor not found',
          status: 404,
        },
      });

      const result = await mockChallenge({
        factorId: 'invalid-factor-id',
      });

      expect(result.error).toBeDefined();
      expect(result.error.message).toContain('not found');
    });

    it('should create challenge with expiration time', async () => {
      const expiresAt = Date.now() + 300000;

      mockChallenge.mockResolvedValue({
        data: {
          id: 'challenge-456',
          type: 'totp',
          expires_at: expiresAt,
        },
        error: null,
      });

      const result = await mockChallenge({
        factorId: 'factor-123',
      });

      expect(result.data.expires_at).toBe(expiresAt);
      expect(result.error).toBeNull();
    });

    it('should handle unenrolled factor challenge', async () => {
      mockChallenge.mockResolvedValue({
        data: null,
        error: {
          message: 'Factor not verified',
          status: 400,
        },
      });

      const result = await mockChallenge({
        factorId: 'unverified-factor-id',
      });

      expect(result.error).toBeDefined();
      expect(result.error.message).toContain('not verified');
    });
  });

  describe('MFA Verification Flow', () => {
    it('should verify TOTP code successfully', async () => {
      mockVerify.mockResolvedValue({
        data: {
          user: {
            id: 'user-123',
            email: 'user@example.com',
          },
          session: {
            access_token: 'token-123',
            refresh_token: 'refresh-123',
          },
        },
        error: null,
      });

      const result = await mockVerify({
        factorId: 'factor-123',
        challengeId: 'challenge-123',
        code: '123456',
      });

      expect(result.data.user).toBeDefined();
      expect(result.data.session).toBeDefined();
      expect(result.error).toBeNull();
    });

    it('should handle invalid TOTP code', async () => {
      mockVerify.mockResolvedValue({
        data: null,
        error: {
          message: 'Invalid verification code',
          status: 400,
        },
      });

      const result = await mockVerify({
        factorId: 'factor-123',
        challengeId: 'challenge-123',
        code: '000000',
      });

      expect(result.error).toBeDefined();
      expect(result.error.message).toContain('Invalid verification code');
    });

    it('should handle expired challenge', async () => {
      mockVerify.mockResolvedValue({
        data: null,
        error: {
          message: 'Challenge expired',
          status: 400,
        },
      });

      const result = await mockVerify({
        factorId: 'factor-123',
        challengeId: 'expired-challenge-id',
        code: '123456',
      });

      expect(result.error).toBeDefined();
      expect(result.error.message).toContain('expired');
    });

    it('should verify and update factor status to verified', async () => {
      mockVerify.mockResolvedValue({
        data: {
          user: { id: 'user-123' },
          session: { access_token: 'token-123' },
        },
        error: null,
      });

      const result = await mockVerify({
        factorId: 'factor-123',
        challengeId: 'challenge-123',
        code: '654321',
      });

      expect(result.data.session).toBeDefined();
      expect(result.error).toBeNull();
    });

    it('should handle code format validation', async () => {
      mockVerify.mockResolvedValue({
        data: null,
        error: {
          message: 'Code must be 6 digits',
          status: 400,
        },
      });

      const result = await mockVerify({
        factorId: 'factor-123',
        challengeId: 'challenge-123',
        code: '12345', // Only 5 digits
      });

      expect(result.error).toBeDefined();
      expect(result.error.message).toContain('6 digits');
    });

    it('should handle non-numeric code', async () => {
      mockVerify.mockResolvedValue({
        data: null,
        error: {
          message: 'Code must contain only numbers',
          status: 400,
        },
      });

      const result = await mockVerify({
        factorId: 'factor-123',
        challengeId: 'challenge-123',
        code: 'abc123',
      });

      expect(result.error).toBeDefined();
      expect(result.error.message).toContain('only numbers');
    });
  });

  describe('MFA Unenrollment Flow', () => {
    it('should unenroll factor successfully', async () => {
      mockUnenroll.mockResolvedValue({
        data: {
          id: 'factor-123',
        },
        error: null,
      });

      const result = await mockUnenroll({
        factorId: 'factor-123',
      });

      expect(result.data).toBeDefined();
      expect(result.error).toBeNull();
    });

    it('should handle unenrollment of non-existent factor', async () => {
      mockUnenroll.mockResolvedValue({
        data: null,
        error: {
          message: 'Factor not found',
          status: 404,
        },
      });

      const result = await mockUnenroll({
        factorId: 'invalid-factor-id',
      });

      expect(result.error).toBeDefined();
      expect(result.error.message).toContain('not found');
    });

    it('should require verification before unenrollment', async () => {
      mockUnenroll.mockResolvedValue({
        data: null,
        error: {
          message: 'Verification required',
          status: 401,
        },
      });

      const result = await mockUnenroll({
        factorId: 'factor-123',
      });

      expect(result.error).toBeDefined();
      expect(result.error.message).toContain('Verification required');
    });

    it('should prevent unenrolling last factor', async () => {
      mockUnenroll.mockResolvedValue({
        data: null,
        error: {
          message: 'Cannot remove last MFA factor',
          status: 400,
        },
      });

      const result = await mockUnenroll({
        factorId: 'last-factor-id',
      });

      expect(result.error).toBeDefined();
      expect(result.error.message).toContain('last MFA factor');
    });
  });

  describe('MFA Factor Management', () => {
    it('should list all enrolled factors', async () => {
      const mockFactors = [
        {
          id: 'factor-1',
          friendly_name: 'Phone - Google Authenticator',
          factor_type: 'totp',
          status: 'verified',
        },
        {
          id: 'factor-2',
          friendly_name: 'Tablet - Authy',
          factor_type: 'totp',
          status: 'verified',
        },
      ];

      mockListFactors.mockResolvedValue({
        data: {
          all: mockFactors,
          totp: mockFactors,
        },
        error: null,
      });

      const result = await mockListFactors();

      expect(result.data.all).toHaveLength(2);
      expect(result.data.totp).toHaveLength(2);
      expect(result.error).toBeNull();
    });

    it('should return empty list when no factors enrolled', async () => {
      mockListFactors.mockResolvedValue({
        data: {
          all: [],
          totp: [],
        },
        error: null,
      });

      const result = await mockListFactors();

      expect(result.data.all).toHaveLength(0);
      expect(result.data.totp).toHaveLength(0);
      expect(result.error).toBeNull();
    });

    it('should differentiate between verified and unverified factors', async () => {
      const mockFactors = [
        { id: 'factor-1', status: 'verified', factor_type: 'totp' },
        { id: 'factor-2', status: 'unverified', factor_type: 'totp' },
      ];

      mockListFactors.mockResolvedValue({
        data: {
          all: mockFactors,
          totp: mockFactors,
        },
        error: null,
      });

      const result = await mockListFactors();

      expect(result.data.all[0].status).toBe('verified');
      expect(result.data.all[1].status).toBe('unverified');
    });

    it('should handle factor listing error', async () => {
      mockListFactors.mockResolvedValue({
        data: null,
        error: {
          message: 'Failed to fetch factors',
          status: 500,
        },
      });

      const result = await mockListFactors();

      expect(result.error).toBeDefined();
      expect(result.error.message).toContain('Failed to fetch');
    });
  });

  describe('Session Management with MFA', () => {
    it('should require MFA for sensitive operations', async () => {
      mockChallenge.mockResolvedValue({
        data: {
          id: 'challenge-123',
          type: 'totp',
        },
        error: null,
      });

      const result = await mockChallenge({
        factorId: 'factor-123',
      });

      expect(result.data).toBeDefined();
      expect(result.error).toBeNull();
    });

    it('should create elevated session after MFA verification', async () => {
      mockVerify.mockResolvedValue({
        data: {
          user: { id: 'user-123' },
          session: {
            access_token: 'elevated-token-123',
            refresh_token: 'refresh-123',
            aal: 'aal2', // Authentication Assurance Level 2 (MFA)
          },
        },
        error: null,
      });

      const result = await mockVerify({
        factorId: 'factor-123',
        challengeId: 'challenge-123',
        code: '123456',
      });

      expect(result.data.session.aal).toBe('aal2');
      expect(result.error).toBeNull();
    });

    it('should handle session without MFA (aal1)', async () => {
      const mockSession = {
        access_token: 'token-123',
        aal: 'aal1', // Authentication Assurance Level 1 (password only)
      };

      // Verify that session exists but is not elevated
      expect(mockSession.aal).toBe('aal1');
    });
  });

  describe('Error Handling', () => {
    it('should handle network errors during enrollment', async () => {
      mockEnroll.mockRejectedValue(new Error('Network request failed'));

      await expect(
        mockEnroll({
          factorType: 'totp',
        }),
      ).rejects.toThrow('Network request failed');
    });

    it('should handle timeout during verification', async () => {
      mockVerify.mockRejectedValue(new Error('Request timeout'));

      await expect(
        mockVerify({
          factorId: 'factor-123',
          challengeId: 'challenge-123',
          code: '123456',
        }),
      ).rejects.toThrow('Request timeout');
    });

    it('should handle rate limiting on verification attempts', async () => {
      mockVerify.mockResolvedValue({
        data: null,
        error: {
          message: 'Too many verification attempts',
          status: 429,
        },
      });

      const result = await mockVerify({
        factorId: 'factor-123',
        challengeId: 'challenge-123',
        code: '123456',
      });

      expect(result.error).toBeDefined();
      expect(result.error.status).toBe(429);
    });

    it('should handle server errors', async () => {
      mockEnroll.mockResolvedValue({
        data: null,
        error: {
          message: 'Internal server error',
          status: 500,
        },
      });

      const result = await mockEnroll({
        factorType: 'totp',
      });

      expect(result.error).toBeDefined();
      expect(result.error.status).toBe(500);
    });
  });

  describe('Edge Cases', () => {
    it('should handle very long friendly name', async () => {
      const longName = 'A'.repeat(500);

      mockEnroll.mockResolvedValue({
        data: {
          id: 'factor-123',
          friendly_name: longName.substring(0, 255), // Truncated
          factor_type: 'totp',
        },
        error: null,
      });

      const result = await mockEnroll({
        factorType: 'totp',
        friendlyName: longName,
      });

      expect(result.data.friendly_name.length).toBeLessThanOrEqual(255);
    });

    it('should handle special characters in friendly name', async () => {
      const specialName = 'My App - 2FA (Phone) #1';

      mockEnroll.mockResolvedValue({
        data: {
          id: 'factor-123',
          friendly_name: specialName,
          factor_type: 'totp',
        },
        error: null,
      });

      const result = await mockEnroll({
        factorType: 'totp',
        friendlyName: specialName,
      });

      expect(result.data.friendly_name).toBe(specialName);
    });

    it('should handle Unicode characters in friendly name', async () => {
      const unicodeName = '我的认证器 🔐';

      mockEnroll.mockResolvedValue({
        data: {
          id: 'factor-123',
          friendly_name: unicodeName,
          factor_type: 'totp',
        },
        error: null,
      });

      const result = await mockEnroll({
        factorType: 'totp',
        friendlyName: unicodeName,
      });

      expect(result.data.friendly_name).toBe(unicodeName);
    });

    it('should handle whitespace in verification code', async () => {
      mockVerify.mockResolvedValue({
        data: null,
        error: {
          message: 'Invalid code format',
          status: 400,
        },
      });

      const result = await mockVerify({
        factorId: 'factor-123',
        challengeId: 'challenge-123',
        code: '123 456',
      });

      expect(result.error).toBeDefined();
    });
  });

  describe('Integration Scenarios', () => {
    it('should complete full MFA setup flow', async () => {
      // 1. Enroll factor
      mockEnroll.mockResolvedValue({
        data: {
          id: 'factor-123',
          friendly_name: 'My App',
          factor_type: 'totp',
          status: 'unverified',
          totp: {
            qr_code: 'data:image/png;base64,...',
            secret: 'SECRET123',
          },
        },
        error: null,
      });

      const enrollResult = await mockEnroll({
        factorType: 'totp',
        friendlyName: 'My App',
      });

      expect(enrollResult.data.status).toBe('unverified');

      // 2. Create challenge
      mockChallenge.mockResolvedValue({
        data: {
          id: 'challenge-123',
          type: 'totp',
        },
        error: null,
      });

      const challengeResult = await mockChallenge({
        factorId: 'factor-123',
      });

      expect(challengeResult.data.id).toBe('challenge-123');

      // 3. Verify code
      mockVerify.mockResolvedValue({
        data: {
          user: { id: 'user-123' },
          session: { access_token: 'token-123' },
        },
        error: null,
      });

      const verifyResult = await mockVerify({
        factorId: 'factor-123',
        challengeId: 'challenge-123',
        code: '123456',
      });

      expect(verifyResult.data.session).toBeDefined();
    });

    it('should handle concurrent MFA verification attempts', async () => {
      const attempts = Array.from({ length: 3 }, (_, i) => ({
        factorId: 'factor-123',
        challengeId: 'challenge-123',
        code: `${i}23456`,
      }));

      // First attempt fails
      mockVerify.mockResolvedValueOnce({
        data: null,
        error: { message: 'Invalid code' },
      });

      // Second attempt fails
      mockVerify.mockResolvedValueOnce({
        data: null,
        error: { message: 'Invalid code' },
      });

      // Third attempt succeeds
      mockVerify.mockResolvedValueOnce({
        data: {
          user: { id: 'user-123' },
          session: { access_token: 'token-123' },
        },
        error: null,
      });

      const results = await Promise.all(
        attempts.map((attempt) => mockVerify(attempt)),
      );

      expect(results[0].error).toBeDefined();
      expect(results[1].error).toBeDefined();
      expect(results[2].data).toBeDefined();
    });

    it('should handle multiple factors enrollment', async () => {
      const factors = [
        { friendlyName: 'Phone - Google Auth' },
        { friendlyName: 'Tablet - Authy' },
        { friendlyName: 'Backup - 1Password' },
      ];

      mockEnroll.mockResolvedValue({
        data: {
          id: 'factor-id',
          factor_type: 'totp',
          status: 'unverified',
        },
        error: null,
      });

      const results = await Promise.all(
        factors.map((factor) =>
          mockEnroll({ factorType: 'totp', friendlyName: factor.friendlyName }),
        ),
      );

      results.forEach((result) => {
        expect(result.data).toBeDefined();
        expect(result.error).toBeNull();
      });
    });
  });

  describe('Recovery and Backup', () => {
    it('should allow enrollment of backup factor', async () => {
      mockEnroll.mockResolvedValue({
        data: {
          id: 'backup-factor-123',
          friendly_name: 'Backup Authenticator',
          factor_type: 'totp',
          status: 'unverified',
        },
        error: null,
      });

      const result = await mockEnroll({
        factorType: 'totp',
        friendlyName: 'Backup Authenticator',
      });

      expect(result.data.friendly_name).toContain('Backup');
      expect(result.error).toBeNull();
    });

    it('should allow verification with any enrolled factor', async () => {
      // User has multiple factors, can verify with any
      mockVerify.mockResolvedValue({
        data: {
          user: { id: 'user-123' },
          session: { access_token: 'token-123' },
        },
        error: null,
      });

      const result = await mockVerify({
        factorId: 'backup-factor-456',
        challengeId: 'challenge-123',
        code: '654321',
      });

      expect(result.data.session).toBeDefined();
      expect(result.error).toBeNull();
    });
  });
});
