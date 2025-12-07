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
 * Internal status type used by generation_jobs table
 */
export type InternalJobStatus =
  | 'queued'
  | 'processing'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'dead_letter';

/**
 * Kling-specific webhook payload (via PiAPI)
 * Status values: submitted, processing, succeed, failed
 */
export interface KlingWebhookPayload {
  task_id: string;
  task_status: 'submitted' | 'processing' | 'succeed' | 'failed';
  task_status_msg: string;
  updated_at: number; // Unix timestamp
  progress: number; // 0-100
  task_result?: {
    videos: Array<{
      id: string;
      url: string;
      duration: number;
    }>;
  };
  error?: {
    code: string;
    message: string;
  };
  timestamp?: number; // For replay protection
}

/**
 * Hailuo (MiniMax) webhook payload
 * Status values: Queueing, Processing, Success, Fail
 */
export interface HailuoWebhookPayload {
  task_id: string;
  status: 'Queueing' | 'Processing' | 'Success' | 'Fail';
  progress?: number;
  video_url?: string;
  cover_url?: string; // Thumbnail
  duration?: number;
  error?: {
    code: number;
    message: string;
  };
  created_at: number;
  finished_at?: number;
  timestamp?: number; // For replay protection
}

/**
 * Runway status response (polling-based, no webhook)
 * Status values: PENDING, RUNNING, SUCCEEDED, FAILED, CANCELLED
 */
export interface RunwayStatusResponse {
  id: string;
  status: 'PENDING' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'CANCELLED';
  progress?: number;
  output?: Array<{
    url: string;
    duration: number;
  }>;
  failure?: string;
  failureCode?: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Status mapping: Kling provider status to internal status
 */
export const KLING_STATUS_MAP: Record<
  KlingWebhookPayload['task_status'],
  InternalJobStatus
> = {
  submitted: 'queued',
  processing: 'processing',
  succeed: 'completed',
  failed: 'failed',
};

/**
 * Status mapping: Hailuo provider status to internal status
 */
export const HAILUO_STATUS_MAP: Record<
  HailuoWebhookPayload['status'],
  InternalJobStatus
> = {
  Queueing: 'queued',
  Processing: 'processing',
  Success: 'completed',
  Fail: 'failed',
};

/**
 * Status mapping: Runway provider status to internal status
 */
export const RUNWAY_STATUS_MAP: Record<
  RunwayStatusResponse['status'],
  InternalJobStatus
> = {
  PENDING: 'queued',
  RUNNING: 'processing',
  SUCCEEDED: 'completed',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
};
