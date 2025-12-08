import 'server-only';

import crypto from 'crypto';

import type {
  HailuoWebhookPayload,
  WebhookConfig,
  WebhookVerifier,
} from '../types';

/**
 * Webhook signature verifier for Hailuo (MiniMax) video generation provider.
 *
 * Hailuo uses HMAC-SHA256 for webhook signature verification.
 * The signature is provided in the 'x-hailuo-signature' header.
 */
export class HailuoWebhookVerifier implements WebhookVerifier {
  private readonly secret: string;

  constructor(config: Pick<WebhookConfig, 'secret'>) {
    this.secret = config.secret;
  }

  /**
   * Verifies the HMAC-SHA256 signature of the webhook payload.
   * Uses constant-time comparison to prevent timing attacks.
   *
   * @param payload Raw request body as string
   * @param signature Signature from x-hailuo-signature header
   * @returns true if signature matches
   */
  verify(payload: string, signature: string): boolean {
    const expectedSignature = crypto
      .createHmac('sha256', this.secret)
      .update(payload)
      .digest('hex');

    // Ensure both buffers have the same length for timing-safe comparison
    const signatureBuffer = Buffer.from(signature);
    const expectedBuffer = Buffer.from(expectedSignature);

    if (signatureBuffer.length !== expectedBuffer.length) {
      return false;
    }

    // Constant-time comparison to prevent timing attacks
    return crypto.timingSafeEqual(signatureBuffer, expectedBuffer);
  }

  /**
   * Extracts the Unix timestamp from the webhook payload for replay protection.
   * Uses `created_at` field from Hailuo payload.
   *
   * @param payload Parsed Hailuo webhook payload
   * @returns Unix timestamp in seconds, or null if not present
   */
  extractTimestamp(payload: unknown): number | null {
    if (
      typeof payload === 'object' &&
      payload !== null &&
      'created_at' in payload
    ) {
      const ts = (payload as HailuoWebhookPayload).created_at;
      return typeof ts === 'number' ? ts : null;
    }
    // Fallback to timestamp field if present
    if (
      typeof payload === 'object' &&
      payload !== null &&
      'timestamp' in payload
    ) {
      const ts = (payload as HailuoWebhookPayload).timestamp;
      return typeof ts === 'number' ? ts : null;
    }
    return null;
  }
}

/**
 * Default Hailuo webhook configuration
 */
export const HAILUO_WEBHOOK_CONFIG = {
  signatureHeader: 'x-hailuo-signature',
  maxAgeSeconds: 300, // 5 minutes
} as const;

/**
 * Creates a Hailuo webhook verifier from environment configuration
 */
export function createHailuoWebhookVerifier(): HailuoWebhookVerifier {
  const secret = process.env.HAILUO_WEBHOOK_SECRET;

  if (!secret) {
    throw new Error(
      'HAILUO_WEBHOOK_SECRET environment variable is not configured',
    );
  }

  return new HailuoWebhookVerifier({ secret });
}
