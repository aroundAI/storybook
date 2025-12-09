import type { GenerationStatus } from '../../lib/types';

/**
 * Hailuo-specific video generation request parameters.
 */
export interface HailuoGenerationRequest {
  prompt: string;
  duration?: 5 | 6;
  aspectRatio?: '16:9' | '9:16' | '1:1';
  referenceImageUrl?: string;
}

/**
 * Response from Hailuo video generation request.
 */
export interface HailuoGenerationResponse {
  providerJobId: string;
  status: 'pending' | 'processing';
  estimatedTime: number;
  message?: string;
}

/**
 * Status of a Hailuo generation job.
 */
export interface HailuoJobStatus {
  jobId: string;
  status: GenerationStatus;
  progress?: number;
  videoUrl?: string;
  thumbnailUrl?: string;
  errorMessage?: string;
  errorCode?: string;
  completedAt?: string;
}

/**
 * Configuration for the Hailuo provider.
 */
export interface HailuoProviderConfig {
  apiKey: string;
  baseUrl?: string;
  timeout?: number;
  webhookUrl?: string;
}

/**
 * Cost estimation result for a Hailuo generation request.
 */
export interface HailuoCostEstimate {
  costCents: number;
}

/**
 * Response from Hailuo API when submitting a generation request.
 */
export interface HailuoTaskResponse {
  task_id: string;
  base_resp: {
    status_code: number;
    status_msg: string;
  };
}

/**
 * Hailuo API status values.
 */
export type HailuoApiStatus = 'Queueing' | 'Processing' | 'Success' | 'Fail';

/**
 * Response from Hailuo API when polling job status.
 */
export interface HailuoStatusResponse {
  task_id: string;
  status: HailuoApiStatus;
  file_id?: string;
  base_resp: {
    status_code: number;
    status_msg: string;
  };
}

/**
 * Response from Hailuo API when retrieving file info.
 */
export interface HailuoFileResponse {
  file: {
    file_id: string;
    download_url: string;
  };
  base_resp: {
    status_code: number;
    status_msg: string;
  };
}

/**
 * Base response structure from Hailuo API.
 * All API responses include this structure.
 */
export interface HailuoBaseResponse {
  base_resp: {
    status_code: number;
    status_msg: string;
  };
}

/**
 * Error response from Hailuo API.
 * Used for parsing error details from failed requests.
 */
export interface HailuoErrorResponse extends HailuoBaseResponse {
  error?: {
    code: number;
    message: string;
  };
}

/**
 * Hailuo provider error codes.
 */
export type HailuoErrorCode =
  | 'RATE_LIMITED'
  | 'TIMEOUT'
  | 'AUTH_ERROR'
  | 'VALIDATION_ERROR'
  | 'PROVIDER_ERROR'
  | 'NETWORK_ERROR';

/**
 * Hailuo provider error with additional context.
 */
export class HailuoProviderError extends Error {
  readonly code: HailuoErrorCode;
  readonly retryable: boolean;
  readonly retryAfter?: number;

  constructor(
    message: string,
    code: HailuoErrorCode,
    options?: { retryable?: boolean; retryAfter?: number },
  ) {
    super(message);
    this.name = 'HailuoProviderError';
    this.code = code;
    this.retryable = options?.retryable ?? false;
    this.retryAfter = options?.retryAfter;
  }
}
