/**
 * Timeline Schema
 *
 * Unified timeline schema for video stitching that works across all rendering approaches:
 * - FFmpeg (converted to command line arguments)
 * - Remotion (converted to React composition props)
 * - Shotstack (converted to Shotstack JSON format)
 * - Creatomate (converted to Creatomate JSON format)
 *
 * Based on FILM-604 auto-stitch and FILM-601 timeline editor specifications.
 */
import { z } from 'zod';

// ============================================================================
// Enums
// ============================================================================

export const TrackTypeSchema = z.enum([
  'video',
  'dialogue',
  'music',
  'sfx',
  'ambient',
]);

export const TransitionTypeSchema = z.enum([
  'cut',
  'fade',
  'crossfade',
  'wipe',
  'dissolve',
  'slide',
]);

export const VideoCodecSchema = z.enum(['h264', 'h265', 'vp9', 'prores']);

export const AudioCodecSchema = z.enum(['aac', 'mp3', 'opus', 'pcm']);

export const OutputFormatSchema = z.enum(['mp4', 'webm', 'mov', 'mkv']);

export const RenderQualitySchema = z.enum(['draft', 'standard', 'high']);

export const WipeDirectionSchema = z.enum([
  'left',
  'right',
  'up',
  'down',
  'radial',
]);

// ============================================================================
// Clip Schema
// ============================================================================

export const ClipSchema = z.object({
  /** Unique identifier for the clip */
  id: z.string().uuid(),

  /** Reference to the track this clip belongs to */
  trackId: z.string(),

  /** Optional reference to asset ID in database */
  assetId: z.string().uuid().optional(),

  /** URL to the source media file */
  assetUrl: z.string().url(),

  /** Display name for the clip */
  name: z.string().min(1).max(255),

  /** Start position on the timeline in seconds */
  startTime: z.number().nonnegative(),

  /** Duration of the clip on timeline in seconds */
  duration: z.number().positive(),

  /** Start point within the source media in seconds (for trimming) */
  sourceStart: z.number().nonnegative().optional(),

  /** End point within the source media in seconds (for trimming) */
  sourceEnd: z.number().positive().optional(),

  /** Clip volume (0-2, where 1 is normal) */
  volume: z.number().min(0).max(2).default(1),

  /** Fade in duration in seconds */
  fadeIn: z.number().nonnegative().optional(),

  /** Fade out duration in seconds */
  fadeOut: z.number().nonnegative().optional(),

  /** Optional thumbnail URL for preview */
  thumbnailUrl: z.string().url().optional(),

  /** Placeholder clip (no actual media yet) */
  isPlaceholder: z.boolean().default(false),

  /** Additional clip-specific metadata */
  metadata: z.record(z.unknown()).optional(),
});

// ============================================================================
// Track Schema
// ============================================================================

export const TrackSchema = z.object({
  /** Unique identifier for the track */
  id: z.string(),

  /** Track type determines rendering behavior */
  type: TrackTypeSchema,

  /** Display name for the track */
  name: z.string().min(1).max(100),

  /** Clips on this track, ordered by startTime */
  clips: z.array(ClipSchema),

  /** Track volume (0-2, where 1 is normal) */
  volume: z.number().min(0).max(2).default(1),

  /** Whether the track is muted */
  isMuted: z.boolean().default(false),

  /** Whether the track is locked from editing */
  isLocked: z.boolean().default(false),

  /** Track order in the timeline (lower = higher in UI) */
  order: z.number().int().nonnegative().optional(),
});

// ============================================================================
// Transition Schema
// ============================================================================

export const TransitionParamsSchema = z.object({
  /** Wipe direction for wipe transitions */
  direction: WipeDirectionSchema.optional(),

  /** Easing function name */
  easing: z.string().optional(),

  /** Additional transition-specific parameters */
  custom: z.record(z.unknown()).optional(),
});

export const TransitionSchema = z.object({
  /** Unique identifier for the transition */
  id: z.string().uuid(),

  /** Type of transition effect */
  type: TransitionTypeSchema,

  /** ID of the clip before the transition */
  clipBeforeId: z.string().uuid(),

  /** ID of the clip after the transition */
  clipAfterId: z.string().uuid(),

  /** Duration of the transition in seconds */
  duration: z.number().positive().max(10),

  /** Optional transition parameters */
  params: TransitionParamsSchema.optional(),
});

// ============================================================================
// Render Settings Schema
// ============================================================================

export const RenderSettingsSchema = z.object({
  /** Output width in pixels */
  width: z.number().int().positive().max(7680).default(1920),

  /** Output height in pixels */
  height: z.number().int().positive().max(4320).default(1080),

  /** Frames per second */
  fps: z.number().int().positive().max(120).default(30),

  /** Video codec */
  codec: VideoCodecSchema.default('h264'),

  /** Audio codec */
  audioCodec: AudioCodecSchema.default('aac'),

  /** Output format */
  format: OutputFormatSchema.default('mp4'),

  /** Render quality preset */
  quality: RenderQualitySchema.default('standard'),

  /** Video bitrate in kbps (optional, auto-calculated if not set) */
  videoBitrate: z.number().int().positive().optional(),

  /** Audio bitrate in kbps */
  audioBitrate: z.number().int().positive().default(192),

  /** Audio sample rate in Hz */
  sampleRate: z.number().int().positive().default(48000),

  /** Whether to include audio in output */
  includeAudio: z.boolean().default(true),

  /** CRF value for quality-based encoding (lower = better, 0-51) */
  crf: z.number().int().min(0).max(51).optional(),
});

// ============================================================================
// Timeline Metadata Schema
// ============================================================================

export const TimelineMetadataSchema = z.object({
  /** Episode ID this timeline belongs to */
  episodeId: z.string().uuid().optional(),

  /** Project ID this timeline belongs to */
  projectId: z.string().uuid().optional(),

  /** Account ID of the owner */
  accountId: z.string().uuid().optional(),

  /** Human-readable title */
  title: z.string().max(255).optional(),

  /** Description of the timeline */
  description: z.string().max(1000).optional(),

  /** When the timeline was created */
  createdAt: z.string().datetime().optional(),

  /** When the timeline was last updated */
  updatedAt: z.string().datetime().optional(),

  /** Additional custom metadata */
  custom: z.record(z.unknown()).optional(),
});

// ============================================================================
// Main Timeline Schema
// ============================================================================

export const TimelineSchema = z.object({
  /** Unique identifier for the timeline */
  id: z.string().uuid(),

  /** Schema version for forward compatibility */
  version: z.literal('1.0'),

  /** Total duration of the timeline in seconds */
  duration: z.number().nonnegative(),

  /** All tracks in the timeline */
  tracks: z.array(TrackSchema),

  /** Transitions between clips */
  transitions: z.array(TransitionSchema).default([]),

  /** Render output settings */
  renderSettings: RenderSettingsSchema,

  /** Optional metadata */
  metadata: TimelineMetadataSchema.optional(),
});

// ============================================================================
// Helper Schemas
// ============================================================================

/** Schema for creating a new timeline (without required id) */
export const CreateTimelineSchema = TimelineSchema.omit({ id: true }).extend({
  id: z.string().uuid().optional(),
});

/** Schema for updating a timeline (all fields optional except id) */
export const UpdateTimelineSchema = TimelineSchema.partial().required({
  id: true,
});

// ============================================================================
// Type Exports
// ============================================================================

export type TrackType = z.infer<typeof TrackTypeSchema>;
export type TransitionType = z.infer<typeof TransitionTypeSchema>;
export type VideoCodec = z.infer<typeof VideoCodecSchema>;
export type AudioCodec = z.infer<typeof AudioCodecSchema>;
export type OutputFormat = z.infer<typeof OutputFormatSchema>;
export type RenderQuality = z.infer<typeof RenderQualitySchema>;
export type WipeDirection = z.infer<typeof WipeDirectionSchema>;

export type Clip = z.infer<typeof ClipSchema>;
export type Track = z.infer<typeof TrackSchema>;
export type Transition = z.infer<typeof TransitionSchema>;
export type TransitionParams = z.infer<typeof TransitionParamsSchema>;
export type RenderSettings = z.infer<typeof RenderSettingsSchema>;
export type TimelineMetadata = z.infer<typeof TimelineMetadataSchema>;
export type Timeline = z.infer<typeof TimelineSchema>;
export type CreateTimeline = z.infer<typeof CreateTimelineSchema>;
export type UpdateTimeline = z.infer<typeof UpdateTimelineSchema>;

// ============================================================================
// Validation Helpers
// ============================================================================

/**
 * Validates a timeline and returns a result object
 */
export function validateTimeline(data: unknown): {
  success: boolean;
  data?: Timeline;
  errors?: z.ZodError;
} {
  const result = TimelineSchema.safeParse(data);
  if (result.success) {
    return { success: true, data: result.data };
  }
  return { success: false, errors: result.error };
}

/**
 * Validates a timeline and throws if invalid
 */
export function parseTimeline(data: unknown): Timeline {
  return TimelineSchema.parse(data);
}

/**
 * Calculates the total duration from tracks
 */
export function calculateTimelineDuration(tracks: Track[]): number {
  let maxEnd = 0;
  for (const track of tracks) {
    for (const clip of track.clips) {
      const clipEnd = clip.startTime + clip.duration;
      if (clipEnd > maxEnd) {
        maxEnd = clipEnd;
      }
    }
  }
  return maxEnd;
}

/**
 * Sorts clips within each track by start time
 */
export function sortTrackClips(tracks: Track[]): Track[] {
  return tracks.map((track) => ({
    ...track,
    clips: [...track.clips].sort((a, b) => a.startTime - b.startTime),
  }));
}

/**
 * Gets all clips from all tracks, sorted by start time
 */
export function getAllClipsSorted(timeline: Timeline): Clip[] {
  const allClips: Clip[] = [];
  for (const track of timeline.tracks) {
    allClips.push(...track.clips);
  }
  return allClips.sort((a, b) => a.startTime - b.startTime);
}

/**
 * Gets clips for a specific track type
 */
export function getClipsByTrackType(
  timeline: Timeline,
  trackType: TrackType,
): Clip[] {
  const track = timeline.tracks.find((t) => t.type === trackType);
  return track ? track.clips : [];
}
