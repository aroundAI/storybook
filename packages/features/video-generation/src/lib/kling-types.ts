import type { GenerationStatus } from './types';

/**
 * Kling-specific video generation request parameters.
 * Extends the base request with Kling-specific options.
 */
export interface KlingGenerationRequest {
  /** Text prompt describing the video to generate */
  prompt: string;
  /** Negative prompt for quality control (what to avoid) */
  negativePrompt?: string;
  /** Video duration in seconds. Kling supports 5 or 10 seconds */
  duration: 5 | 10;
  /** Aspect ratio for the output video */
  aspectRatio: '16:9' | '9:16' | '1:1';
  /** Kling model version */
  model?: 'kling-v1.0' | 'kling-v1.5';
  /** Quality mode: std (standard) or pro (professional) */
  mode?: 'std' | 'pro';
  /** URL of reference image for image-to-video generation */
  referenceImageUrl?: string;
  /** Seed for reproducible generation */
  seed?: number;
}

/**
 * Response from Kling video generation request.
 */
export interface KlingGenerationResponse {
  /** Provider-specific job ID for tracking */
  providerJobId: string;
  /** Initial job status */
  status: 'pending' | 'processing';
  /** Estimated time to complete in seconds */
  estimatedTime: number;
  /** Optional message from the provider */
  message?: string;
}

/**
 * Status of a Kling generation job.
 */
export interface KlingJobStatus {
  /** Provider job ID */
  jobId: string;
  /** Current job status */
  status: GenerationStatus;
  /** Progress percentage (0-100) */
  progress?: number;
  /** URL to the generated video (when completed) */
  videoUrl?: string;
  /** URL to the video thumbnail (when completed) */
  thumbnailUrl?: string;
  /** Error message if job failed */
  errorMessage?: string;
  /** Error code if job failed */
  errorCode?: string;
  /** ISO timestamp when job completed */
  completedAt?: string;
}

/**
 * Configuration for the Kling provider.
 */
export interface KlingProviderConfig {
  /** API key for authentication */
  apiKey: string;
  /** Base URL for the Kling API (defaults to PiAPI endpoint) */
  baseUrl?: string;
  /** Request timeout in milliseconds (default: 30000) */
  timeout?: number;
  /** Webhook URL for job completion callbacks */
  webhookUrl?: string;
}

/**
 * Cost estimation result for a Kling generation request.
 */
export interface KlingCostEstimate {
  /** Cost in cents */
  costCents: number;
  /** Cost breakdown details */
  breakdown: {
    mode: 'std' | 'pro';
    duration: number;
    ratePerSecond: number;
  };
}

// PiAPI Response Types

/**
 * Response from PiAPI when submitting a generation request.
 */
export interface PiAPIGenerationResponse {
  code: number;
  message: string;
  data: {
    task_id: string;
    task_status: string;
    created_at: number;
  };
}

/**
 * Response from PiAPI when polling job status.
 */
export interface PiAPIStatusResponse {
  code: number;
  message: string;
  data: {
    task_id: string;
    task_status: PiAPITaskStatus;
    task_status_msg: string;
    created_at: number;
    updated_at: number;
    progress: number;
    task_result?: {
      videos: PiAPIVideoResult[];
    };
  };
}

/**
 * PiAPI task status values.
 */
export type PiAPITaskStatus = 'submitted' | 'processing' | 'succeed' | 'failed';

/**
 * Video result from PiAPI.
 */
export interface PiAPIVideoResult {
  id: string;
  url: string;
  duration: number;
}

/**
 * Payload sent to PiAPI for text-to-video generation.
 */
export interface PiAPIGenerationPayload {
  model: string;
  prompt: string;
  negative_prompt?: string;
  cfg_scale: number;
  mode: string;
  aspect_ratio: string;
  duration: string;
  seed?: number;
  callback_url?: string;
}

/**
 * Payload sent to PiAPI for image-to-video generation.
 */
export interface PiAPIImageToVideoPayload
  extends Omit<PiAPIGenerationPayload, 'aspect_ratio'> {
  image_url: string;
}

/**
 * Error response from PiAPI.
 */
export interface PiAPIErrorResponse {
  code: number;
  message: string;
  error?: {
    type: string;
    message: string;
  };
}

/**
 * Kling provider error codes.
 */
export type KlingErrorCode =
  | 'RATE_LIMITED'
  | 'TIMEOUT'
  | 'AUTH_ERROR'
  | 'VALIDATION_ERROR'
  | 'PROVIDER_ERROR'
  | 'CREDIT_ERROR'
  | 'NETWORK_ERROR';

/**
 * Kling provider error with additional context.
 */
export class KlingProviderError extends Error {
  readonly code: KlingErrorCode;
  readonly retryable: boolean;
  readonly retryAfter?: number;

  constructor(
    message: string,
    code: KlingErrorCode,
    options?: { retryable?: boolean; retryAfter?: number },
  ) {
    super(message);
    this.name = 'KlingProviderError';
    this.code = code;
    this.retryable = options?.retryable ?? false;
    this.retryAfter = options?.retryAfter;
  }
}
