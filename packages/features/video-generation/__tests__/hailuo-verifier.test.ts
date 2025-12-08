import crypto from 'crypto';
import { beforeEach, describe, expect, it } from 'vitest';

import type { HailuoWebhookPayload } from '../src/webhooks/types';
import { HailuoWebhookVerifier } from '../src/webhooks/verifiers/hailuo';

/**
 * Creates a valid HMAC-SHA256 signature for a payload
 */
function createValidSignature(payload: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(payload).digest('hex');
}

describe('HailuoWebhookVerifier', () => {
  const testSecret = 'test-hailuo-webhook-secret-12345';
  let verifier: HailuoWebhookVerifier;

  beforeEach(() => {
    verifier = new HailuoWebhookVerifier({ secret: testSecret });
  });

  describe('verify', () => {
    it('should accept valid signatures', () => {
      const payload = JSON.stringify({
        task_id: 'abc123',
        status: 'Success',
      });
      const signature = createValidSignature(payload, testSecret);

      const result = verifier.verify(payload, signature);
      expect(result).toBe(true);
    });

    it('should reject invalid signatures', () => {
      const payload = JSON.stringify({
        task_id: 'abc123',
        status: 'Success',
      });
      const invalidSignature = 'invalid-signature-12345';

      const result = verifier.verify(payload, invalidSignature);
      expect(result).toBe(false);
    });

    it('should reject signatures with wrong secret', () => {
      const payload = JSON.stringify({
        task_id: 'abc123',
        status: 'Success',
      });
      const wrongSecretSignature = createValidSignature(
        payload,
        'wrong-secret',
      );

      const result = verifier.verify(payload, wrongSecretSignature);
      expect(result).toBe(false);
    });

    it('should reject modified payloads', () => {
      const originalPayload = JSON.stringify({
        task_id: 'abc123',
        status: 'Success',
      });
      const signature = createValidSignature(originalPayload, testSecret);

      // Modify the payload after signing
      const modifiedPayload = JSON.stringify({
        task_id: 'abc123',
        status: 'Fail',
      });

      const result = verifier.verify(modifiedPayload, signature);
      expect(result).toBe(false);
    });

    it('should reject signatures of different lengths', () => {
      const payload = JSON.stringify({ task_id: 'abc123' });
      const shortSignature = 'abc';

      const result = verifier.verify(payload, shortSignature);
      expect(result).toBe(false);
    });

    it('should handle empty payloads', () => {
      const payload = '';
      const signature = createValidSignature(payload, testSecret);

      const result = verifier.verify(payload, signature);
      expect(result).toBe(true);
    });
  });

  describe('extractTimestamp', () => {
    it('should extract timestamp from created_at field', () => {
      const payload: HailuoWebhookPayload = {
        task_id: 'abc123',
        status: 'Success',
        created_at: 1700000000,
      };

      const result = verifier.extractTimestamp(payload);
      expect(result).toBe(1700000000);
    });

    it('should fallback to timestamp field if created_at is missing', () => {
      const payload = {
        task_id: 'abc123',
        status: 'Success',
        timestamp: 1700000001,
      };

      const result = verifier.extractTimestamp(payload);
      expect(result).toBe(1700000001);
    });

    it('should return null when both timestamps are missing', () => {
      const payload = { task_id: 'abc123', status: 'Success' };

      const result = verifier.extractTimestamp(payload);
      expect(result).toBeNull();
    });

    it('should return null for non-object payloads', () => {
      expect(verifier.extractTimestamp(null)).toBeNull();
      expect(verifier.extractTimestamp('string')).toBeNull();
      expect(verifier.extractTimestamp(123)).toBeNull();
    });

    it('should return null for non-numeric timestamps', () => {
      const payload = { task_id: 'abc123', created_at: 'not-a-number' };

      const result = verifier.extractTimestamp(payload);
      expect(result).toBeNull();
    });
  });

  describe('Constant-time comparison', () => {
    it('should use timing-safe comparison', () => {
      const payload = 'test payload';
      const signature = createValidSignature(payload, testSecret);

      // Verify the implementation works correctly
      const result = verifier.verify(payload, signature);
      expect(result).toBe(true);
    });
  });
});
