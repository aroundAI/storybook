/**
 * FFmpeg Transitions
 *
 * Implements video transitions using FFmpeg's xfade filter.
 *
 * @see https://ffmpeg.org/ffmpeg-filters.html#xfade
 */
import type { TransitionType, WipeDirection } from '../schema/timeline';

// ============================================================================
// Types
// ============================================================================

export interface TransitionConfig {
  /** Transition type */
  type: TransitionType;

  /** Duration in seconds */
  duration: number;

  /** Direction for directional transitions */
  direction?: WipeDirection;

  /** Easing function */
  easing?: string;

  /** Offset from end of first clip */
  offset?: number;
}

export interface XfadeParams {
  /** FFmpeg xfade transition name */
  transition: string;

  /** Duration in seconds */
  duration: number;

  /** Offset (when transition starts) */
  offset: number;

  /** Expression for custom transitions */
  expr?: string;
}

// ============================================================================
// Supported Transitions
// ============================================================================

/**
 * FFmpeg xfade transition types
 * @see https://ffmpeg.org/ffmpeg-filters.html#xfade
 */
export const FFMPEG_TRANSITIONS = {
  // Basic
  fade: 'fade',
  fadeblack: 'fadeblack',
  fadewhite: 'fadewhite',
  fadegrays: 'fadegrays',

  // Dissolve
  dissolve: 'dissolve',
  pixelize: 'pixelize',

  // Wipes
  wipeleft: 'wipeleft',
  wiperight: 'wiperight',
  wipeup: 'wipeup',
  wipedown: 'wipedown',
  wipetl: 'wipetl',
  wipetr: 'wipetr',
  wipebl: 'wipebl',
  wipebr: 'wipebr',

  // Slides
  slideleft: 'slideleft',
  slideright: 'slideright',
  slideup: 'slideup',
  slidedown: 'slidedown',

  // Circle
  circleopen: 'circleopen',
  circleclose: 'circleclose',

  // Radial
  radial: 'radial',

  // Rectangles
  rectcrop: 'rectcrop',

  // Zoom
  zoomin: 'zoomin',

  // Smooth
  smoothleft: 'smoothleft',
  smoothright: 'smoothright',
  smoothup: 'smoothup',
  smoothdown: 'smoothdown',

  // Distance
  distance: 'distance',

  // Reveal
  revealleft: 'revealleft',
  revealright: 'revealright',
  revealup: 'revealup',
  revealdown: 'revealdown',

  // Cover
  coverleft: 'coverleft',
  coverright: 'coverright',
  coverup: 'coverup',
  coverdown: 'coverdown',
} as const;

export type FFmpegTransition =
  (typeof FFMPEG_TRANSITIONS)[keyof typeof FFMPEG_TRANSITIONS];

// ============================================================================
// Transition Mapping
// ============================================================================

/**
 * Map timeline transition type to FFmpeg xfade transition
 */
export function mapTransitionToXfade(config: TransitionConfig): XfadeParams {
  const { type, duration, direction, offset = 0 } = config;

  switch (type) {
    case 'cut':
      // Cut is just instant transition - use minimal fade
      return {
        transition: 'fade',
        duration: 0,
        offset,
      };

    case 'fade':
      return {
        transition: 'fade',
        duration,
        offset,
      };

    case 'crossfade':
      return {
        transition: 'fade',
        duration,
        offset,
      };

    case 'wipe':
      return {
        transition: mapWipeDirection(direction),
        duration,
        offset,
      };

    case 'dissolve':
      return {
        transition: 'dissolve',
        duration,
        offset,
      };

    case 'slide':
      return {
        transition: mapSlideDirection(direction),
        duration,
        offset,
      };

    default:
      return {
        transition: 'fade',
        duration,
        offset,
      };
  }
}

/**
 * Map wipe direction to FFmpeg transition
 */
function mapWipeDirection(direction?: WipeDirection): FFmpegTransition {
  switch (direction) {
    case 'left':
      return FFMPEG_TRANSITIONS.wipeleft;
    case 'right':
      return FFMPEG_TRANSITIONS.wiperight;
    case 'up':
      return FFMPEG_TRANSITIONS.wipeup;
    case 'down':
      return FFMPEG_TRANSITIONS.wipedown;
    case 'radial':
      return FFMPEG_TRANSITIONS.circleopen;
    default:
      return FFMPEG_TRANSITIONS.wipeleft;
  }
}

/**
 * Map slide direction to FFmpeg transition
 */
function mapSlideDirection(direction?: WipeDirection): FFmpegTransition {
  switch (direction) {
    case 'left':
      return FFMPEG_TRANSITIONS.slideleft;
    case 'right':
      return FFMPEG_TRANSITIONS.slideright;
    case 'up':
      return FFMPEG_TRANSITIONS.slideup;
    case 'down':
      return FFMPEG_TRANSITIONS.slidedown;
    default:
      return FFMPEG_TRANSITIONS.slideleft;
  }
}

// ============================================================================
// Filter String Generation
// ============================================================================

/**
 * Build xfade filter string
 *
 * @example
 * xfade=transition=fade:duration=1:offset=5
 */
export function buildXfadeFilter(
  input1: string,
  input2: string,
  params: XfadeParams,
  output: string,
): string {
  const parts = [
    `transition=${params.transition}`,
    `duration=${params.duration}`,
  ];

  if (params.offset > 0) {
    parts.push(`offset=${params.offset}`);
  }

  if (params.expr) {
    parts.push(`expr='${params.expr}'`);
  }

  return `[${input1}][${input2}]xfade=${parts.join(':')}[${output}]`;
}

/**
 * Build a chain of xfade transitions for multiple clips
 *
 * @param clips - Array of clip stream labels [v0, v1, v2, ...]
 * @param transitions - Array of transition configs between clips
 * @param clipDurations - Array of clip durations to calculate offsets
 * @returns Array of filter strings
 */
export function buildXfadeChain(
  clips: string[],
  transitions: TransitionConfig[],
  clipDurations: number[],
): string[] {
  const filters: string[] = [];

  if (clips.length < 2) return filters;

  const firstClip = clips[0];
  if (!firstClip) return filters;

  let currentStream = firstClip;
  let cumulativeOffset = clipDurations[0] ?? 0;

  for (let i = 0; i < clips.length - 1; i++) {
    const transition = transitions[i] ?? {
      type: 'cut' as TransitionType,
      duration: 0,
    };
    const nextClip = clips[i + 1];
    if (!nextClip) continue;

    const outputStream = i === clips.length - 2 ? 'vout' : `xt${i}`;

    // Calculate offset (time when transition starts)
    const transitionOffset = cumulativeOffset - transition.duration;

    const params = mapTransitionToXfade({
      ...transition,
      offset: Math.max(0, transitionOffset),
    });

    const filter = buildXfadeFilter(
      currentStream,
      nextClip,
      params,
      outputStream,
    );

    filters.push(filter);

    currentStream = outputStream;
    const nextDuration = clipDurations[i + 1] ?? 0;
    cumulativeOffset += nextDuration - transition.duration;
  }

  return filters;
}

// ============================================================================
// Transition Validation
// ============================================================================

/**
 * Check if a transition type is supported
 */
export function isTransitionSupported(type: TransitionType): boolean {
  const supported: TransitionType[] = [
    'cut',
    'fade',
    'crossfade',
    'wipe',
    'dissolve',
    'slide',
  ];
  return supported.includes(type);
}

/**
 * Get list of supported transitions
 */
export function getSupportedTransitions(): TransitionType[] {
  return ['cut', 'fade', 'crossfade', 'wipe', 'dissolve', 'slide'];
}

/**
 * Get list of all FFmpeg xfade transitions
 */
export function getAllXfadeTransitions(): FFmpegTransition[] {
  return Object.values(FFMPEG_TRANSITIONS);
}

/**
 * Validate transition duration
 */
export function validateTransitionDuration(
  duration: number,
  clip1Duration: number,
  clip2Duration: number,
): { valid: boolean; maxDuration: number; error?: string } {
  const maxDuration = Math.min(clip1Duration, clip2Duration);

  if (duration < 0) {
    return {
      valid: false,
      maxDuration,
      error: 'Transition duration cannot be negative',
    };
  }

  if (duration > maxDuration) {
    return {
      valid: false,
      maxDuration,
      error: `Transition duration ${duration}s exceeds maximum ${maxDuration}s`,
    };
  }

  return { valid: true, maxDuration };
}
