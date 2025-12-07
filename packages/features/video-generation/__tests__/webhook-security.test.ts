import crypto from 'crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createWebhookConfig, processWebhook } from '../src/webhooks/handler';
import type { KlingWebhookPayload, WebhookConfig } from '../src/webhooks/types';
import {
  KLING_WEBHOOK_CONFIG,
  KlingWebhookVerifier,
} from '../src/webhooks/verifiers/kling';

/**
 * Creates a mock NextRequest for testing
 */
function createMockRequest(
  body: string,
  headers: Record<string, string> = {},
  options: { pathname?: string; method?: string } = {},
): {
  text: () => Promise<string>;
  headers: Map<string, string>;
  nextUrl: { pathname: string };
  method: string;
} {
  const headerMap = new Map(Object.entries(headers));
  return {
    text: () => Promise.resolve(body),
    headers: {
      get: (name: string) => headerMap.get(name) ?? null,
    } as unknown as Map<string, string>,
    nextUrl: { pathname: options.pathname ?? '/api/webhooks/kling' },
    method: options.method ?? 'POST',
  };
}

/**
 * Creates a valid HMAC-SHA256 signature for a payload
 */
function createValidSignature(payload: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(payload).digest('hex');
}

describe('Webhook Security', () => {
  const testSecret = 'test-webhook-secret-key-12345';

  describe('KlingWebhookVerifier', () => {
    let verifier: KlingWebhookVerifier;

    beforeEach(() => {
      verifier = new KlingWebhookVerifier({ secret: testSecret });
    });

    describe('verify', () => {
      it('should accept valid signatures', () => {
        const payload = JSON.stringify({
          task_id: 'abc123',
          status: 'completed',
        });
        const signature = createValidSignature(payload, testSecret);

        const result = verifier.verify(payload, signature);
        expect(result).toBe(true);
      });

      it('should reject invalid signatures', () => {
        const payload = JSON.stringify({
          task_id: 'abc123',
          status: 'completed',
        });
        const invalidSignature = 'invalid-signature-12345';

        const result = verifier.verify(payload, invalidSignature);
        expect(result).toBe(false);
      });

      it('should reject signatures with wrong secret', () => {
        const payload = JSON.stringify({
          task_id: 'abc123',
          status: 'completed',
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
          status: 'completed',
        });
        const signature = createValidSignature(originalPayload, testSecret);

        // Modify the payload after signing
        const modifiedPayload = JSON.stringify({
          task_id: 'abc123',
          status: 'failed',
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
      it('should extract timestamp from valid payload', () => {
        const payload: KlingWebhookPayload = {
          task_id: 'abc123',
          status: 'completed',
          timestamp: 1700000000,
        };

        const result = verifier.extractTimestamp(payload);
        expect(result).toBe(1700000000);
      });

      it('should return null when timestamp is missing', () => {
        const payload = { task_id: 'abc123', status: 'completed' };

        const result = verifier.extractTimestamp(payload);
        expect(result).toBeNull();
      });

      it('should return null for non-object payloads', () => {
        expect(verifier.extractTimestamp(null)).toBeNull();
        expect(verifier.extractTimestamp('string')).toBeNull();
        expect(verifier.extractTimestamp(123)).toBeNull();
      });

      it('should return null for non-numeric timestamps', () => {
        const payload = { task_id: 'abc123', timestamp: 'not-a-number' };

        const result = verifier.extractTimestamp(payload);
        expect(result).toBeNull();
      });
    });
  });

  describe('processWebhook', () => {
    let verifier: KlingWebhookVerifier;
    let config: WebhookConfig;
    let mockHandler: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      verifier = new KlingWebhookVerifier({ secret: testSecret });
      config = createWebhookConfig(
        testSecret,
        KLING_WEBHOOK_CONFIG.signatureHeader,
        {
          maxAgeSeconds: 300,
        },
      );
      mockHandler = vi.fn().mockResolvedValue(undefined);
      vi.spyOn(console, 'log').mockImplementation(() => {});
      vi.spyOn(console, 'error').mockImplementation(() => {});
    });

    it('should process valid webhooks successfully', async () => {
      const payload: KlingWebhookPayload = {
        task_id: 'abc123',
        status: 'completed',
        video_url: 'https://example.com/video.mp4',
        timestamp: Math.floor(Date.now() / 1000),
      };
      const payloadStr = JSON.stringify(payload);
      const signature = createValidSignature(payloadStr, testSecret);

      const request = createMockRequest(payloadStr, {
        [KLING_WEBHOOK_CONFIG.signatureHeader]: signature,
      });

      const result = await processWebhook(
        request as any,
        verifier,
        config,
        mockHandler,
      );

      expect(result.success).toBe(true);
      expect(result.statusCode).toBe(200);
      expect(result.data).toEqual(payload);
      expect(mockHandler).toHaveBeenCalledWith(payload);
    });

    it('should return 401 for missing signature', async () => {
      const payload = JSON.stringify({ task_id: 'abc123' });
      const request = createMockRequest(payload, {});

      const result = await processWebhook(
        request as any,
        verifier,
        config,
        mockHandler,
      );

      expect(result.success).toBe(false);
      expect(result.statusCode).toBe(401);
      expect(result.error).toBe('Missing signature header');
      expect(mockHandler).not.toHaveBeenCalled();
    });

    it('should return 401 for invalid signature', async () => {
      const payload = JSON.stringify({ task_id: 'abc123' });
      const request = createMockRequest(payload, {
        [KLING_WEBHOOK_CONFIG.signatureHeader]: 'invalid-signature',
      });

      const result = await processWebhook(
        request as any,
        verifier,
        config,
        mockHandler,
      );

      expect(result.success).toBe(false);
      expect(result.statusCode).toBe(401);
      expect(result.error).toBe('Invalid signature');
      expect(mockHandler).not.toHaveBeenCalled();
    });

    it('should return 400 for expired webhooks', async () => {
      const oldTimestamp = Math.floor(Date.now() / 1000) - 600; // 10 minutes ago
      const payload = JSON.stringify({
        task_id: 'abc123',
        status: 'completed',
        timestamp: oldTimestamp,
      });
      const signature = createValidSignature(payload, testSecret);

      const request = createMockRequest(payload, {
        [KLING_WEBHOOK_CONFIG.signatureHeader]: signature,
      });

      const result = await processWebhook(
        request as any,
        verifier,
        config,
        mockHandler,
      );

      expect(result.success).toBe(false);
      expect(result.statusCode).toBe(400);
      expect(result.error).toContain('Webhook expired');
      expect(mockHandler).not.toHaveBeenCalled();
    });

    it('should return 400 for future timestamps', async () => {
      const futureTimestamp = Math.floor(Date.now() / 1000) + 120; // 2 minutes in the future
      const payload = JSON.stringify({
        task_id: 'abc123',
        status: 'completed',
        timestamp: futureTimestamp,
      });
      const signature = createValidSignature(payload, testSecret);

      const request = createMockRequest(payload, {
        [KLING_WEBHOOK_CONFIG.signatureHeader]: signature,
      });

      const result = await processWebhook(
        request as any,
        verifier,
        config,
        mockHandler,
      );

      expect(result.success).toBe(false);
      expect(result.statusCode).toBe(400);
      expect(result.error).toBe('Webhook timestamp is in the future');
      expect(mockHandler).not.toHaveBeenCalled();
    });

    it('should return 400 for invalid JSON', async () => {
      const invalidJson = 'not valid json {{{';
      const signature = createValidSignature(invalidJson, testSecret);

      const request = createMockRequest(invalidJson, {
        [KLING_WEBHOOK_CONFIG.signatureHeader]: signature,
      });

      const result = await processWebhook(
        request as any,
        verifier,
        config,
        mockHandler,
      );

      expect(result.success).toBe(false);
      expect(result.statusCode).toBe(400);
      expect(result.error).toBe('Invalid JSON payload');
      expect(mockHandler).not.toHaveBeenCalled();
    });

    it('should return 500 when handler throws', async () => {
      const payload: KlingWebhookPayload = {
        task_id: 'abc123',
        status: 'completed',
        timestamp: Math.floor(Date.now() / 1000),
      };
      const payloadStr = JSON.stringify(payload);
      const signature = createValidSignature(payloadStr, testSecret);

      const request = createMockRequest(payloadStr, {
        [KLING_WEBHOOK_CONFIG.signatureHeader]: signature,
      });

      mockHandler.mockRejectedValue(new Error('Database error'));

      const result = await processWebhook(
        request as any,
        verifier,
        config,
        mockHandler,
      );

      expect(result.success).toBe(false);
      expect(result.statusCode).toBe(500);
      expect(result.error).toBe('Internal processing error');
    });

    it('should process webhooks without timestamp check if no extractTimestamp', async () => {
      // Create a verifier without extractTimestamp
      const simpleVerifier = {
        verify: (payload: string, sig: string) => verifier.verify(payload, sig),
      };

      const payload = JSON.stringify({
        task_id: 'abc123',
        status: 'completed',
      });
      const signature = createValidSignature(payload, testSecret);

      const request = createMockRequest(payload, {
        [KLING_WEBHOOK_CONFIG.signatureHeader]: signature,
      });

      const result = await processWebhook(
        request as any,
        simpleVerifier,
        config,
        mockHandler,
      );

      expect(result.success).toBe(true);
      expect(result.statusCode).toBe(200);
    });

    it('should allow small clock skew in timestamps', async () => {
      // Timestamp 30 seconds in the future (within tolerance)
      const slightlyFutureTimestamp = Math.floor(Date.now() / 1000) + 30;
      const payload = JSON.stringify({
        task_id: 'abc123',
        status: 'completed',
        timestamp: slightlyFutureTimestamp,
      });
      const signature = createValidSignature(payload, testSecret);

      const request = createMockRequest(payload, {
        [KLING_WEBHOOK_CONFIG.signatureHeader]: signature,
      });

      const result = await processWebhook(
        request as any,
        verifier,
        config,
        mockHandler,
      );

      expect(result.success).toBe(true);
      expect(result.statusCode).toBe(200);
    });
  });

  describe('createWebhookConfig', () => {
    it('should create config with defaults', () => {
      const config = createWebhookConfig('my-secret', 'x-signature');

      expect(config.secret).toBe('my-secret');
      expect(config.signatureHeader).toBe('x-signature');
      expect(config.maxAgeSeconds).toBe(300); // Default 5 minutes
      expect(config.timestampHeader).toBeUndefined();
    });

    it('should allow overriding defaults', () => {
      const config = createWebhookConfig('my-secret', 'x-signature', {
        maxAgeSeconds: 600,
        timestampHeader: 'x-timestamp',
      });

      expect(config.maxAgeSeconds).toBe(600);
      expect(config.timestampHeader).toBe('x-timestamp');
    });
  });

  describe('Constant-time comparison', () => {
    it('should use timing-safe comparison', () => {
      const verifier = new KlingWebhookVerifier({ secret: testSecret });
      const payload = 'test payload';

      // This test verifies the implementation uses timingSafeEqual
      // by checking that crypto.timingSafeEqual is called
      const timingSafeEqualSpy = vi.spyOn(crypto, 'timingSafeEqual');

      const signature = createValidSignature(payload, testSecret);
      verifier.verify(payload, signature);

      expect(timingSafeEqualSpy).toHaveBeenCalled();
      timingSafeEqualSpy.mockRestore();
    });
  });
});
