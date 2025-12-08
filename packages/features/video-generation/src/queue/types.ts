import { z } from 'zod';

import type { VideoProvider } from '../lib/types';

/**
 * Video generation job data - payload for queue jobs
 */
export interface VideoGenerationJobData {
  /** Account ID that owns the job */
  accountId: string;
  /** Project ID containing the shot */
  projectId: string;
  /** Shot ID being generated */
  shotId: string;
  /** Video provider to use */
  provider: VideoProvider;
  /** Generation job ID in database */
  generationJobId: string;
  /** Generation prompt */
  prompt: string;
  /** Video duration in seconds */
  duration: string;
  /** Aspect ratio (e.g., "16:9", "9:16") */
  aspectRatio: string;
  /** Generation mode (provider-specific) */
  mode?: string;
  /** Reference image URL for image-to-video */
  referenceImageUrl?: string;
  /** Job priority (0-10, higher = more important) */
  priority: number;
}

/**
 * Result of processing a video generation job
 */
export interface VideoGenerationJobResult {
  /** Whether the job was successful */
  success: boolean;
  /** URL to the generated video (on success) */
  videoUrl?: string;
  /** URL to the video thumbnail (on success) */
  thumbnailUrl?: string;
  /** Error message (on failure) */
  errorMessage?: string;
  /** Error code (on failure) */
  errorCode?: string;
  /** Provider-specific job ID */
  providerJobId?: string;
}

/**
 * Zod schema for validating job data
 */
export const VideoGenerationJobSchema = z.object({
  accountId: z.string().uuid(),
  projectId: z.string().uuid(),
  shotId: z.string().uuid(),
  provider: z.enum(['kling', 'runway', 'luma']),
  generationJobId: z.string().uuid(),
  prompt: z.string().min(1),
  duration: z.string(),
  aspectRatio: z.string(),
  mode: z.string().optional(),
  referenceImageUrl: z.string().url().optional(),
  priority: z.number().int().min(0).max(10).default(5),
});

/**
 * Queue job status
 */
export type QueueJobStatus =
  | 'queued'
  | 'processing'
  | 'completed'
  | 'failed'
  | 'unknown';

/**
 * Queue metrics for monitoring
 */
export interface QueueMetrics {
  /** Number of jobs waiting to be processed */
  waiting: number;
  /** Number of jobs currently being processed */
  active: number;
  /** Number of successfully completed jobs */
  completed: number;
  /** Number of failed jobs */
  failed: number;
  /** Total pending jobs (waiting + active) */
  total: number;
}

/**
 * Options for adding a job to the queue
 */
export interface AddJobOptions {
  /** Job priority (0-10, higher = more important, default: 5) */
  priority?: number;
  /** Delay before processing in milliseconds */
  delay?: number;
  /** Custom job ID (defaults to generationJobId) */
  jobId?: string;
}
