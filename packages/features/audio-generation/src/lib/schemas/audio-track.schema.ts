import { z } from 'zod';

/**
 * Audio Track Schemas and Types for FILM-505 Audio Studio
 */

// =============================================================================
// Schemas
// =============================================================================

export const GetAudioTracksSchema = z.object({
  episodeId: z.string().uuid(),
  type: z
    .enum(['music', 'sfx', 'dialogue_composite', 'ambient'])
    .optional()
    .describe('Filter by track type'),
});

export type GetAudioTracksSchemaType = z.infer<typeof GetAudioTracksSchema>;

export const DeleteAudioTrackSchema = z.object({
  trackId: z.string().uuid(),
});

export type DeleteAudioTrackSchemaType = z.infer<typeof DeleteAudioTrackSchema>;

// =============================================================================
// Types
// =============================================================================

/**
 * Valid audio track types matching the database CHECK constraint
 */
export type AudioTrackType = 'music' | 'sfx' | 'dialogue_composite' | 'ambient';

/**
 * Status of audio track generation
 */
export type AudioTrackStatus =
  | 'pending'
  | 'processing'
  | 'completed'
  | 'failed';

/**
 * Metadata stored in the JSONB column for audio tracks
 */
export interface AudioTrackMetadata {
  /** Provider used for generation (e.g., 'elevenlabs', 'uploaded') */
  provider?: string;
  /** Music genre */
  genre?: string;
  /** Mood/atmosphere (e.g., 'upbeat', 'somber', 'intense') */
  mood?: string;
  /** Original prompt used for generation */
  prompt?: string;
  /** Beats per minute */
  bpm?: number;
  /** Fade in duration in seconds */
  fadeIn?: number;
  /** Fade out duration in seconds */
  fadeOut?: number;
  /** Whether track should loop */
  loop?: boolean;
  /** ISO timestamp of when generation completed */
  generatedAt?: string;
  /** Cost of generation in cents */
  costCents?: number;
  /** Current generation status */
  status?: AudioTrackStatus;
  /** Error message if generation failed */
  error?: string;
  /** Provider-specific job ID for polling */
  providerJobId?: string;
}

/**
 * Transformed audio track for client use
 */
export interface AudioTrack {
  /** Unique identifier */
  id: string;
  /** Episode this track belongs to */
  episodeId: string;
  /** Track type */
  type: AudioTrackType;
  /** Track name/description */
  name: string | null;
  /** URL to audio file (null if not yet generated) */
  fileUrl: string | null;
  /** Duration in seconds */
  durationSeconds: number | null;
  /** Start position in timeline (seconds) */
  timelineStartSeconds: number;
  /** Volume level (0.0 - 2.0) */
  volume: number;
  /** Generation and track metadata */
  metadata: AudioTrackMetadata | null;
  /** Creation timestamp */
  createdAt: string;
  /** Computed status from metadata or presence of fileUrl */
  status: AudioTrackStatus;
}

/**
 * Summary counts for audio tracks
 */
export interface AudioTrackSummary {
  total: number;
  pending: number;
  processing: number;
  completed: number;
  failed: number;
}

/**
 * Result of fetching audio tracks
 */
export interface GetAudioTracksResult {
  tracks: AudioTrack[];
  summary: AudioTrackSummary;
}
