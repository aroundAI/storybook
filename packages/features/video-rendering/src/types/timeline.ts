/**
 * Timeline Types
 *
 * Re-exports types from schema for convenience.
 * Also includes additional utility types not covered by Zod schemas.
 */

// Re-export all types from schema
export type {
  TrackType,
  TransitionType,
  VideoCodec,
  AudioCodec,
  OutputFormat,
  RenderQuality,
  WipeDirection,
  Clip,
  Track,
  Transition,
  TransitionParams,
  RenderSettings,
  TimelineMetadata,
  Timeline,
  CreateTimeline,
  UpdateTimeline,
} from '../schema/timeline';

// ============================================================================
// Additional Utility Types
// ============================================================================

/**
 * Clip with resolved asset information
 */
export interface ResolvedClip {
  id: string;
  trackId: string;
  assetUrl: string;
  name: string;
  startTime: number;
  duration: number;
  sourceStart: number;
  sourceEnd: number;
  volume: number;
  fadeIn: number;
  fadeOut: number;
  isPlaceholder: boolean;
}

/**
 * Gap detected in a track
 */
export interface TimelineGap {
  trackId: string;
  startTime: number;
  endTime: number;
  duration: number;
}

/**
 * Overlap detected between clips
 */
export interface ClipOverlap {
  clipAId: string;
  clipBId: string;
  overlapStart: number;
  overlapEnd: number;
  duration: number;
}

/**
 * Timeline validation result
 */
export interface TimelineValidationResult {
  isValid: boolean;
  errors: TimelineValidationError[];
  warnings: TimelineValidationWarning[];
}

/**
 * Timeline validation error
 */
export interface TimelineValidationError {
  type:
    | 'missing_asset'
    | 'invalid_duration'
    | 'invalid_transition'
    | 'schema_error';
  message: string;
  clipId?: string;
  trackId?: string;
  transitionId?: string;
}

/**
 * Timeline validation warning
 */
export interface TimelineValidationWarning {
  type: 'gap' | 'overlap' | 'placeholder' | 'long_duration';
  message: string;
  clipId?: string;
  trackId?: string;
}

/**
 * Timeline statistics
 */
export interface TimelineStats {
  totalDuration: number;
  trackCount: number;
  clipCount: number;
  transitionCount: number;
  videoClipCount: number;
  audioClipCount: number;
  placeholderCount: number;
  gapCount: number;
}

/**
 * Aspect ratio presets
 */
export type AspectRatioPreset =
  | '16:9'
  | '9:16'
  | '1:1'
  | '4:3'
  | '21:9'
  | 'custom';

/**
 * Resolution preset
 */
export interface ResolutionPreset {
  name: string;
  width: number;
  height: number;
  aspectRatio: AspectRatioPreset;
}

/**
 * Common resolution presets
 */
export const RESOLUTION_PRESETS: Record<string, ResolutionPreset> = {
  '1080p': { name: '1080p HD', width: 1920, height: 1080, aspectRatio: '16:9' },
  '720p': { name: '720p HD', width: 1280, height: 720, aspectRatio: '16:9' },
  '4k': { name: '4K UHD', width: 3840, height: 2160, aspectRatio: '16:9' },
  '1080p_vertical': {
    name: '1080p Vertical',
    width: 1080,
    height: 1920,
    aspectRatio: '9:16',
  },
  '1080p_square': {
    name: '1080p Square',
    width: 1080,
    height: 1080,
    aspectRatio: '1:1',
  },
};

/**
 * Quality preset configurations
 */
export interface QualityPresetConfig {
  name: string;
  videoBitrate: number; // kbps
  audioBitrate: number; // kbps
  crf: number;
}

/**
 * Common quality presets
 */
export const QUALITY_PRESETS: Record<string, QualityPresetConfig> = {
  draft: {
    name: 'Draft',
    videoBitrate: 2000,
    audioBitrate: 128,
    crf: 28,
  },
  standard: {
    name: 'Standard',
    videoBitrate: 5000,
    audioBitrate: 192,
    crf: 23,
  },
  high: {
    name: 'High Quality',
    videoBitrate: 10000,
    audioBitrate: 320,
    crf: 18,
  },
};
