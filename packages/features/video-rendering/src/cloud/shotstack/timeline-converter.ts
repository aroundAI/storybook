/**
 * Timeline to Shotstack Converter
 *
 * Converts a Timeline object to Shotstack Edit JSON format.
 */
import type {
  Clip,
  RenderSettings,
  Timeline,
  Track,
  Transition,
} from '../../schema/timeline';
import type {
  ShotstackAudioAsset,
  ShotstackClip,
  ShotstackEdit,
  ShotstackOutput,
  ShotstackTimeline,
  ShotstackTrack,
  ShotstackTransition,
  ShotstackTransitionEffect,
  ShotstackVideoAsset,
} from './types';

// ============================================================================
// Main Converter
// ============================================================================

/**
 * Convert Timeline to Shotstack Edit JSON
 */
export function convertTimelineToShotstack(
  timeline: Timeline,
  options: { webhookUrl?: string } = {},
): ShotstackEdit {
  const shotstackTimeline = convertToShotstackTimeline(timeline);
  const output = convertRenderSettings(timeline.renderSettings);

  const edit: ShotstackEdit = {
    timeline: shotstackTimeline,
    output,
  };

  if (options.webhookUrl) {
    edit.callback = options.webhookUrl;
  }

  return edit;
}

/**
 * Convert timeline tracks to Shotstack timeline
 */
function convertToShotstackTimeline(timeline: Timeline): ShotstackTimeline {
  const tracks: ShotstackTrack[] = [];

  // Get video track
  const videoTrack = timeline.tracks.find((t) => t.type === 'video');
  if (videoTrack && videoTrack.clips.length > 0) {
    tracks.push(convertVideoTrack(videoTrack, timeline.transitions));
  }

  // Get audio tracks (excluding muted)
  const audioTracks = timeline.tracks.filter(
    (t) => t.type !== 'video' && !t.isMuted && t.clips.length > 0,
  );
  for (const audioTrack of audioTracks) {
    tracks.push(convertAudioTrack(audioTrack));
  }

  return {
    tracks,
    background: '#000000',
    cache: true,
  };
}

/**
 * Convert video track to Shotstack track
 */
function convertVideoTrack(
  track: Track,
  transitions: Transition[],
): ShotstackTrack {
  const clips: ShotstackClip[] = [];

  for (const clip of track.clips) {
    if (clip.isPlaceholder) continue;

    // Find transition for this clip
    const transitionIn = transitions.find((t) => t.clipAfterId === clip.id);
    const transitionOut = transitions.find((t) => t.clipBeforeId === clip.id);

    const shotstackClip = convertVideoClip(clip, transitionIn, transitionOut);
    clips.push(shotstackClip);
  }

  return { clips };
}

/**
 * Convert video clip to Shotstack clip
 */
function convertVideoClip(
  clip: Clip,
  transitionIn?: Transition,
  transitionOut?: Transition,
): ShotstackClip {
  const asset: ShotstackVideoAsset = {
    type: 'video',
    src: clip.assetUrl,
    volume: clip.volume ?? 1,
  };

  // Add trim if source start is specified
  if (clip.sourceStart !== undefined && clip.sourceStart > 0) {
    asset.trim = clip.sourceStart;
  }

  // Add volume effect for fades
  if (clip.fadeIn && clip.fadeOut) {
    asset.volumeEffect = 'fadeInFadeOut';
  } else if (clip.fadeIn) {
    asset.volumeEffect = 'fadeIn';
  } else if (clip.fadeOut) {
    asset.volumeEffect = 'fadeOut';
  }

  const shotstackClip: ShotstackClip = {
    asset,
    start: clip.startTime,
    length: clip.duration,
    fit: 'cover',
  };

  // Add transitions
  if (transitionIn || transitionOut) {
    shotstackClip.transition = buildShotstackTransition(
      transitionIn,
      transitionOut,
    );
  }

  return shotstackClip;
}

/**
 * Convert audio track to Shotstack track
 */
function convertAudioTrack(track: Track): ShotstackTrack {
  const clips: ShotstackClip[] = [];

  for (const clip of track.clips) {
    if (clip.isPlaceholder) continue;

    const shotstackClip = convertAudioClip(clip, track.volume);
    clips.push(shotstackClip);
  }

  return { clips };
}

/**
 * Convert audio clip to Shotstack clip
 */
function convertAudioClip(clip: Clip, trackVolume: number): ShotstackClip {
  const asset: ShotstackAudioAsset = {
    type: 'audio',
    src: clip.assetUrl,
    volume: (clip.volume ?? 1) * trackVolume,
  };

  // Add trim if source start is specified
  if (clip.sourceStart !== undefined && clip.sourceStart > 0) {
    asset.trim = clip.sourceStart;
  }

  // Add effect for fades
  if (clip.fadeIn && clip.fadeOut) {
    asset.effect = 'fadeInFadeOut';
  } else if (clip.fadeIn) {
    asset.effect = 'fadeIn';
  } else if (clip.fadeOut) {
    asset.effect = 'fadeOut';
  }

  return {
    asset,
    start: clip.startTime,
    length: clip.duration,
  };
}

/**
 * Build Shotstack transition from timeline transitions
 */
function buildShotstackTransition(
  transitionIn?: Transition,
  transitionOut?: Transition,
): ShotstackTransition {
  const result: ShotstackTransition = {};

  if (transitionIn && transitionIn.type !== 'cut') {
    result.in = mapTransitionEffect(transitionIn);
  }

  if (transitionOut && transitionOut.type !== 'cut') {
    result.out = mapTransitionEffect(transitionOut);
  }

  return result;
}

/**
 * Map timeline transition to Shotstack effect
 */
function mapTransitionEffect(
  transition: Transition,
): ShotstackTransitionEffect {
  switch (transition.type) {
    case 'fade':
    case 'crossfade':
      return 'fade';

    case 'wipe': {
      const direction = transition.params?.direction ?? 'left';
      switch (direction) {
        case 'left':
          return 'wipeLeft';
        case 'right':
          return 'wipeRight';
        case 'up':
          return 'wipeUp';
        case 'down':
          return 'wipeDown';
        default:
          return 'wipeLeft';
      }
    }

    case 'slide': {
      const direction = transition.params?.direction ?? 'left';
      switch (direction) {
        case 'left':
          return 'slideLeft';
        case 'right':
          return 'slideRight';
        case 'up':
          return 'slideUp';
        case 'down':
          return 'slideDown';
        default:
          return 'slideLeft';
      }
    }

    case 'dissolve':
      return 'fade'; // Shotstack doesn't have a specific dissolve

    default:
      return 'fade';
  }
}

/**
 * Convert render settings to Shotstack output
 */
function convertRenderSettings(settings: RenderSettings): ShotstackOutput {
  // Map resolution
  let resolution: ShotstackOutput['resolution'] = 'hd';
  const pixels = settings.width * settings.height;
  if (pixels <= 640 * 360) resolution = 'mobile';
  else if (pixels <= 854 * 480) resolution = 'sd';
  else if (pixels <= 1280 * 720) resolution = 'hd';
  else if (pixels <= 1920 * 1080) resolution = '1080';
  else resolution = '4k';

  // Map format
  let format: ShotstackOutput['format'] = 'mp4';
  switch (settings.format) {
    case 'mp4':
      format = 'mp4';
      break;
    case 'webm':
      format = 'webm';
      break;
    case 'mov':
      format = 'mov';
      break;
    default:
      format = 'mp4';
  }

  // Map quality
  let quality: ShotstackOutput['quality'] = 'medium';
  switch (settings.quality) {
    case 'draft':
      quality = 'low';
      break;
    case 'standard':
      quality = 'medium';
      break;
    case 'high':
      quality = 'high';
      break;
  }

  return {
    format,
    resolution,
    quality,
    fps: settings.fps,
    mute: !settings.includeAudio,
  };
}

// ============================================================================
// Validation
// ============================================================================

/**
 * Validate timeline for Shotstack
 */
export function validateTimelineForShotstack(timeline: Timeline): {
  valid: boolean;
  errors: string[];
  warnings: string[];
} {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Check duration limit (10 minutes max)
  if (timeline.duration > 600) {
    errors.push('Timeline duration exceeds Shotstack limit of 10 minutes');
  }

  // Check for placeholder clips
  const placeholders = timeline.tracks
    .flatMap((t) => t.clips)
    .filter((c) => c.isPlaceholder);
  if (placeholders.length > 0) {
    errors.push(`${placeholders.length} placeholder clips cannot be rendered`);
  }

  // Check format support
  if (!['mp4', 'webm', 'mov'].includes(timeline.renderSettings.format)) {
    warnings.push(
      `Format ${timeline.renderSettings.format} may not be supported`,
    );
  }

  // Check codec support (Shotstack handles codec internally)
  if (timeline.renderSettings.codec === 'prores') {
    warnings.push('ProRes codec is not supported, will use H.264');
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
 * Get estimated Shotstack render cost in cents
 */
export function estimateShotstackCost(timeline: Timeline): number {
  // Shotstack pricing: ~$0.05 per video minute (varies by resolution)
  const minutes = timeline.duration / 60;

  // Resolution multiplier
  let multiplier = 1;
  const pixels = timeline.renderSettings.width * timeline.renderSettings.height;
  if (pixels > 1920 * 1080)
    multiplier = 2; // 4K costs more
  else if (pixels > 1280 * 720) multiplier = 1.5; // 1080p

  // Quality multiplier
  if (timeline.renderSettings.quality === 'high') multiplier *= 1.2;

  return Math.ceil(minutes * 5 * multiplier);
}

/**
 * Get Shotstack API endpoint based on environment
 */
export function getShotstackApiUrl(
  environment: 'staging' | 'production' = 'staging',
): string {
  if (environment === 'production') {
    return 'https://api.shotstack.io/edit/v1';
  }
  return 'https://api.shotstack.io/stage';
}
