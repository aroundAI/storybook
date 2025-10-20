import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock logger before imports
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

import { createOtpService } from '../src/server/otp.service';

// Constants for testing
const USER_ID = '550e8400-e29b-41d4-a716-446655440000';
const NONCE_ID = '660e8400-e29b-41d4-a716-446655440001';
const TOKEN = 'test-token-123456';
const PURPOSE = 'email-verification';

describe('OtpService', () => {
  let mockSupabaseClient: any;
  let mockRpc: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();

    mockRpc = vi.fn();

    mockSupabaseClient = {
      rpc: mockRpc,
    };
  });

  describe('createNonce', () => {
    it('should create nonce successfully', async () => {
      const service = createOtpService(mockSupabaseClient);

      mockRpc.mockResolvedValue({
        data: {
          id: NONCE_ID,
          token: TOKEN,
          expires_at: '2024-12-31T23:59:59Z',
          revoked_previous_count: 0,
        },
        error: null,
      });

      const result = await service.createNonce({
        userId: USER_ID,
        purpose: PURPOSE,
      });

      expect(mockRpc).toHaveBeenCalledWith('create_nonce', {
        p_user_id: USER_ID,
        p_purpose: PURPOSE,
        p_expires_in_seconds: 900, // default
        p_metadata: {},
        p_description: undefined,
        p_tags: undefined,
        p_scopes: undefined,
        p_revoke_previous: true, // default
      });

      expect(result).toEqual({
        id: NONCE_ID,
        token: TOKEN,
        expiresAt: '2024-12-31T23:59:59Z',
        revokedPreviousCount: 0,
      });
    });

    it('should create nonce with custom options', async () => {
      const service = createOtpService(mockSupabaseClient);

      mockRpc.mockResolvedValue({
        data: {
          id: NONCE_ID,
          token: TOKEN,
          expires_at: '2024-12-31T23:59:59Z',
          revoked_previous_count: 2,
        },
        error: null,
      });

      const result = await service.createNonce({
        userId: USER_ID,
        purpose: PURPOSE,
        expiresInSeconds: 1800,
        metadata: { source: 'test' },
        description: 'Test nonce',
        tags: ['test', 'verification'],
        scopes: ['read', 'write'],
        revokePrevious: false,
      });

      expect(mockRpc).toHaveBeenCalledWith('create_nonce', {
        p_user_id: USER_ID,
        p_purpose: PURPOSE,
        p_expires_in_seconds: 1800,
        p_metadata: { source: 'test' },
        p_description: 'Test nonce',
        p_tags: ['test', 'verification'],
        p_scopes: ['read', 'write'],
        p_revoke_previous: false,
      });

      expect(result.revokedPreviousCount).toBe(2);
    });

    it('should create nonce without userId', async () => {
      const service = createOtpService(mockSupabaseClient);

      mockRpc.mockResolvedValue({
        data: {
          id: NONCE_ID,
          token: TOKEN,
          expires_at: '2024-12-31T23:59:59Z',
          revoked_previous_count: 0,
        },
        error: null,
      });

      await service.createNonce({
        purpose: PURPOSE,
      });

      expect(mockRpc).toHaveBeenCalledWith(
        'create_nonce',
        expect.objectContaining({
          p_user_id: undefined,
          p_purpose: PURPOSE,
        }),
      );
    });

    it('should throw error when RPC fails', async () => {
      const service = createOtpService(mockSupabaseClient);

      mockRpc.mockResolvedValue({
        data: null,
        error: { message: 'Database error' },
      });

      await expect(
        service.createNonce({
          userId: USER_ID,
          purpose: PURPOSE,
        }),
      ).rejects.toThrow('Failed to create one-time token: Database error');
    });

    it('should handle RPC exception', async () => {
      const service = createOtpService(mockSupabaseClient);

      mockRpc.mockRejectedValue(new Error('Connection error'));

      await expect(
        service.createNonce({
          userId: USER_ID,
          purpose: PURPOSE,
        }),
      ).rejects.toThrow('Connection error');
    });
  });

  describe('verifyNonce', () => {
    it('should verify valid nonce successfully', async () => {
      const service = createOtpService(mockSupabaseClient);

      mockRpc.mockResolvedValue({
        data: {
          valid: true,
          user_id: USER_ID,
          metadata: { source: 'test' },
          scopes: ['read'],
          purpose: PURPOSE,
          message: 'Valid token',
        },
        error: null,
      });

      const result = await service.verifyNonce({
        token: TOKEN,
        purpose: PURPOSE,
      });

      expect(mockRpc).toHaveBeenCalledWith('verify_nonce', {
        p_token: TOKEN,
        p_user_id: undefined,
        p_purpose: PURPOSE,
        p_required_scopes: undefined,
        p_max_verification_attempts: 1, // default
      });

      expect(result).toEqual({
        valid: true,
        user_id: USER_ID,
        metadata: { source: 'test' },
        scopes: ['read'],
        purpose: PURPOSE,
        message: 'Valid token',
      });
    });

    it('should verify nonce with required scopes', async () => {
      const service = createOtpService(mockSupabaseClient);

      mockRpc.mockResolvedValue({
        data: {
          valid: true,
          user_id: USER_ID,
          scopes: ['read', 'write'],
        },
        error: null,
      });

      await service.verifyNonce({
        token: TOKEN,
        userId: USER_ID,
        purpose: PURPOSE,
        requiredScopes: ['read', 'write'],
        maxVerificationAttempts: 3,
      });

      expect(mockRpc).toHaveBeenCalledWith('verify_nonce', {
        p_token: TOKEN,
        p_user_id: USER_ID,
        p_purpose: PURPOSE,
        p_required_scopes: ['read', 'write'],
        p_max_verification_attempts: 3,
      });
    });

    it('should return invalid result for invalid nonce', async () => {
      const service = createOtpService(mockSupabaseClient);

      mockRpc.mockResolvedValue({
        data: {
          valid: false,
          message: 'Token expired',
        },
        error: null,
      });

      const result = await service.verifyNonce({
        token: TOKEN,
        purpose: PURPOSE,
      });

      expect(result).toEqual({
        valid: false,
        message: 'Token expired',
      });
    });

    it('should return max attempts exceeded', async () => {
      const service = createOtpService(mockSupabaseClient);

      mockRpc.mockResolvedValue({
        data: {
          valid: false,
          message: 'Maximum verification attempts exceeded',
          max_attempts_exceeded: true,
        },
        error: null,
      });

      const result = await service.verifyNonce({
        token: TOKEN,
        purpose: PURPOSE,
      });

      expect(result).toEqual({
        valid: false,
        message: 'Maximum verification attempts exceeded',
        max_attempts_exceeded: true,
      });
    });

    it('should throw error when RPC fails', async () => {
      const service = createOtpService(mockSupabaseClient);

      mockRpc.mockResolvedValue({
        data: null,
        error: { message: 'Database error' },
      });

      await expect(
        service.verifyNonce({
          token: TOKEN,
          purpose: PURPOSE,
        }),
      ).rejects.toThrow('Failed to verify one-time token: Database error');
    });

    it('should handle RPC exception', async () => {
      const service = createOtpService(mockSupabaseClient);

      mockRpc.mockRejectedValue(new Error('Connection error'));

      await expect(
        service.verifyNonce({
          token: TOKEN,
          purpose: PURPOSE,
        }),
      ).rejects.toThrow('Connection error');
    });
  });

  describe('revokeNonce', () => {
    it('should revoke nonce successfully', async () => {
      const service = createOtpService(mockSupabaseClient);

      mockRpc.mockResolvedValue({
        data: true,
        error: null,
      });

      const result = await service.revokeNonce({
        id: NONCE_ID,
      });

      expect(mockRpc).toHaveBeenCalledWith('revoke_nonce', {
        p_id: NONCE_ID,
        p_reason: undefined,
      });

      expect(result).toEqual({
        success: true,
      });
    });

    it('should revoke nonce with reason', async () => {
      const service = createOtpService(mockSupabaseClient);

      mockRpc.mockResolvedValue({
        data: true,
        error: null,
      });

      await service.revokeNonce({
        id: NONCE_ID,
        reason: 'User requested',
      });

      expect(mockRpc).toHaveBeenCalledWith('revoke_nonce', {
        p_id: NONCE_ID,
        p_reason: 'User requested',
      });
    });

    it('should return false when nonce not found', async () => {
      const service = createOtpService(mockSupabaseClient);

      mockRpc.mockResolvedValue({
        data: false,
        error: null,
      });

      const result = await service.revokeNonce({
        id: NONCE_ID,
      });

      expect(result).toEqual({
        success: false,
      });
    });

    it('should throw error when RPC fails', async () => {
      const service = createOtpService(mockSupabaseClient);

      mockRpc.mockResolvedValue({
        data: null,
        error: { message: 'Database error' },
      });

      await expect(
        service.revokeNonce({
          id: NONCE_ID,
        }),
      ).rejects.toThrow('Failed to revoke one-time token: Database error');
    });

    it('should handle RPC exception', async () => {
      const service = createOtpService(mockSupabaseClient);

      mockRpc.mockRejectedValue(new Error('Connection error'));

      await expect(
        service.revokeNonce({
          id: NONCE_ID,
        }),
      ).rejects.toThrow('Connection error');
    });
  });

  describe('getNonceStatus', () => {
    it('should get status for existing nonce', async () => {
      const service = createOtpService(mockSupabaseClient);

      mockRpc.mockResolvedValue({
        data: {
          exists: true,
          purpose: PURPOSE,
          user_id: USER_ID,
          created_at: '2024-01-01T00:00:00Z',
          expires_at: '2024-12-31T23:59:59Z',
          used_at: null,
          revoked: false,
          revoked_reason: null,
          verification_attempts: 0,
          last_verification_at: null,
          last_verification_ip: null,
          is_valid: true,
        },
        error: null,
      });

      const result = await service.getNonceStatus({
        id: NONCE_ID,
      });

      expect(mockRpc).toHaveBeenCalledWith('get_nonce_status', {
        p_id: NONCE_ID,
      });

      expect(result).toEqual({
        exists: true,
        purpose: PURPOSE,
        userId: USER_ID,
        createdAt: '2024-01-01T00:00:00Z',
        expiresAt: '2024-12-31T23:59:59Z',
        usedAt: null,
        revoked: false,
        revokedReason: null,
        verificationAttempts: 0,
        lastVerificationAt: null,
        lastVerificationIp: null,
        isValid: true,
      });
    });

    it('should get status for used nonce', async () => {
      const service = createOtpService(mockSupabaseClient);

      mockRpc.mockResolvedValue({
        data: {
          exists: true,
          purpose: PURPOSE,
          user_id: USER_ID,
          created_at: '2024-01-01T00:00:00Z',
          expires_at: '2024-12-31T23:59:59Z',
          used_at: '2024-01-15T12:00:00Z',
          revoked: false,
          revoked_reason: null,
          verification_attempts: 1,
          last_verification_at: '2024-01-15T12:00:00Z',
          last_verification_ip: '192.168.1.1',
          is_valid: false,
        },
        error: null,
      });

      const result = await service.getNonceStatus({
        id: NONCE_ID,
      });

      expect(result).toEqual({
        exists: true,
        purpose: PURPOSE,
        userId: USER_ID,
        createdAt: '2024-01-01T00:00:00Z',
        expiresAt: '2024-12-31T23:59:59Z',
        usedAt: '2024-01-15T12:00:00Z',
        revoked: false,
        revokedReason: null,
        verificationAttempts: 1,
        lastVerificationAt: '2024-01-15T12:00:00Z',
        lastVerificationIp: '192.168.1.1',
        isValid: false,
      });
    });

    it('should get status for revoked nonce', async () => {
      const service = createOtpService(mockSupabaseClient);

      mockRpc.mockResolvedValue({
        data: {
          exists: true,
          purpose: PURPOSE,
          user_id: USER_ID,
          created_at: '2024-01-01T00:00:00Z',
          expires_at: '2024-12-31T23:59:59Z',
          used_at: null,
          revoked: true,
          revoked_reason: 'User requested',
          verification_attempts: 0,
          last_verification_at: null,
          last_verification_ip: null,
          is_valid: false,
        },
        error: null,
      });

      const result = await service.getNonceStatus({
        id: NONCE_ID,
      });

      expect(result.exists).toBe(true);
      expect(result.revoked).toBe(true);
      expect(result.revokedReason).toBe('User requested');
      expect(result.isValid).toBe(false);
    });

    it('should return exists false for non-existent nonce', async () => {
      const service = createOtpService(mockSupabaseClient);

      mockRpc.mockResolvedValue({
        data: {
          exists: false,
        },
        error: null,
      });

      const result = await service.getNonceStatus({
        id: NONCE_ID,
      });

      expect(result).toEqual({
        exists: false,
      });
    });

    it('should throw error when RPC fails', async () => {
      const service = createOtpService(mockSupabaseClient);

      mockRpc.mockResolvedValue({
        data: null,
        error: { message: 'Database error' },
      });

      await expect(
        service.getNonceStatus({
          id: NONCE_ID,
        }),
      ).rejects.toThrow('Failed to get one-time token status: Database error');
    });

    it('should handle RPC exception', async () => {
      const service = createOtpService(mockSupabaseClient);

      mockRpc.mockRejectedValue(new Error('Connection error'));

      await expect(
        service.getNonceStatus({
          id: NONCE_ID,
        }),
      ).rejects.toThrow('Connection error');
    });
  });

  describe('Edge cases', () => {
    it('should handle empty metadata', async () => {
      const service = createOtpService(mockSupabaseClient);

      mockRpc.mockResolvedValue({
        data: {
          id: NONCE_ID,
          token: TOKEN,
          expires_at: '2024-12-31T23:59:59Z',
          revoked_previous_count: 0,
        },
        error: null,
      });

      await service.createNonce({
        userId: USER_ID,
        purpose: PURPOSE,
        metadata: {},
      });

      expect(mockRpc).toHaveBeenCalledWith(
        'create_nonce',
        expect.objectContaining({
          p_metadata: {},
        }),
      );
    });

    it('should handle empty arrays', async () => {
      const service = createOtpService(mockSupabaseClient);

      mockRpc.mockResolvedValue({
        data: {
          id: NONCE_ID,
          token: TOKEN,
          expires_at: '2024-12-31T23:59:59Z',
          revoked_previous_count: 0,
        },
        error: null,
      });

      await service.createNonce({
        userId: USER_ID,
        purpose: PURPOSE,
        tags: [],
        scopes: [],
      });

      expect(mockRpc).toHaveBeenCalledWith(
        'create_nonce',
        expect.objectContaining({
          p_tags: [],
          p_scopes: [],
        }),
      );
    });

    it('should handle very short expiry time', async () => {
      const service = createOtpService(mockSupabaseClient);

      mockRpc.mockResolvedValue({
        data: {
          id: NONCE_ID,
          token: TOKEN,
          expires_at: '2024-01-01T00:00:30Z',
          revoked_previous_count: 0,
        },
        error: null,
      });

      await service.createNonce({
        userId: USER_ID,
        purpose: PURPOSE,
        expiresInSeconds: 30,
      });

      expect(mockRpc).toHaveBeenCalledWith(
        'create_nonce',
        expect.objectContaining({
          p_expires_in_seconds: 30,
        }),
      );
    });

    it('should handle very long expiry time', async () => {
      const service = createOtpService(mockSupabaseClient);

      mockRpc.mockResolvedValue({
        data: {
          id: NONCE_ID,
          token: TOKEN,
          expires_at: '2025-01-01T00:00:00Z',
          revoked_previous_count: 0,
        },
        error: null,
      });

      await service.createNonce({
        userId: USER_ID,
        purpose: PURPOSE,
        expiresInSeconds: 31536000, // 1 year
      });

      expect(mockRpc).toHaveBeenCalledWith(
        'create_nonce',
        expect.objectContaining({
          p_expires_in_seconds: 31536000,
        }),
      );
    });
  });
});
