import crypto from 'crypto';

import type {
  KlingWebhookPayload,
  WebhookConfig,
  WebhookVerifier,
} from '../types';

/**
 * Webhook signature verifier for Kling AI video generation provider.
 *
 * Kling uses HMAC-SHA256 for webhook signature verification.
 * The signature is provided in the 'x-kling-signature' header.
 */
export class KlingWebhookVerifier implements WebhookVerifier {
  private readonly secret: string;

  constructor(config: Pick<WebhookConfig, 'secret'>) {
    this.secret = config.secret;
  }

  /**
   * Verifies the HMAC-SHA256 signature of the webhook payload.
   * Uses constant-time comparison to prevent timing attacks.
   *
   * @param payload Raw request body as string
   * @param signature Signature from x-kling-signature header
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
   *
   * @param payload Parsed Kling webhook payload
   * @returns Unix timestamp in seconds, or null if not present
   */
  extractTimestamp(payload: unknown): number | null {
    if (
      typeof payload === 'object' &&
      payload !== null &&
      'timestamp' in payload
    ) {
      const ts = (payload as KlingWebhookPayload).timestamp;
      return typeof ts === 'number' ? ts : null;
    }
    return null;
  }
}

/**
 * Default Kling webhook configuration
 */
export const KLING_WEBHOOK_CONFIG = {
  signatureHeader: 'x-kling-signature',
  maxAgeSeconds: 300, // 5 minutes
} as const;

/**
 * Creates a Kling webhook verifier from environment configuration
 */
export function createKlingWebhookVerifier(): KlingWebhookVerifier {
  const secret = process.env.KLING_WEBHOOK_SECRET;

  if (!secret) {
    throw new Error(
      'KLING_WEBHOOK_SECRET environment variable is not configured',
    );
  }

  return new KlingWebhookVerifier({ secret });
}
