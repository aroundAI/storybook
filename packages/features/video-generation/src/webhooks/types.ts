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
 * Result of webhook verification
 */
export interface WebhookVerificationResult {
  verified: boolean;
  error?:
    | 'MISSING_SIGNATURE'
    | 'INVALID_SIGNATURE'
    | 'EXPIRED'
    | 'REPLAY'
    | 'INVALID_JSON'
    | 'VERIFICATION_ERROR';
  payload?: unknown;
}

/**
 * Result of processing a webhook
 */
export interface ProcessedWebhook<T> {
  success: boolean;
  data?: T;
  error?: string;
  statusCode: number;
}

/**
 * Webhook log entry for debugging and monitoring
 */
export interface WebhookLogEntry {
  timestamp: string;
  path: string;
  method: string;
  result: string;
  durationMs: number;
  ip: string | null;
  userAgent: string | null;
  error?: string;
}

/**
 * Base payload structure for generation webhooks
 */
export interface GenerationWebhookPayload {
  task_id: string;
  status: 'completed' | 'failed' | 'processing';
  timestamp?: number;
  error_message?: string;
}

/**
 * Kling-specific webhook payload
 */
export interface KlingWebhookPayload extends GenerationWebhookPayload {
  video_url?: string;
  thumbnail_url?: string;
  duration?: number;
}

/**
 * Runway-specific webhook payload
 */
export interface RunwayWebhookPayload extends GenerationWebhookPayload {
  output_url?: string;
  preview_url?: string;
}

/**
 * Hailuo-specific webhook payload
 */
export interface HailuoWebhookPayload extends GenerationWebhookPayload {
  result_url?: string;
  cover_url?: string;
}
