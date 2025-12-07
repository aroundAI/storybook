import crypto from 'crypto';

import type {
  ElevenLabsWebhookPayload,
  WebhookConfig,
  WebhookVerifier,
} from '../types';

/**
 * Webhook signature verifier for ElevenLabs voice generation provider.
 *
 * ElevenLabs uses HMAC-SHA256 for webhook signature verification.
 * The signature is provided with a 'sha256=' prefix in the header.
 */
export class ElevenLabsWebhookVerifier implements WebhookVerifier {
  private readonly secret: string;

  constructor(config: Pick<WebhookConfig, 'secret'>) {
    this.secret = config.secret;
  }

  /**
   * Verifies the HMAC-SHA256 signature of the webhook payload.
   * ElevenLabs includes a 'sha256=' prefix that must be stripped.
   * Uses constant-time comparison to prevent timing attacks.
   *
   * @param payload Raw request body as string
   * @param signature Signature from header (may include 'sha256=' prefix)
   * @returns true if signature matches
   */
  verify(payload: string, signature: string): boolean {
    const expectedSignature = crypto
      .createHmac('sha256', this.secret)
      .update(payload)
      .digest('hex');

    // ElevenLabs uses 'sha256=' prefix
    const normalizedSignature = signature.replace(/^sha256=/, '');

    // Ensure both buffers have the same length for timing-safe comparison
    const signatureBuffer = Buffer.from(normalizedSignature);
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
   * @param payload Parsed ElevenLabs webhook payload
   * @returns Unix timestamp in seconds, or null if not present
   */
  extractTimestamp(payload: unknown): number | null {
    if (
      typeof payload === 'object' &&
      payload !== null &&
      'timestamp' in payload
    ) {
      const ts = (payload as ElevenLabsWebhookPayload).timestamp;
      return typeof ts === 'number' ? ts : null;
    }
    return null;
  }
}

/**
 * Default ElevenLabs webhook configuration
 */
export const ELEVENLABS_WEBHOOK_CONFIG = {
  signatureHeader: 'x-elevenlabs-signature',
  maxAgeSeconds: 300, // 5 minutes
} as const;

/**
 * Creates an ElevenLabs webhook verifier from environment configuration
 */
export function createElevenLabsWebhookVerifier(): ElevenLabsWebhookVerifier {
  const secret = process.env.ELEVENLABS_WEBHOOK_SECRET;

  if (!secret) {
    throw new Error(
      'ELEVENLABS_WEBHOOK_SECRET environment variable is not configured',
    );
  }

  return new ElevenLabsWebhookVerifier({ secret });
}
