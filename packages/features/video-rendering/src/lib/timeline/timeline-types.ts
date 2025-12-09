/**
 * Timeline Editor Types
 *
 * Type definitions for the timeline editor integration.
 * These types represent the JSON structure that the Edit Suite will produce.
 */

/**
 * Timeline project - the root structure
 */
export interface TimelineProject {
  /** Unique project identifier */
  id: string;
  /** Project name */
  name: string;
  /** Project description */
  description?: string;
  /** Total duration in frames */
  durationFrames: number;
  /** Frame rate (fps) */
  frameRate: number;
  /** Output resolution */
  resolution: {
    width: number;
    height: number;
  };
  /** All tracks in the timeline */
  tracks: TimelineTrack[];
  /** Project-level metadata */
  metadata?: Record<string, unknown>;
  /** Creation timestamp */
  createdAt?: string;
  /** Last modified timestamp */
  updatedAt?: string;
}

/**
 * Track types
 */
export type TrackType = 'video' | 'audio' | 'overlay' | 'subtitle';

/**
 * A single track in the timeline
 */
export interface TimelineTrack {
  /** Unique track identifier */
  id: string;
  /** Track type */
  type: TrackType;
  /** Display name */
  name: string;
  /** Clips on this track */
  clips: TimelineClip[];
  /** Track order (0 = bottom) */
  order: number;
  /** Whether track audio is muted */
  muted?: boolean;
  /** Whether track is locked for editing */
  locked?: boolean;
  /** Track volume multiplier (for audio/video tracks) */
  volume?: number;
  /** Track visibility (for video/overlay tracks) */
  visible?: boolean;
}

/**
 * A clip on a track
 */
export interface TimelineClip {
  /** Unique clip identifier */
  id: string;
  /** Reference to the source asset (shot, audio file, etc.) */
  sourceId: string;
  /** URL or path to the source file */
  sourceUrl: string;
  /** Source file type */
  sourceType: 'video' | 'audio' | 'image';
  /** Track this clip belongs to */
  trackId: string;
  /** Start frame on the timeline */
  startFrame: number;
  /** End frame on the timeline */
  endFrame: number;
  /** In-point within the source (frame) */
  inPoint: number;
  /** Out-point within the source (frame) */
  outPoint: number;
  /** Clip volume (0-2, for video/audio clips) */
  volume?: number;
  /** Effects applied to this clip */
  effects?: ClipEffect[];
  /** Transition at the start of this clip */
  transitionIn?: ClipTransition;
  /** Transition at the end of this clip */
  transitionOut?: ClipTransition;
  /** Clip-specific metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Effect types
 */
export type EffectType =
  | 'fade-in'
  | 'fade-out'
  | 'brightness'
  | 'contrast'
  | 'saturation'
  | 'blur'
  | 'speed'
  | 'reverse'
  | 'crop'
  | 'rotate'
  | 'flip-horizontal'
  | 'flip-vertical';

/**
 * An effect applied to a clip
 */
export interface ClipEffect {
  /** Effect type */
  type: EffectType;
  /** Start frame relative to clip start */
  startFrame: number;
  /** End frame relative to clip start */
  endFrame: number;
  /** Effect parameters */
  parameters: EffectParameters;
}

/**
 * Effect parameters (varies by effect type)
 */
export interface EffectParameters {
  /** Fade duration in frames */
  duration?: number;
  /** Brightness adjustment (-1 to 1) */
  brightness?: number;
  /** Contrast multiplier (0 to 2) */
  contrast?: number;
  /** Saturation multiplier (0 to 3) */
  saturation?: number;
  /** Blur radius */
  blurRadius?: number;
  /** Speed multiplier (0.25 to 4) */
  speed?: number;
  /** Rotation angle in degrees */
  rotation?: number;
  /** Crop rectangle */
  crop?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
}

/**
 * Transition types
 */
export type TimelineTransitionType =
  | 'crossfade'
  | 'dissolve'
  | 'fade-to-black'
  | 'fade-from-black'
  | 'wipe-left'
  | 'wipe-right'
  | 'wipe-up'
  | 'wipe-down'
  | 'slide-left'
  | 'slide-right'
  | 'zoom-in'
  | 'zoom-out';

/**
 * Transition configuration
 */
export interface ClipTransition {
  /** Transition type */
  type: TimelineTransitionType;
  /** Duration in frames */
  durationFrames: number;
  /** Easing function */
  easing?: 'linear' | 'ease-in' | 'ease-out' | 'ease-in-out';
}

/**
 * Marker on the timeline (for comments, chapter markers, etc.)
 */
export interface TimelineMarker {
  /** Unique identifier */
  id: string;
  /** Frame position */
  frame: number;
  /** Marker label */
  label: string;
  /** Marker color */
  color?: string;
  /** Marker type */
  type?: 'comment' | 'chapter' | 'sync-point';
}

/**
 * Export settings
 */
export interface TimelineExportSettings {
  /** Output format */
  format: 'mp4' | 'webm' | 'mov';
  /** Output resolution */
  resolution: '480p' | '720p' | '1080p' | '4k' | 'custom';
  /** Custom resolution (if resolution is 'custom') */
  customResolution?: {
    width: number;
    height: number;
  };
  /** Quality preset */
  quality: 'draft' | 'standard' | 'high';
  /** Frame rate */
  frameRate: number;
  /** Video codec */
  videoCodec?: 'h264' | 'h265' | 'vp9' | 'av1';
  /** Audio codec */
  audioCodec?: 'aac' | 'mp3' | 'opus';
  /** Audio bitrate (kbps) */
  audioBitrate?: number;
}

/**
 * Helper functions for timeline manipulation
 */

/**
 * Convert frames to seconds
 */
export function framesToSeconds(frames: number, frameRate: number): number {
  return frames / frameRate;
}

/**
 * Convert seconds to frames
 */
export function secondsToFrames(seconds: number, frameRate: number): number {
  return Math.round(seconds * frameRate);
}

/**
 * Get clip duration in frames
 */
export function getClipDurationFrames(clip: TimelineClip): number {
  return clip.endFrame - clip.startFrame;
}

/**
 * Get clip source duration in frames
 */
export function getClipSourceDurationFrames(clip: TimelineClip): number {
  return clip.outPoint - clip.inPoint;
}

/**
 * Check if two clips overlap
 */
export function clipsOverlap(clip1: TimelineClip, clip2: TimelineClip): boolean {
  return clip1.startFrame < clip2.endFrame && clip2.startFrame < clip1.endFrame;
}

/**
 * Sort clips by start frame
 */
export function sortClipsByStart(clips: TimelineClip[]): TimelineClip[] {
  return [...clips].sort((a, b) => a.startFrame - b.startFrame);
}

/**
 * Get total timeline duration from tracks
 */
export function calculateTimelineDuration(tracks: TimelineTrack[]): number {
  let maxEndFrame = 0;
  for (const track of tracks) {
    for (const clip of track.clips) {
      if (clip.endFrame > maxEndFrame) {
        maxEndFrame = clip.endFrame;
      }
    }
  }
  return maxEndFrame;
}
