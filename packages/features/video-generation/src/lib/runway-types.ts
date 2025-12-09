import type { GenerationStatus } from './types';

/**
 * Runway-specific video generation request parameters.
 * Extends the base request with Runway-specific options.
 */
export interface RunwayGenerationRequest {
  /** Text prompt describing the video to generate */
  prompt: string;
  /** Video duration in seconds. Runway Gen-3 supports 5, 10, or 18 seconds */
  duration: 5 | 10 | 18;
  /** Aspect ratio for the output video */
  aspectRatio: '16:9' | '9:16' | '1:1' | '4:5';
  /** Runway model version */
  model?: 'gen3_alpha' | 'gen3_turbo';
  /** URL of reference image for image-to-video generation */
  referenceImageUrl?: string;
  /** Motion strength for image-to-video (0-1, default 0.5) */
  motionStrength?: number;
  /** Seed for reproducible generation */
  seed?: number;
}

/**
 * Response from Runway video generation request.
 */
export interface RunwayGenerationResponse {
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
 * Status of a Runway generation job.
 */
export interface RunwayJobStatus {
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
 * Configuration for the Runway provider.
 */
export interface RunwayProviderConfig {
  /** API key for authentication */
  apiKey: string;
  /** Base URL for the Runway API (defaults to https://api.runwayml.com/v1) */
  baseUrl?: string;
  /** Request timeout in milliseconds (default: 60000) */
  timeout?: number;
  /** Webhook URL for job completion callbacks */
  webhookUrl?: string;
}

/**
 * Cost estimation result for a Runway generation request.
 */
export interface RunwayCostEstimate {
  /** Cost in cents */
  costCents: number;
  /** Cost breakdown details */
  breakdown: {
    model: 'gen3_alpha' | 'gen3_turbo';
    duration: 5 | 10 | 18;
    rateCents: number;
  };
}

// Runway API Response Types

/**
 * Runway task status values from their API.
 */
export type RunwayAPITaskStatus =
  | 'PENDING'
  | 'RUNNING'
  | 'SUCCEEDED'
  | 'FAILED'
  | 'CANCELLED';

/**
 * Response from Runway API when submitting a generation request.
 */
export interface RunwayAPIGenerationResponse {
  id: string;
  status: RunwayAPITaskStatus;
  createdAt: string;
}

/**
 * Response from Runway API when polling job status.
 */
export interface RunwayAPIStatusResponse {
  id: string;
  status: RunwayAPITaskStatus;
  progress?: number;
  output?: RunwayAPIVideoOutput[];
  failure?: string;
  failureCode?: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Video output from Runway API.
 */
export interface RunwayAPIVideoOutput {
  url: string;
  duration: number;
}

/**
 * Payload sent to Runway API for text-to-video generation.
 */
export interface RunwayAPIGenerationPayload {
  promptText: string;
  model: string;
  seconds: number;
  ratio: string;
  seed?: number;
  exploreMode: boolean;
  watermark: boolean;
  callback_url?: string;
}

/**
 * Payload sent to Runway API for image-to-video generation.
 */
export interface RunwayAPIImageToVideoPayload
  extends RunwayAPIGenerationPayload {
  promptImage: string;
  motionStrength?: number;
}

/**
 * Runway provider error codes.
 */
export type RunwayErrorCode =
  | 'RATE_LIMITED'
  | 'TIMEOUT'
  | 'AUTH_ERROR'
  | 'VALIDATION_ERROR'
  | 'PROVIDER_ERROR'
  | 'CREDIT_ERROR'
  | 'NETWORK_ERROR';

/**
 * Runway provider error with additional context.
 */
export class RunwayProviderError extends Error {
  readonly code: RunwayErrorCode;
  readonly retryable: boolean;
  readonly retryAfter?: number;

  constructor(
    message: string,
    code: RunwayErrorCode,
    options?: { retryable?: boolean; retryAfter?: number },
  ) {
    super(message);
    this.name = 'RunwayProviderError';
    this.code = code;
    this.retryable = options?.retryable ?? false;
    this.retryAfter = options?.retryAfter;
  }
}
