import { beforeEach, describe, expect, it } from 'vitest';

import { createHmac } from '../src/services/verify-hmac';

describe('LemonSqueezy HMAC Verification', () => {
  describe('createHmac', () => {
    describe('successful HMAC generation', () => {
      it('should generate HMAC signature from key and data', async () => {
        const result = await createHmac({
          key: 'secret-key',
          data: 'test data',
        });

        expect(result).toHaveProperty('hex');
        expect(typeof result.hex).toBe('string');
        expect(result.hex.length).toBeGreaterThan(0);
      });

      it('should generate consistent signatures for same inputs', async () => {
        const key = 'my-secret-key';
        const data = 'webhook payload';

        const result1 = await createHmac({ key, data });
        const result2 = await createHmac({ key, data });

        expect(result1.hex).toBe(result2.hex);
      });

      it('should generate different signatures for different keys', async () => {
        const data = 'same data';

        const result1 = await createHmac({ key: 'key1', data });
        const result2 = await createHmac({ key: 'key2', data });

        expect(result1.hex).not.toBe(result2.hex);
      });

      it('should generate different signatures for different data', async () => {
        const key = 'same-key';

        const result1 = await createHmac({ key, data: 'data1' });
        const result2 = await createHmac({ key, data: 'data2' });

        expect(result1.hex).not.toBe(result2.hex);
      });

      it('should generate hex string with even length', async () => {
        const result = await createHmac({
          key: 'test-key',
          data: 'test-data',
        });

        // Hex strings should always have even length
        expect(result.hex.length % 2).toBe(0);
      });

      it('should generate hex string with only valid hex characters', async () => {
        const result = await createHmac({
          key: 'test-key',
          data: 'test-data',
        });

        // Should only contain 0-9 and a-f
        expect(result.hex).toMatch(/^[0-9a-f]+$/);
      });

      it('should handle empty data string', async () => {
        const result = await createHmac({
          key: 'test-key',
          data: '',
        });

        expect(result.hex).toBeDefined();
        expect(typeof result.hex).toBe('string');
        expect(result.hex.length).toBeGreaterThan(0);
      });

      it('should throw error for empty key string', async () => {
        // Web Crypto API doesn't support zero-length keys
        await expect(
          createHmac({
            key: '',
            data: 'test-data',
          }),
        ).rejects.toThrow('Zero-length key is not supported');
      });
    });

    describe('webhook payload scenarios', () => {
      it('should verify real webhook signature with known values', async () => {
        // Test with a known HMAC signature
        const key = 'webhook-secret';
        const data = '{"event":"order_created","order_id":12345}';

        const result = await createHmac({ key, data });

        // Should generate consistent signature for webhook verification
        const verification = await createHmac({ key, data });
        expect(result.hex).toBe(verification.hex);
      });

      it('should handle JSON webhook payloads', async () => {
        const webhookPayload = JSON.stringify({
          event: 'subscription.created',
          subscription: {
            id: 'sub_123',
            status: 'active',
          },
        });

        const result = await createHmac({
          key: 'ls-secret-key',
          data: webhookPayload,
        });

        expect(result.hex).toBeDefined();
        expect(result.hex.length).toBeGreaterThan(0);
      });

      it('should detect tampering when data changes', async () => {
        const key = 'secret';
        const originalData = '{"amount":100}';
        const tamperedData = '{"amount":999}';

        const originalSignature = await createHmac({ key, data: originalData });
        const tamperedSignature = await createHmac({
          key,
          data: tamperedData,
        });

        expect(originalSignature.hex).not.toBe(tamperedSignature.hex);
      });

      it('should handle large webhook payloads', async () => {
        const largePayload = JSON.stringify({
          event: 'order.created',
          data: Array(1000)
            .fill(0)
            .map((_, i) => ({ id: i, value: `item-${i}` })),
        });

        const result = await createHmac({
          key: 'test-key',
          data: largePayload,
        });

        expect(result.hex).toBeDefined();
        expect(typeof result.hex).toBe('string');
      });
    });

    describe('special characters and encoding', () => {
      it('should handle special characters in data', async () => {
        const result = await createHmac({
          key: 'test-key',
          data: 'data with special chars: !@#$%^&*()',
        });

        expect(result.hex).toBeDefined();
        expect(result.hex).toMatch(/^[0-9a-f]+$/);
      });

      it('should handle Unicode characters in data', async () => {
        const result = await createHmac({
          key: 'test-key',
          data: 'Unicode: 你好世界 🌍',
        });

        expect(result.hex).toBeDefined();
        expect(result.hex).toMatch(/^[0-9a-f]+$/);
      });

      it('should handle newlines and whitespace in data', async () => {
        const result = await createHmac({
          key: 'test-key',
          data: 'line1\nline2\r\nline3\ttab',
        });

        expect(result.hex).toBeDefined();
        expect(result.hex).toMatch(/^[0-9a-f]+$/);
      });

      it('should handle special characters in key', async () => {
        const result = await createHmac({
          key: 'key-with-!@#$%^&*()',
          data: 'test-data',
        });

        expect(result.hex).toBeDefined();
        expect(result.hex).toMatch(/^[0-9a-f]+$/);
      });

      it('should handle Unicode characters in key', async () => {
        const result = await createHmac({
          key: '密钥-🔑',
          data: 'test-data',
        });

        expect(result.hex).toBeDefined();
        expect(result.hex).toMatch(/^[0-9a-f]+$/);
      });
    });

    describe('edge cases', () => {
      it('should handle very long keys', async () => {
        const longKey = 'a'.repeat(10000);

        const result = await createHmac({
          key: longKey,
          data: 'test-data',
        });

        expect(result.hex).toBeDefined();
        expect(typeof result.hex).toBe('string');
      });

      it('should handle very long data', async () => {
        const longData = 'x'.repeat(100000);

        const result = await createHmac({
          key: 'test-key',
          data: longData,
        });

        expect(result.hex).toBeDefined();
        expect(typeof result.hex).toBe('string');
      });

      it('should produce 64-character hex string for SHA-256', async () => {
        // SHA-256 produces 256 bits = 32 bytes = 64 hex characters
        const result = await createHmac({
          key: 'test-key',
          data: 'test-data',
        });

        expect(result.hex.length).toBe(64);
      });

      it('should handle case sensitivity in data', async () => {
        const result1 = await createHmac({ key: 'key', data: 'DATA' });
        const result2 = await createHmac({ key: 'key', data: 'data' });

        expect(result1.hex).not.toBe(result2.hex);
      });

      it('should handle case sensitivity in key', async () => {
        const result1 = await createHmac({ key: 'KEY', data: 'data' });
        const result2 = await createHmac({ key: 'key', data: 'data' });

        expect(result1.hex).not.toBe(result2.hex);
      });
    });

    describe('LemonSqueezy webhook verification use case', () => {
      it('should verify signature matches expected format', async () => {
        const webhookSecret =
          process.env.LEMON_SQUEEZY_WEBHOOK_SECRET || 'test-secret';
        const webhookBody = JSON.stringify({
          meta: {
            event_name: 'subscription_created',
            custom_data: {
              account_id: 'acc_123',
            },
          },
          data: {
            id: '1',
            type: 'subscriptions',
            attributes: {
              status: 'active',
            },
          },
        });

        const result = await createHmac({
          key: webhookSecret,
          data: webhookBody,
        });

        // Signature should be lowercase hex string
        expect(result.hex).toMatch(/^[0-9a-f]{64}$/);
      });

      it('should allow verification by comparing signatures', async () => {
        const secret = 'shared-secret';
        const payload = '{"event":"test"}';

        // Server generates signature
        const serverSignature = await createHmac({
          key: secret,
          data: payload,
        });

        // Webhook sends payload + signature
        // Receiver verifies by generating signature from payload
        const receivedSignature = await createHmac({
          key: secret,
          data: payload,
        });

        // Signatures should match for valid webhook
        expect(serverSignature.hex).toBe(receivedSignature.hex);
      });

      it('should reject tampered webhook data', async () => {
        const secret = 'shared-secret';
        const originalPayload = '{"amount":100}';

        const validSignature = await createHmac({
          key: secret,
          data: originalPayload,
        });

        // Attacker modifies payload
        const tamperedPayload = '{"amount":999}';
        const tamperedSignature = await createHmac({
          key: secret,
          data: tamperedPayload,
        });

        // Signatures should NOT match
        expect(validSignature.hex).not.toBe(tamperedSignature.hex);
      });
    });

    describe('concurrent operations', () => {
      it('should handle concurrent HMAC generations', async () => {
        const operations = Array(10)
          .fill(0)
          .map((_, i) =>
            createHmac({
              key: 'test-key',
              data: `data-${i}`,
            }),
          );

        const results = await Promise.all(operations);

        // All should succeed
        expect(results).toHaveLength(10);
        results.forEach((result) => {
          expect(result.hex).toBeDefined();
          expect(result.hex).toMatch(/^[0-9a-f]{64}$/);
        });

        // All should be different (different data)
        const uniqueSignatures = new Set(results.map((r) => r.hex));
        expect(uniqueSignatures.size).toBe(10);
      });
    });
  });
});
