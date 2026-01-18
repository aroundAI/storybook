/**
 * Transition Types and Utilities
 * Phase 3: Transitions System
 *
 * Industry-standard transitions for video editing.
 * Compatible with FFmpeg xfade filter for export.
 */

/**
 * Supported transition types
 * Maps to FFmpeg xfade transition names
 */
export type TransitionType =
  | 'cut' // Instant cut (no effect, duration = 0)
  | 'fade' // Fade to black then fade in
  | 'dissolve' // Cross-dissolve (blend)
  | 'wipe_left' // Wipe from right to left
  | 'wipe_right' // Wipe from left to right
  | 'wipe_up' // Wipe from bottom to top
  | 'wipe_down' // Wipe from top to bottom
  | 'crossfade'; // Same as dissolve (alias)

/**
 * Transition configuration
 */
export interface TransitionConfig {
  id: string;
  episodeId: string;
  fromShotId: string | null;
  toShotId: string;
  transitionType: TransitionType;
  durationSeconds: number;
  parameters: TransitionParameters;
  createdAt: string;
  updatedAt: string;
}

/**
 * Transition-specific parameters
 */
export interface TransitionParameters {
  // Fade transitions
  fadeColor?: string; // Hex color for fade (default: #000000)

  // Easing (for supported transitions)
  easing?: 'linear' | 'ease-in' | 'ease-out' | 'ease-in-out';

  // Wipe transitions
  wipeAngle?: number; // Angle in degrees for diagonal wipes
}

/**
 * Transition preset for UI
 */
export interface TransitionPreset {
  type: TransitionType;
  name: string;
  description: string;
  icon: string; // lucide icon name
  defaultDuration: number;
  minDuration: number;
  maxDuration: number;
  supportsColor?: boolean;
  supportsEasing?: boolean;
}

/**
 * Industry-standard transition presets
 */
export const TRANSITION_PRESETS: TransitionPreset[] = [
  {
    type: 'cut',
    name: 'Cut',
    description: 'Instant cut with no effect',
    icon: 'Scissors',
    defaultDuration: 0,
    minDuration: 0,
    maxDuration: 0,
  },
  {
    type: 'fade',
    name: 'Fade',
    description: 'Fade to black, then fade in',
    icon: 'CircleDot',
    defaultDuration: 0.5,
    minDuration: 0.25,
    maxDuration: 2.0,
    supportsColor: true,
  },
  {
    type: 'dissolve',
    name: 'Dissolve',
    description: 'Cross-dissolve blend between clips',
    icon: 'Blend',
    defaultDuration: 0.5,
    minDuration: 0.25,
    maxDuration: 2.0,
  },
  {
    type: 'crossfade',
    name: 'Crossfade',
    description: 'Smooth crossfade transition',
    icon: 'Layers',
    defaultDuration: 0.5,
    minDuration: 0.25,
    maxDuration: 2.0,
  },
  {
    type: 'wipe_left',
    name: 'Wipe Left',
    description: 'Wipe from right to left',
    icon: 'ArrowLeft',
    defaultDuration: 0.5,
    minDuration: 0.25,
    maxDuration: 1.5,
    supportsEasing: true,
  },
  {
    type: 'wipe_right',
    name: 'Wipe Right',
    description: 'Wipe from left to right',
    icon: 'ArrowRight',
    defaultDuration: 0.5,
    minDuration: 0.25,
    maxDuration: 1.5,
    supportsEasing: true,
  },
  {
    type: 'wipe_up',
    name: 'Wipe Up',
    description: 'Wipe from bottom to top',
    icon: 'ArrowUp',
    defaultDuration: 0.5,
    minDuration: 0.25,
    maxDuration: 1.5,
    supportsEasing: true,
  },
  {
    type: 'wipe_down',
    name: 'Wipe Down',
    description: 'Wipe from top to bottom',
    icon: 'ArrowDown',
    defaultDuration: 0.5,
    minDuration: 0.25,
    maxDuration: 1.5,
    supportsEasing: true,
  },
];

/**
 * Get transition preset by type
 */
export function getTransitionPreset(
  type: TransitionType,
): TransitionPreset | undefined {
  return TRANSITION_PRESETS.find((p) => p.type === type);
}

/**
 * Map transition type to FFmpeg xfade filter name
 * https://ffmpeg.org/ffmpeg-filters.html#xfade
 */
export function toFFmpegTransition(type: TransitionType): string {
  const mapping: Record<TransitionType, string> = {
    cut: 'fade', // Not used for cut (handled separately)
    fade: 'fade',
    dissolve: 'dissolve',
    crossfade: 'dissolve',
    wipe_left: 'wipeleft',
    wipe_right: 'wiperight',
    wipe_up: 'wipeup',
    wipe_down: 'wipedown',
  };
  return mapping[type];
}

/**
 * Validate transition duration against preset limits
 */
export function validateTransitionDuration(
  type: TransitionType,
  duration: number,
): { valid: boolean; error?: string } {
  const preset = getTransitionPreset(type);
  if (!preset) {
    return { valid: false, error: 'Unknown transition type' };
  }

  if (duration < preset.minDuration) {
    return {
      valid: false,
      error: `Duration must be at least ${preset.minDuration}s for ${preset.name}`,
    };
  }

  if (duration > preset.maxDuration) {
    return {
      valid: false,
      error: `Duration must be at most ${preset.maxDuration}s for ${preset.name}`,
    };
  }

  return { valid: true };
}

/**
 * Calculate frame count for given duration at 30fps
 */
export function durationToFrames(
  durationSeconds: number,
  fps: number = 30,
): number {
  return Math.round(durationSeconds * fps);
}

/**
 * Convert frame count to duration at 30fps
 */
export function framesToDuration(frames: number, fps: number = 30): number {
  return frames / fps;
}
