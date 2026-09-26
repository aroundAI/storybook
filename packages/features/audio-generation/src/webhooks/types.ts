/**
 * Interface for webhook signature verification
 */
export interface WebhookVerifier {
  /**
   * Verifies the webhook signature
   * @param payload Raw request body as string
   * @param signature Signature from request header
   * @returns true if signature is valid
   */
  verify(payload: string, signature: string): boolean;

  /**
   * Extracts timestamp from webhook for replay protection
   * @param payload Parsed webhook body
   * @returns Unix timestamp or null if not supported
   */
  extractTimestamp?(payload: unknown): number | null;
}

/**
 * Configuration for webhook verification
 */
export interface WebhookConfig {
  /** Secret key for HMAC signature verification */
  secret: string;
  /** Header name containing the signature */
  signatureHeader: string;
  /** Optional header name containing the timestamp */
  timestampHeader?: string;
  /** Maximum age of webhook in seconds before rejection */
  maxAgeSeconds: number;
}

/**
 * Base payload structure for audio generation webhooks
 */
export interface AudioGenerationWebhookPayload {
  task_id: string;
  status: 'completed' | 'failed' | 'processing';
  timestamp?: number;
  error_message?: string;
}

/**
 * ElevenLabs-specific webhook payload for voice generation
 */
export interface ElevenLabsWebhookPayload
  extends AudioGenerationWebhookPayload {
  audio_url?: string;
  duration_seconds?: number;
  character_count?: number;
  voice_id?: string;
}

/**
 * PlayHT-specific webhook payload
 */
export interface PlayHTWebhookPayload extends AudioGenerationWebhookPayload {
  output_url?: string;
  duration_ms?: number;
}

/**
 * Music generation webhook payload
 */
export interface MusicGenerationWebhookPayload
  extends AudioGenerationWebhookPayload {
  music_url?: string;
  duration_seconds?: number;
  title?: string;
  style?: string;
}
