/**
 * Timeline to Creatomate Converter
 *
 * Converts a Timeline object to Creatomate Source JSON format.
 */
import type { Clip, Timeline, Track, Transition } from '../../schema/timeline';
import type {
  CreatomateAnimation,
  CreatomateAudioElement,
  CreatomateElement,
  CreatomateRenderRequest,
  CreatomateSource,
  CreatomateVideoElement,
} from './types';

// ============================================================================
// Main Converter
// ============================================================================

/**
 * Convert Timeline to Creatomate Render Request
 */
export function convertTimelineToCreatomate(
  timeline: Timeline,
  options: { webhookUrl?: string; metadata?: string } = {},
): CreatomateRenderRequest {
  const source = convertToCreatomateSource(timeline);

  const request: CreatomateRenderRequest = {
    source,
    output_format: mapOutputFormat(timeline.renderSettings.format),
    frame_rate: timeline.renderSettings.fps,
    width: timeline.renderSettings.width,
    height: timeline.renderSettings.height,
  };

  if (options.webhookUrl) {
    request.webhook_url = options.webhookUrl;
  }

  if (options.metadata) {
    request.metadata = options.metadata;
  }

  return request;
}

/**
 * Convert timeline to Creatomate Source
 */
function convertToCreatomateSource(timeline: Timeline): CreatomateSource {
  const elements: CreatomateElement[] = [];

  // Video track (track 0 for z-ordering)
  const videoTrack = timeline.tracks.find((t) => t.type === 'video');
  if (videoTrack) {
    const videoElements = convertVideoTrack(
      videoTrack,
      timeline.transitions,
      0,
    );
    elements.push(...videoElements);
  }

  // Audio tracks (track 1+ for z-ordering)
  let trackIndex = 1;
  const audioTracks = timeline.tracks.filter(
    (t) => t.type !== 'video' && !t.isMuted && t.clips.length > 0,
  );
  for (const audioTrack of audioTracks) {
    const audioElements = convertAudioTrack(audioTrack, trackIndex);
    elements.push(...audioElements);
    trackIndex++;
  }

  return {
    output_format: mapOutputFormat(timeline.renderSettings.format),
    frame_rate: timeline.renderSettings.fps,
    width: timeline.renderSettings.width,
    height: timeline.renderSettings.height,
    duration: timeline.duration,
    fill_color: '#000000',
    elements,
  };
}

/**
 * Convert video track to Creatomate elements
 */
function convertVideoTrack(
  track: Track,
  transitions: Transition[],
  trackIndex: number,
): CreatomateVideoElement[] {
  const elements: CreatomateVideoElement[] = [];

  for (const clip of track.clips) {
    if (clip.isPlaceholder) continue;

    // Find transitions for this clip
    const transitionIn = transitions.find((t) => t.clipAfterId === clip.id);
    const transitionOut = transitions.find((t) => t.clipBeforeId === clip.id);

    const element = convertVideoClip(
      clip,
      trackIndex,
      transitionIn,
      transitionOut,
    );
    elements.push(element);
  }

  return elements;
}

/**
 * Convert video clip to Creatomate video element
 */
function convertVideoClip(
  clip: Clip,
  trackIndex: number,
  transitionIn?: Transition,
  transitionOut?: Transition,
): CreatomateVideoElement {
  const element: CreatomateVideoElement = {
    type: 'video',
    name: clip.id,
    track: trackIndex,
    source: clip.assetUrl,
    time: clip.startTime,
    duration: clip.duration,
    x: '50%',
    y: '50%',
    width: '100%',
    height: '100%',
    fit: 'cover',
    volume: clip.volume ?? 1,
  };

  // Add trim
  if (clip.sourceStart !== undefined && clip.sourceStart > 0) {
    element.trim_start = clip.sourceStart;
  }
  if (clip.sourceEnd !== undefined) {
    element.trim_duration = clip.sourceEnd - (clip.sourceStart ?? 0);
  }

  // Add audio fades
  if (clip.fadeIn) {
    element.audio_fade_in = clip.fadeIn;
  }
  if (clip.fadeOut) {
    element.audio_fade_out = clip.fadeOut;
  }

  // Add visual transitions
  if (transitionIn && transitionIn.type !== 'cut') {
    element.enter = mapTransitionToAnimation(transitionIn, 'in');
  }
  if (transitionOut && transitionOut.type !== 'cut') {
    element.exit = mapTransitionToAnimation(transitionOut, 'out');
  }

  return element;
}

/**
 * Convert audio track to Creatomate elements
 */
function convertAudioTrack(
  track: Track,
  trackIndex: number,
): CreatomateAudioElement[] {
  const elements: CreatomateAudioElement[] = [];

  for (const clip of track.clips) {
    if (clip.isPlaceholder) continue;

    const element = convertAudioClip(clip, trackIndex, track.volume);
    elements.push(element);
  }

  return elements;
}

/**
 * Convert audio clip to Creatomate audio element
 */
function convertAudioClip(
  clip: Clip,
  trackIndex: number,
  trackVolume: number,
): CreatomateAudioElement {
  const element: CreatomateAudioElement = {
    type: 'audio',
    name: clip.id,
    track: trackIndex,
    source: clip.assetUrl,
    time: clip.startTime,
    duration: clip.duration,
    volume: (clip.volume ?? 1) * trackVolume,
  };

  // Add trim
  if (clip.sourceStart !== undefined && clip.sourceStart > 0) {
    element.trim_start = clip.sourceStart;
  }
  if (clip.sourceEnd !== undefined) {
    element.trim_duration = clip.sourceEnd - (clip.sourceStart ?? 0);
  }

  // Add fades
  if (clip.fadeIn) {
    element.audio_fade_in = clip.fadeIn;
  }
  if (clip.fadeOut) {
    element.audio_fade_out = clip.fadeOut;
  }

  return element;
}

/**
 * Map timeline transition to Creatomate animation
 */
function mapTransitionToAnimation(
  transition: Transition,
  direction: 'in' | 'out',
): CreatomateAnimation {
  const animation: CreatomateAnimation = {
    type: 'fade',
    duration: transition.duration,
    easing: 'ease-in-out',
  };

  switch (transition.type) {
    case 'fade':
    case 'crossfade':
      animation.type = 'fade';
      animation.fade = direction === 'in' ? 0 : 1;
      break;

    case 'wipe': {
      animation.type = 'wipe';
      animation.direction = mapWipeDirection(transition.params?.direction);
      break;
    }

    case 'slide': {
      animation.type = 'slide';
      animation.direction = mapWipeDirection(transition.params?.direction);
      break;
    }

    case 'dissolve':
      animation.type = 'fade';
      animation.fade = direction === 'in' ? 0 : 1;
      break;

    default:
      animation.type = 'fade';
  }

  return animation;
}

/**
 * Map wipe direction
 */
function mapWipeDirection(
  direction?: string,
): 'left' | 'right' | 'up' | 'down' {
  switch (direction) {
    case 'left':
      return 'left';
    case 'right':
      return 'right';
    case 'up':
      return 'up';
    case 'down':
      return 'down';
    default:
      return 'left';
  }
}

/**
 * Map output format
 */
function mapOutputFormat(format: string): 'mp4' | 'gif' | 'png' | 'jpg' {
  switch (format) {
    case 'mp4':
    case 'mov':
    case 'webm':
    case 'mkv':
      return 'mp4';
    case 'gif':
      return 'gif';
    case 'png':
      return 'png';
    case 'jpg':
    case 'jpeg':
      return 'jpg';
    default:
      return 'mp4';
  }
}

// ============================================================================
// Validation
// ============================================================================

/**
 * Validate timeline for Creatomate
 */
export function validateTimelineForCreatomate(timeline: Timeline): {
  valid: boolean;
  errors: string[];
  warnings: string[];
} {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Check duration limit (10 minutes max)
  if (timeline.duration > 600) {
    errors.push('Timeline duration exceeds Creatomate limit of 10 minutes');
  }

  // Check for placeholder clips
  const placeholders = timeline.tracks
    .flatMap((t) => t.clips)
    .filter((c) => c.isPlaceholder);
  if (placeholders.length > 0) {
    errors.push(`${placeholders.length} placeholder clips cannot be rendered`);
  }

  // Check resolution limits
  if (
    timeline.renderSettings.width > 3840 ||
    timeline.renderSettings.height > 2160
  ) {
    warnings.push('Resolution exceeds 4K, may have longer render times');
  }

  // Check format support
  if (!['mp4', 'gif', 'png', 'jpg'].includes(timeline.renderSettings.format)) {
    warnings.push(
      `Format ${timeline.renderSettings.format} will be converted to mp4`,
    );
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

// ============================================================================
// Utilities
// ============================================================================

/**
 * Get estimated Creatomate render cost in cents
 */
export function estimateCreatomateCost(timeline: Timeline): number {
  // Creatomate pricing: ~$0.04 per video second
  const seconds = timeline.duration;
  const baseCost = Math.ceil(seconds * 4);

  // Resolution multiplier
  let multiplier = 1;
  const pixels = timeline.renderSettings.width * timeline.renderSettings.height;
  if (pixels > 1920 * 1080) multiplier = 1.5; // 4K costs more

  return Math.ceil(baseCost * multiplier);
}

/**
 * Get Creatomate API base URL
 */
export function getCreatomateApiUrl(): string {
  return 'https://api.creatomate.com/v1';
}
