/**
 * Render Job Types
 *
 * Types for render job management across all providers.
 */
import type { Timeline } from '../schema/timeline';

// ============================================================================
// Render Status
// ============================================================================

export type RenderStatus =
  | 'pending'
  | 'queued'
  | 'processing'
  | 'completed'
  | 'failed'
  | 'cancelled';

// ============================================================================
// Render Provider
// ============================================================================

export type RenderProviderType =
  | 'ffmpeg'
  | 'remotion'
  | 'shotstack'
  | 'creatomate';

// ============================================================================
// Render Job
// ============================================================================

/**
 * Render job request
 */
export interface RenderJobRequest {
  /** Timeline to render */
  timeline: Timeline;

  /** Priority (0-10, higher = more urgent) */
  priority?: number;

  /** Webhook URL for status updates */
  webhookUrl?: string;

  /** Callback URL when complete */
  callbackUrl?: string;

  /** Idempotency key to prevent duplicate renders */
  idempotencyKey?: string;

  /** Additional provider-specific options */
  options?: Record<string, unknown>;

  /** Custom metadata to attach to the job */
  metadata?: string;
}

/**
 * Render job response
 */
export interface RenderJobResponse {
  /** Job ID from the provider */
  jobId: string;

  /** Current status */
  status: RenderStatus;

  /** Estimated completion time in seconds */
  estimatedTime?: number;

  /** Provider-specific message */
  message?: string;

  /** When the job was created */
  createdAt: string;
}

/**
 * Render job status response
 */
export interface RenderJobStatus {
  /** Job ID */
  jobId: string;

  /** Current status */
  status: RenderStatus;

  /** Progress percentage (0-100) */
  progress?: number;

  /** URL to the rendered video (when complete) */
  videoUrl?: string;

  /** URL to thumbnail (when complete) */
  thumbnailUrl?: string;

  /** Error message (when failed) */
  error?: string;

  /** Error code (when failed) */
  errorCode?: string;

  /** When the job started processing */
  startedAt?: string;

  /** When the job completed */
  completedAt?: string;

  /** Estimated time remaining in seconds */
  estimatedTimeRemaining?: number;

  /** Provider-specific metadata */
  metadata?: Record<string, unknown>;
}

// ============================================================================
// Cost Estimation
// ============================================================================

/**
 * Render cost estimate
 */
export interface RenderCostEstimate {
  /** Provider name */
  provider: RenderProviderType;

  /** Estimated cost in cents */
  estimatedCostCents: number;

  /** Cost breakdown */
  breakdown?: {
    /** Base render cost */
    baseCost: number;

    /** Per-second cost */
    perSecondCost: number;

    /** Duration in seconds */
    durationSeconds: number;

    /** Quality multiplier */
    qualityMultiplier: number;

    /** Resolution multiplier */
    resolutionMultiplier: number;
  };

  /** Whether this is a fixed price or estimate */
  isFixed: boolean;

  /** Human-readable cost string */
  displayCost: string;
}

// ============================================================================
// Provider Capabilities
// ============================================================================

/**
 * Provider capability information
 */
export interface RenderCapabilities {
  /** Provider name */
  name: RenderProviderType;

  /** Supported transition types */
  supportedTransitions: string[];

  /** Maximum video duration in seconds */
  maxDuration: number;

  /** Supported output formats */
  supportedFormats: string[];

  /** Supported video codecs */
  supportedCodecs: string[];

  /** Maximum resolution (width) */
  maxWidth: number;

  /** Maximum resolution (height) */
  maxHeight: number;

  /** Whether the provider supports real-time preview */
  supportsPreview: boolean;

  /** Whether the provider supports streaming output */
  supportsStreaming: boolean;

  /** Whether the provider runs locally */
  isLocal: boolean;

  /** Typical render speed ratio (1 = realtime, 0.5 = 2x speed, etc.) */
  typicalRenderSpeed: number;
}

// ============================================================================
// Provider Configuration
// ============================================================================

/**
 * Base provider configuration
 */
export interface BaseProviderConfig {
  /** Provider type */
  provider: RenderProviderType;

  /** Enable debug logging */
  debug?: boolean;

  /** Request timeout in milliseconds */
  timeout?: number;
}

/**
 * FFmpeg provider configuration
 */
export interface FFmpegProviderConfig extends BaseProviderConfig {
  provider: 'ffmpeg';

  /** Path to FFmpeg binary */
  ffmpegPath?: string;

  /** Path to FFprobe binary */
  ffprobePath?: string;

  /** Working directory for temp files */
  workingDir?: string;

  /** Number of threads to use */
  threads?: number;

  /** Hardware acceleration type */
  hwaccel?: 'none' | 'cuda' | 'videotoolbox' | 'qsv' | 'vaapi';
}

/**
 * Remotion provider configuration
 */
export interface RemotionProviderConfig extends BaseProviderConfig {
  provider: 'remotion';

  /** Lambda function ARN (for cloud rendering) */
  lambdaArn?: string;

  /** AWS region */
  region?: string;

  /** S3 bucket for output */
  outputBucket?: string;

  /** Render locally instead of Lambda */
  renderLocally?: boolean;

  /** Concurrency for local rendering */
  concurrency?: number;
}

/**
 * Shotstack provider configuration
 */
export interface ShotstackProviderConfig extends BaseProviderConfig {
  provider: 'shotstack';

  /** API key */
  apiKey: string;

  /** Environment (staging or production) */
  environment?: 'staging' | 'production';

  /** Base URL override */
  baseUrl?: string;
}

/**
 * Creatomate provider configuration
 */
export interface CreatomateProviderConfig extends BaseProviderConfig {
  provider: 'creatomate';

  /** API key */
  apiKey: string;

  /** Base URL override */
  baseUrl?: string;
}

/**
 * Union of all provider configurations
 */
export type ProviderConfig =
  | FFmpegProviderConfig
  | RemotionProviderConfig
  | ShotstackProviderConfig
  | CreatomateProviderConfig;

// ============================================================================
// Webhook Types
// ============================================================================

/**
 * Webhook payload for render status updates
 */
export interface RenderWebhookPayload {
  /** Event type */
  event:
    | 'render.started'
    | 'render.progress'
    | 'render.completed'
    | 'render.failed';

  /** Job ID */
  jobId: string;

  /** Current status */
  status: RenderStatus;

  /** Progress (0-100) */
  progress?: number;

  /** Video URL (on completion) */
  videoUrl?: string;

  /** Error message (on failure) */
  error?: string;

  /** Timestamp */
  timestamp: string;

  /** Provider name */
  provider: RenderProviderType;
}
