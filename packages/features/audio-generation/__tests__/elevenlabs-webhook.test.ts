import crypto from 'crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ElevenLabsWebhookPayload } from '../src/webhooks/types';
import {
  ELEVENLABS_WEBHOOK_CONFIG,
  ElevenLabsWebhookVerifier,
} from '../src/webhooks/verifiers/elevenlabs';

/**
 * Creates a valid HMAC-SHA256 signature for a payload
 */
function createValidSignature(payload: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(payload).digest('hex');
}

describe('ElevenLabs Webhook Verifier', () => {
  const testSecret = 'test-elevenlabs-secret-12345';

  describe('verify', () => {
    let verifier: ElevenLabsWebhookVerifier;

    beforeEach(() => {
      verifier = new ElevenLabsWebhookVerifier({ secret: testSecret });
    });

    it('should accept valid signatures without prefix', () => {
      const payload = JSON.stringify({
        task_id: 'voice123',
        status: 'completed',
      });
      const signature = createValidSignature(payload, testSecret);

      const result = verifier.verify(payload, signature);
      expect(result).toBe(true);
    });

    it('should accept valid signatures with sha256= prefix', () => {
      const payload = JSON.stringify({
        task_id: 'voice123',
        status: 'completed',
      });
      const signature = `sha256=${createValidSignature(payload, testSecret)}`;

      const result = verifier.verify(payload, signature);
      expect(result).toBe(true);
    });

    it('should reject invalid signatures', () => {
      const payload = JSON.stringify({ task_id: 'voice123' });
      const invalidSignature = 'sha256=invalid-signature-12345';

      const result = verifier.verify(payload, invalidSignature);
      expect(result).toBe(false);
    });

    it('should reject signatures with wrong secret', () => {
      const payload = JSON.stringify({ task_id: 'voice123' });
      const wrongSecretSignature = `sha256=${createValidSignature(payload, 'wrong-secret')}`;

      const result = verifier.verify(payload, wrongSecretSignature);
      expect(result).toBe(false);
    });

    it('should reject modified payloads', () => {
      const originalPayload = JSON.stringify({
        task_id: 'voice123',
        status: 'completed',
      });
      const signature = `sha256=${createValidSignature(originalPayload, testSecret)}`;

      const modifiedPayload = JSON.stringify({
        task_id: 'voice123',
        status: 'failed',
      });

      const result = verifier.verify(modifiedPayload, signature);
      expect(result).toBe(false);
    });

    it('should reject signatures of different lengths', () => {
      const payload = JSON.stringify({ task_id: 'voice123' });
      const shortSignature = 'sha256=abc';

      const result = verifier.verify(payload, shortSignature);
      expect(result).toBe(false);
    });

    it('should handle complex payloads', () => {
      const payload: ElevenLabsWebhookPayload = {
        task_id: 'voice-gen-12345',
        status: 'completed',
        audio_url: 'https://api.elevenlabs.io/audio/12345.mp3',
        duration_seconds: 45.5,
        character_count: 1250,
        voice_id: 'voice_abc123',
        timestamp: 1700000000,
      };
      const payloadStr = JSON.stringify(payload);
      const signature = `sha256=${createValidSignature(payloadStr, testSecret)}`;

      const result = verifier.verify(payloadStr, signature);
      expect(result).toBe(true);
    });
  });

  describe('extractTimestamp', () => {
    let verifier: ElevenLabsWebhookVerifier;

    beforeEach(() => {
      verifier = new ElevenLabsWebhookVerifier({ secret: testSecret });
    });

    it('should extract timestamp from valid payload', () => {
      const payload: ElevenLabsWebhookPayload = {
        task_id: 'voice123',
        status: 'completed',
        timestamp: 1700000000,
      };

      const result = verifier.extractTimestamp(payload);
      expect(result).toBe(1700000000);
    });

    it('should return null when timestamp is missing', () => {
      const payload = { task_id: 'voice123', status: 'completed' };

      const result = verifier.extractTimestamp(payload);
      expect(result).toBeNull();
    });

    it('should return null for non-object payloads', () => {
      expect(verifier.extractTimestamp(null)).toBeNull();
      expect(verifier.extractTimestamp(undefined)).toBeNull();
      expect(verifier.extractTimestamp('string')).toBeNull();
      expect(verifier.extractTimestamp(123)).toBeNull();
      expect(verifier.extractTimestamp([])).toBeNull();
    });

    it('should return null for non-numeric timestamps', () => {
      const payload = { task_id: 'voice123', timestamp: '2023-11-01' };

      const result = verifier.extractTimestamp(payload);
      expect(result).toBeNull();
    });
  });

  describe('constant-time comparison', () => {
    it('should use timing-safe comparison', () => {
      const verifier = new ElevenLabsWebhookVerifier({ secret: testSecret });
      const payload = 'test payload';

      const timingSafeEqualSpy = vi.spyOn(crypto, 'timingSafeEqual');

      const signature = createValidSignature(payload, testSecret);
      verifier.verify(payload, signature);

      expect(timingSafeEqualSpy).toHaveBeenCalled();
      timingSafeEqualSpy.mockRestore();
    });
  });

  describe('ELEVENLABS_WEBHOOK_CONFIG', () => {
    it('should have correct default values', () => {
      expect(ELEVENLABS_WEBHOOK_CONFIG.signatureHeader).toBe(
        'x-elevenlabs-signature',
      );
      expect(ELEVENLABS_WEBHOOK_CONFIG.maxAgeSeconds).toBe(300);
    });
  });
});
