import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock global fetch
global.fetch = vi.fn();

// Set environment before importing
process.env.CAPTCHA_SECRET_TOKEN = 'test-secret-token';

import { verifyCaptchaToken } from '../src/captcha/server/verify-captcha';

describe('verifyCaptchaToken', () => {
  const mockToken = 'mock-captcha-token';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Environment Configuration', () => {
    it('should use CAPTCHA_SECRET_TOKEN from environment', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true }),
      });

      await verifyCaptchaToken(mockToken);

      const callArgs = (global.fetch as any).mock.calls[0];
      const formData = callArgs[1].body as FormData;

      expect(formData.get('secret')).toBe('test-secret-token');
    });
  });

  describe('Successful Verification', () => {
    it('should verify valid CAPTCHA token', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          challenge_ts: '2024-01-01T00:00:00Z',
          hostname: 'example.com',
        }),
      });

      await expect(verifyCaptchaToken(mockToken)).resolves.toBeUndefined();
    });

    it('should call Cloudflare Turnstile endpoint', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true }),
      });

      await verifyCaptchaToken(mockToken);

      expect(fetch).toHaveBeenCalledWith(
        'https://challenges.cloudflare.com/turnstile/v0/siteverify',
        expect.objectContaining({
          method: 'POST',
          body: expect.any(FormData),
        }),
      );
    });

    it('should send correct FormData with secret and response', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true }),
      });

      await verifyCaptchaToken(mockToken);

      const callArgs = (global.fetch as any).mock.calls[0];
      const formData = callArgs[1].body as FormData;

      expect(formData.get('secret')).toBe('test-secret-token');
      expect(formData.get('response')).toBe(mockToken);
    });
  });

  describe('Error Handling', () => {
    it('should throw when API returns non-ok status', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: false,
        statusText: 'Internal Server Error',
      });

      await expect(verifyCaptchaToken(mockToken)).rejects.toThrow(
        'Failed to verify CAPTCHA token',
      );
    });

    it('should throw when response indicates failure', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: false,
          'error-codes': ['invalid-input-response'],
        }),
      });

      await expect(verifyCaptchaToken(mockToken)).rejects.toThrow(
        'Invalid CAPTCHA token',
      );
    });

    it('should handle network errors', async () => {
      (global.fetch as any).mockRejectedValueOnce(
        new Error('Network error'),
      );

      await expect(verifyCaptchaToken(mockToken)).rejects.toThrow(
        'Network error',
      );
    });

    it('should handle invalid JSON response', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => {
          throw new Error('Invalid JSON');
        },
      });

      await expect(verifyCaptchaToken(mockToken)).rejects.toThrow(
        'Invalid JSON',
      );
    });

    it('should handle 400 Bad Request', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: false,
        status: 400,
        statusText: 'Bad Request',
      });

      await expect(verifyCaptchaToken(mockToken)).rejects.toThrow(
        'Failed to verify CAPTCHA token',
      );
    });

    it('should handle 500 Server Error', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      });

      await expect(verifyCaptchaToken(mockToken)).rejects.toThrow(
        'Failed to verify CAPTCHA token',
      );
    });
  });

  describe('Integration Scenarios', () => {
    it('should handle multiple verification requests', async () => {
      (global.fetch as any).mockResolvedValue({
        ok: true,
        json: async () => ({ success: true }),
      });

      const verifications = [
        verifyCaptchaToken('token-1'),
        verifyCaptchaToken('token-2'),
        verifyCaptchaToken('token-3'),
      ];

      await expect(Promise.all(verifications)).resolves.toHaveLength(3);
      expect(fetch).toHaveBeenCalledTimes(3);
    });

    it('should handle mixed success and failure', async () => {
      (global.fetch as any)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ success: true }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ success: false }),
        });

      await expect(verifyCaptchaToken('valid-token')).resolves.toBeUndefined();
      await expect(verifyCaptchaToken('invalid-token')).rejects.toThrow(
        'Invalid CAPTCHA token',
      );
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty token', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: false,
          'error-codes': ['missing-input-response'],
        }),
      });

      await expect(verifyCaptchaToken('')).rejects.toThrow(
        'Invalid CAPTCHA token',
      );
    });

    it('should handle very long token', async () => {
      const longToken = 'a'.repeat(10000);

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true }),
      });

      await expect(verifyCaptchaToken(longToken)).resolves.toBeUndefined();

      const callArgs = (global.fetch as any).mock.calls[0];
      const formData = callArgs[1].body as FormData;

      expect(formData.get('response')).toBe(longToken);
    });

    it('should handle special characters in token', async () => {
      const specialToken = 'token-with-!@#$%^&*()_+{}[]|:";\'<>?,./';

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true }),
      });

      await expect(verifyCaptchaToken(specialToken)).resolves.toBeUndefined();
    });

    it('should handle Unicode characters in token', async () => {
      const unicodeToken = 'token-with-ℂ⊞ℝ⋃𝕎ℙ⊞𝕍⇓';

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true }),
      });

      await expect(
        verifyCaptchaToken(unicodeToken),
      ).resolves.toBeUndefined();
    });
  });

  describe('Cloudflare-specific Responses', () => {
    it('should handle timeout-or-duplicate error', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: false,
          'error-codes': ['timeout-or-duplicate'],
        }),
      });

      await expect(verifyCaptchaToken(mockToken)).rejects.toThrow(
        'Invalid CAPTCHA token',
      );
    });

    it('should handle invalid-input-secret error', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: false,
          'error-codes': ['invalid-input-secret'],
        }),
      });

      await expect(verifyCaptchaToken(mockToken)).rejects.toThrow(
        'Invalid CAPTCHA token',
      );
    });

    it('should handle successful response with metadata', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          challenge_ts: '2024-01-01T00:00:00Z',
          hostname: 'example.com',
          'error-codes': [],
          action: 'login',
          cdata: 'session-data',
        }),
      });

      await expect(verifyCaptchaToken(mockToken)).resolves.toBeUndefined();
    });
  });

  describe('Performance', () => {
    it('should complete verification quickly', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true }),
      });

      const startTime = Date.now();
      await verifyCaptchaToken(mockToken);
      const endTime = Date.now();

      // Should complete in under 100ms (mocked, so very fast)
      expect(endTime - startTime).toBeLessThan(100);
    });
  });
});
