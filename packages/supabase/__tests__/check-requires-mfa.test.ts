import { beforeEach, describe, expect, it, vi } from 'vitest';

import { checkRequiresMultiFactorAuthentication } from '../src/check-requires-mfa';

describe('checkRequiresMultiFactorAuthentication', () => {
  let mockSupabaseClient: any;
  let mockGetAuthenticatorAssuranceLevel: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();

    mockGetAuthenticatorAssuranceLevel = vi.fn();

    mockSupabaseClient = {
      auth: {
        mfa: {
          getAuthenticatorAssuranceLevel: mockGetAuthenticatorAssuranceLevel,
        },
        suppressGetSessionWarning: false,
      },
    };
  });

  describe('MFA Required', () => {
    it('should return true when nextLevel is aal2 and currentLevel is aal1', async () => {
      mockGetAuthenticatorAssuranceLevel.mockResolvedValue({
        data: {
          nextLevel: 'aal2',
          currentLevel: 'aal1',
        },
        error: null,
      });

      const result =
        await checkRequiresMultiFactorAuthentication(mockSupabaseClient);

      expect(result).toBe(true);
      expect(mockSupabaseClient.auth.suppressGetSessionWarning).toBe(false);
    });

    it('should return true when nextLevel is aal2 and currentLevel is null', async () => {
      mockGetAuthenticatorAssuranceLevel.mockResolvedValue({
        data: {
          nextLevel: 'aal2',
          currentLevel: null,
        },
        error: null,
      });

      const result =
        await checkRequiresMultiFactorAuthentication(mockSupabaseClient);

      expect(result).toBe(true);
    });

    it('should suppress and restore getSession warning', async () => {
      mockGetAuthenticatorAssuranceLevel.mockResolvedValue({
        data: {
          nextLevel: 'aal2',
          currentLevel: 'aal1',
        },
        error: null,
      });

      await checkRequiresMultiFactorAuthentication(mockSupabaseClient);

      // Warning should be restored to false after function completes
      expect(mockSupabaseClient.auth.suppressGetSessionWarning).toBe(false);
    });
  });

  describe('MFA Not Required', () => {
    it('should return false when both levels are aal1', async () => {
      mockGetAuthenticatorAssuranceLevel.mockResolvedValue({
        data: {
          nextLevel: 'aal1',
          currentLevel: 'aal1',
        },
        error: null,
      });

      const result =
        await checkRequiresMultiFactorAuthentication(mockSupabaseClient);

      expect(result).toBe(false);
    });

    it('should return false when both levels are aal2', async () => {
      mockGetAuthenticatorAssuranceLevel.mockResolvedValue({
        data: {
          nextLevel: 'aal2',
          currentLevel: 'aal2',
        },
        error: null,
      });

      const result =
        await checkRequiresMultiFactorAuthentication(mockSupabaseClient);

      expect(result).toBe(false);
    });

    it('should return false when nextLevel is aal1', async () => {
      mockGetAuthenticatorAssuranceLevel.mockResolvedValue({
        data: {
          nextLevel: 'aal1',
          currentLevel: 'aal2',
        },
        error: null,
      });

      const result =
        await checkRequiresMultiFactorAuthentication(mockSupabaseClient);

      expect(result).toBe(false);
    });

    it('should return false when nextLevel is null', async () => {
      mockGetAuthenticatorAssuranceLevel.mockResolvedValue({
        data: {
          nextLevel: null,
          currentLevel: 'aal1',
        },
        error: null,
      });

      const result =
        await checkRequiresMultiFactorAuthentication(mockSupabaseClient);

      expect(result).toBe(false);
    });
  });

  describe('Error Handling', () => {
    it('should throw error when API returns an error', async () => {
      mockGetAuthenticatorAssuranceLevel.mockResolvedValue({
        data: null,
        error: {
          message: 'Failed to get assurance level',
        },
      });

      await expect(
        checkRequiresMultiFactorAuthentication(mockSupabaseClient),
      ).rejects.toThrow('Failed to get assurance level');

      // Warning should still be restored even after error
      expect(mockSupabaseClient.auth.suppressGetSessionWarning).toBe(false);
    });

    it('should throw error with specific error message', async () => {
      mockGetAuthenticatorAssuranceLevel.mockResolvedValue({
        data: null,
        error: {
          message: 'Authentication session expired',
        },
      });

      await expect(
        checkRequiresMultiFactorAuthentication(mockSupabaseClient),
      ).rejects.toThrow('Authentication session expired');
    });

    it('should throw error when API call fails', async () => {
      mockGetAuthenticatorAssuranceLevel.mockRejectedValue(
        new Error('Network error'),
      );

      await expect(
        checkRequiresMultiFactorAuthentication(mockSupabaseClient),
      ).rejects.toThrow('Network error');

      // Note: The implementation doesn't use try-finally, so the warning flag
      // remains true if an exception is thrown before the restoration line
      expect(mockSupabaseClient.auth.suppressGetSessionWarning).toBe(true);
    });
  });

  describe('Edge Cases', () => {
    it('should handle undefined values gracefully', async () => {
      mockGetAuthenticatorAssuranceLevel.mockResolvedValue({
        data: {
          nextLevel: undefined,
          currentLevel: undefined,
        },
        error: null,
      });

      const result =
        await checkRequiresMultiFactorAuthentication(mockSupabaseClient);

      // nextLevel is not 'aal2', so should return false
      expect(result).toBe(false);
    });

    it('should handle empty object data', async () => {
      mockGetAuthenticatorAssuranceLevel.mockResolvedValue({
        data: {},
        error: null,
      });

      const result =
        await checkRequiresMultiFactorAuthentication(mockSupabaseClient);

      expect(result).toBe(false);
    });

    it('should verify suppressGetSessionWarning is set during execution', async () => {
      let warningValueDuringExecution: boolean | undefined;

      mockGetAuthenticatorAssuranceLevel.mockImplementation(async () => {
        warningValueDuringExecution =
          mockSupabaseClient.auth.suppressGetSessionWarning;

        return {
          data: {
            nextLevel: 'aal2',
            currentLevel: 'aal1',
          },
          error: null,
        };
      });

      await checkRequiresMultiFactorAuthentication(mockSupabaseClient);

      // During execution, warning should have been suppressed
      expect(warningValueDuringExecution).toBe(true);

      // After execution, warning should be restored
      expect(mockSupabaseClient.auth.suppressGetSessionWarning).toBe(false);
    });
  });

  describe('MFA Transition States', () => {
    it('should require MFA when user just enrolled in MFA', async () => {
      // User just set up MFA, so they need to verify
      mockGetAuthenticatorAssuranceLevel.mockResolvedValue({
        data: {
          nextLevel: 'aal2',
          currentLevel: 'aal1',
        },
        error: null,
      });

      const result =
        await checkRequiresMultiFactorAuthentication(mockSupabaseClient);

      expect(result).toBe(true);
    });

    it('should not require MFA when user already verified MFA this session', async () => {
      // User already completed MFA verification in this session
      mockGetAuthenticatorAssuranceLevel.mockResolvedValue({
        data: {
          nextLevel: 'aal2',
          currentLevel: 'aal2',
        },
        error: null,
      });

      const result =
        await checkRequiresMultiFactorAuthentication(mockSupabaseClient);

      expect(result).toBe(false);
    });

    it('should not require MFA when MFA is not enrolled', async () => {
      // User has not enrolled in MFA
      mockGetAuthenticatorAssuranceLevel.mockResolvedValue({
        data: {
          nextLevel: 'aal1',
          currentLevel: 'aal1',
        },
        error: null,
      });

      const result =
        await checkRequiresMultiFactorAuthentication(mockSupabaseClient);

      expect(result).toBe(false);
    });
  });
});
