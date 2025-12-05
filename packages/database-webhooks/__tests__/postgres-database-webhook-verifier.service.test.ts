import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createDatabaseWebhookVerifierService } from '../src/server/services/verifier/postgres-database-webhook-verifier.service';

describe('PostgresDatabaseWebhookVerifierService', () => {
  let service: ReturnType<typeof createDatabaseWebhookVerifierService>;
  const validSecret = process.env.SUPABASE_DB_WEBHOOK_SECRET;

  beforeEach(() => {
    vi.clearAllMocks();
    service = createDatabaseWebhookVerifierService();
  });

  describe('verifySignatureOrThrow', () => {
    it('should verify valid signature', async () => {
      const result = await service.verifySignatureOrThrow(validSecret!);

      expect(result).toBe(true);
    });

    it('should throw error for invalid signature', () => {
      expect(() => service.verifySignatureOrThrow('invalid-secret')).toThrow(
        'Invalid signature',
      );
    });

    it('should throw error for empty signature', () => {
      expect(() => service.verifySignatureOrThrow('')).toThrow(
        'Invalid signature',
      );
    });

    it('should throw error for null signature', () => {
      expect(() => service.verifySignatureOrThrow(null as any)).toThrow(
        'Invalid signature',
      );
    });

    it('should throw error for undefined signature', () => {
      expect(() => service.verifySignatureOrThrow(undefined as any)).toThrow(
        'Invalid signature',
      );
    });

    it('should be case sensitive', () => {
      const uppercaseSecret = validSecret!.toUpperCase();

      if (uppercaseSecret !== validSecret) {
        expect(() => service.verifySignatureOrThrow(uppercaseSecret)).toThrow(
          'Invalid signature',
        );
      }
    });

    it('should not accept signature with extra whitespace', () => {
      expect(() => service.verifySignatureOrThrow(` ${validSecret} `)).toThrow(
        'Invalid signature',
      );
    });

    it('should not accept signature with prefix', () => {
      expect(() =>
        service.verifySignatureOrThrow(`Bearer ${validSecret}`),
      ).toThrow('Invalid signature');
    });

    it('should not accept similar but different signature', () => {
      const similarSecret = validSecret + 'x';

      expect(() => service.verifySignatureOrThrow(similarSecret)).toThrow(
        'Invalid signature',
      );
    });

    it('should verify signature exactly as configured', async () => {
      // Test that it uses the exact environment variable value
      const result = await service.verifySignatureOrThrow(
        process.env.SUPABASE_DB_WEBHOOK_SECRET!,
      );

      expect(result).toBe(true);
    });
  });

  describe('security', () => {
    it('should not leak secret in error message', async () => {
      try {
        await service.verifySignatureOrThrow('wrong-secret');
        expect.fail('Should have thrown error');
      } catch (error: any) {
        expect(error.message).not.toContain(validSecret);
        expect(error.message).toBe('Invalid signature');
      }
    });

    it('should handle concurrent verification requests', async () => {
      const requests = Array(10)
        .fill(0)
        .map(() => service.verifySignatureOrThrow(validSecret!));

      const results = await Promise.all(requests);

      expect(results).toHaveLength(10);
      results.forEach((result) => {
        expect(result).toBe(true);
      });
    });

    it('should handle mixed valid and invalid concurrent requests', () => {
      // Valid requests
      expect(() => service.verifySignatureOrThrow(validSecret!)).not.toThrow();
      expect(() => service.verifySignatureOrThrow('invalid1')).toThrow();
      expect(() => service.verifySignatureOrThrow(validSecret!)).not.toThrow();
      expect(() => service.verifySignatureOrThrow('invalid2')).toThrow();
      expect(() => service.verifySignatureOrThrow(validSecret!)).not.toThrow();
    });
  });

  describe('edge cases', () => {
    it('should handle very long invalid signatures', () => {
      const longSignature = 'a'.repeat(10000);

      expect(() => service.verifySignatureOrThrow(longSignature)).toThrow(
        'Invalid signature',
      );
    });

    it('should handle special characters in invalid signature', () => {
      expect(() => service.verifySignatureOrThrow('!@#$%^&*()')).toThrow(
        'Invalid signature',
      );
    });

    it('should handle unicode characters in invalid signature', () => {
      expect(() => service.verifySignatureOrThrow('你好世界🌍')).toThrow(
        'Invalid signature',
      );
    });

    it('should handle numeric signature', () => {
      expect(() => service.verifySignatureOrThrow(12345 as any)).toThrow(
        'Invalid signature',
      );
    });

    it('should handle boolean signature', () => {
      expect(() => service.verifySignatureOrThrow(true as any)).toThrow(
        'Invalid signature',
      );
    });

    it('should handle object signature', () => {
      expect(() =>
        service.verifySignatureOrThrow({ secret: validSecret } as any),
      ).toThrow('Invalid signature');
    });

    it('should handle array signature', () => {
      expect(() =>
        service.verifySignatureOrThrow([validSecret] as any),
      ).toThrow('Invalid signature');
    });
  });
});
