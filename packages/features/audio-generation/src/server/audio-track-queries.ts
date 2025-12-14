'use server';

import 'server-only';

import { enhanceAction } from '@kit/next/actions';
import { getLogger } from '@kit/shared/logger';
import { requireUser } from '@kit/supabase/require-user';
import { getSupabaseServerClient } from '@kit/supabase/server-client';
import { z } from 'zod';

/**
 * Audio Track Queries for FILM-505 Audio Studio
 *
 * Server actions for fetching and managing audio tracks (music, sfx, etc.)
 * associated with episodes.
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
  /** Provider used for generation (e.g., 'suno', 'elevenlabs', 'uploaded') */
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
 * Database row type for audio_tracks table
 */
interface AudioTrackRow {
  id: string;
  episode_id: string;
  type: AudioTrackType;
  name: string | null;
  file_url: string | null;
  duration_seconds: number | null;
  timeline_start_seconds: number;
  volume: number;
  metadata: AudioTrackMetadata | null;
  created_at: string;
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

// =============================================================================
// Helpers
// =============================================================================

/**
 * Determine the effective status of an audio track
 */
function getTrackStatus(row: AudioTrackRow): AudioTrackStatus {
  // If metadata has explicit status, use it
  if (row.metadata?.status) {
    return row.metadata.status;
  }

  // If we have a file URL, track is completed
  if (row.file_url) {
    return 'completed';
  }

  // Default to pending
  return 'pending';
}

/**
 * Transform database row to client-friendly AudioTrack
 */
function transformAudioTrack(row: AudioTrackRow): AudioTrack {
  return {
    id: row.id,
    episodeId: row.episode_id,
    type: row.type,
    name: row.name,
    fileUrl: row.file_url,
    durationSeconds: row.duration_seconds,
    timelineStartSeconds: row.timeline_start_seconds,
    volume: row.volume,
    metadata: row.metadata,
    createdAt: row.created_at,
    status: getTrackStatus(row),
  };
}

/**
 * Calculate summary counts from tracks
 */
function calculateSummary(tracks: AudioTrack[]): AudioTrackSummary {
  return {
    total: tracks.length,
    pending: tracks.filter((t) => t.status === 'pending').length,
    processing: tracks.filter((t) => t.status === 'processing').length,
    completed: tracks.filter((t) => t.status === 'completed').length,
    failed: tracks.filter((t) => t.status === 'failed').length,
  };
}

// =============================================================================
// Actions
// =============================================================================

/**
 * Fetch audio tracks for an episode
 *
 * Returns all audio tracks (music, sfx, etc.) for a given episode,
 * optionally filtered by type. Tracks are ordered by creation time (newest first).
 *
 * @example
 * // Get all music tracks for an episode
 * const result = await getAudioTracksAction({
 *   episodeId: 'uuid-here',
 *   type: 'music'
 * });
 */
export const getAudioTracksAction = enhanceAction(
  async (data: GetAudioTracksSchemaType): Promise<GetAudioTracksResult> => {
    const logger = await getLogger();
    const ctx = {
      name: 'audio.getTracks',
      episodeId: data.episodeId,
      type: data.type,
    };

    logger.info(ctx, 'Fetching audio tracks for episode');

    const client = getSupabaseServerClient();
    const { data: user, error: authError } = await requireUser(client);

    if (authError || !user) {
      logger.warn(ctx, 'Unauthorized audio tracks fetch attempt');
      throw new Error('Authentication required');
    }

    // Build query - RLS will enforce episode access
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let query = (client as any)
      .from('audio_tracks')
      .select(
        `
        id,
        episode_id,
        type,
        name,
        file_url,
        duration_seconds,
        timeline_start_seconds,
        volume,
        metadata,
        created_at
      `,
      )
      .eq('episode_id', data.episodeId)
      .order('created_at', { ascending: false });

    // Apply type filter if provided
    if (data.type) {
      query = query.eq('type', data.type);
    }

    const { data: rows, error } = await query;

    if (error) {
      logger.error({ ...ctx, error }, 'Failed to fetch audio tracks');
      throw new Error('Failed to fetch audio tracks');
    }

    const audioRows = (rows ?? []) as AudioTrackRow[];
    const tracks = audioRows.map(transformAudioTrack);
    const summary = calculateSummary(tracks);

    logger.info(
      { ...ctx, total: summary.total, completed: summary.completed },
      'Audio tracks fetched successfully',
    );

    return { tracks, summary };
  },
  {
    schema: GetAudioTracksSchema,
  },
);

/**
 * Delete an audio track
 *
 * Permanently removes an audio track from the database.
 * The associated audio file in storage is NOT deleted (handled separately).
 *
 * @throws {Error} If track not found or user lacks access
 */
export const deleteAudioTrackAction = enhanceAction(
  async (
    data: DeleteAudioTrackSchemaType,
  ): Promise<{ success: boolean; trackId: string }> => {
    const logger = await getLogger();
    const ctx = {
      name: 'audio.deleteTrack',
      trackId: data.trackId,
    };

    logger.info(ctx, 'Deleting audio track');

    const client = getSupabaseServerClient();
    const { data: user, error: authError } = await requireUser(client);

    if (authError || !user) {
      logger.warn(ctx, 'Unauthorized audio track delete attempt');
      throw new Error('Authentication required');
    }

    // Delete track - RLS will enforce access control
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (client as any)
      .from('audio_tracks')
      .delete()
      .eq('id', data.trackId);

    if (error) {
      logger.error({ ...ctx, error }, 'Failed to delete audio track');
      throw new Error('Failed to delete audio track');
    }

    logger.info(ctx, 'Audio track deleted successfully');

    return { success: true, trackId: data.trackId };
  },
  {
    schema: DeleteAudioTrackSchema,
  },
);
