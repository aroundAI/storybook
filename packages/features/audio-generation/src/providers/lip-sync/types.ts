/**
 * Lip sync provider types
 * Provides type definitions for lip sync providers (SyncLabs, Wav2Lip, etc.)
 */

// Provider types
export type LipSyncProviderName = 'synclabs' | 'wav2lip';

// Quality settings
export type LipSyncQuality = 'fast' | 'standard' | 'high';

// Job status
export type LipSyncJobStatus =
  | 'queued'
  | 'pending'
  | 'processing'
  | 'completed'
  | 'failed';

/**
 * Face coordinates for face detection
 */
export interface FaceCoordinates {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Input for lip sync generation
 */
export interface LipSyncInput {
  videoUrl: string;
  audioUrl: string;
  faceCoordinates?: FaceCoordinates;
  quality: LipSyncQuality;
}

/**
 * Result from lip sync operation
 */
export interface LipSyncResult {
  status: LipSyncJobStatus;
  outputUrl?: string;
  error?: string;
  progress?: number;
}

/**
 * Lip sync provider interface
 */
export interface LipSyncProvider {
  readonly name: string;

  /**
   * Generate lip sync from video and audio
   * @returns Job ID for tracking
   */
  generateLipSync(input: LipSyncInput): Promise<string>;

  /**
   * Get status of a lip sync job
   */
  getStatus(jobId: string): Promise<LipSyncResult>;

  /**
   * Estimate duration for processing (in seconds)
   */
  estimateDuration(input: LipSyncInput): number;

  /**
   * Estimate cost for lip sync (in cents)
   */
  estimateCost(input: LipSyncInput): number;

  /**
   * Get rate limit configuration
   */
  getRateLimits(): {
    requestsPerMinute: number;
    concurrentRequests: number;
    dailyLimit?: number;
  };
}

/**
 * Lip sync provider configuration
 */
export interface LipSyncProviderConfig {
  apiKey: string;
  baseUrl?: string;
  timeout?: number;
  maxRetries?: number;
}

/**
 * Lip sync provider metadata
 */
export interface LipSyncProviderMetadata {
  name: LipSyncProviderName;
  displayName: string;
  description: string;
  supportedQualities: readonly LipSyncQuality[];
  costPerJob: number; // cents
  averageProcessingTime: number; // seconds
}

/**
 * Lip sync generation job from database
 */
export interface LipSyncJob {
  id: string;
  shot_id: string;
  dialogue_line_id: string;
  provider: LipSyncProviderName;
  status: LipSyncJobStatus;
  input_video_url: string;
  input_audio_url: string;
  output_video_url: string | null;
  face_coordinates: FaceCoordinates | null;
  quality: LipSyncQuality;
  provider_job_id: string | null;
  error_message: string | null;
  processing_time_seconds: number | null;
  created_at: string;
  completed_at: string | null;
}

/**
 * Factory options for lip sync provider
 */
export interface LipSyncProviderFactoryOptions {
  accountId: string;
  provider?: LipSyncProviderName;
}
