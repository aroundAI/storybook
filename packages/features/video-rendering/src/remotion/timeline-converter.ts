/**
 * Timeline to Remotion Converter
 *
 * Converts a Timeline object to Remotion composition props.
 * Handles mapping of clips, tracks, transitions, and render settings.
 */
import type {
  Clip,
  RenderSettings,
  Timeline,
  Track,
  Transition,
} from '../schema/timeline';

// ============================================================================
// Remotion Composition Types
// ============================================================================

export interface RemotionCompositionProps {
  /** Total duration in frames */
  durationInFrames: number;

  /** Frames per second */
  fps: number;

  /** Width in pixels */
  width: number;

  /** Height in pixels */
  height: number;

  /** Tracks data for rendering */
  tracks: RemotionTrack[];

  /** Transitions between clips */
  transitions: RemotionTransition[];

  /** Default props for clips */
  defaultVolume: number;
}

export interface RemotionTrack {
  id: string;
  type: 'video' | 'audio';
  name: string;
  clips: RemotionClip[];
  volume: number;
  isMuted: boolean;
}

export interface RemotionClip {
  id: string;
  src: string;
  name: string;
  /** Start frame on timeline */
  from: number;
  /** Duration in frames */
  durationInFrames: number;
  /** Volume (0-1) */
  volume: number;
  /** Fade in duration in frames */
  fadeInFrames?: number;
  /** Fade out duration in frames */
  fadeOutFrames?: number;
  /** Trim start in seconds (source media) */
  startFrom?: number;
  /** Trim end in seconds (source media) */
  endAt?: number;
  /** Whether this is a placeholder */
  isPlaceholder: boolean;
}

export interface RemotionTransition {
  id: string;
  type: 'fade' | 'crossfade' | 'wipe' | 'dissolve' | 'slide';
  clipBeforeId: string;
  clipAfterId: string;
  /** Duration in frames */
  durationInFrames: number;
  /** Direction for directional transitions */
  direction?: 'left' | 'right' | 'up' | 'down';
}

export interface RemotionRenderConfig {
  /** Output codec */
  codec: 'h264' | 'h265' | 'vp8' | 'vp9' | 'prores';
  /** CRF quality (0-51, lower is better) */
  crf?: number;
  /** Pixel format */
  pixelFormat?: string;
  /** Image format for sequences */
  imageFormat?: 'png' | 'jpeg';
  /** JPEG quality (0-100) */
  jpegQuality?: number;
  /** Concurrency for rendering */
  concurrency?: number;
}

// ============================================================================
// Conversion Functions
// ============================================================================

/**
 * Convert Timeline to Remotion composition props
 */
export function convertTimelineToRemotion(
  timeline: Timeline,
): RemotionCompositionProps {
  const fps = timeline.renderSettings.fps;
  const durationInFrames = Math.ceil(timeline.duration * fps);

  // Convert tracks
  const tracks = convertTracks(timeline.tracks, fps);

  // Convert transitions
  const transitions = convertTransitions(timeline.transitions, fps);

  return {
    durationInFrames,
    fps,
    width: timeline.renderSettings.width,
    height: timeline.renderSettings.height,
    tracks,
    transitions,
    defaultVolume: 1,
  };
}

/**
 * Convert tracks to Remotion format
 */
function convertTracks(tracks: Track[], fps: number): RemotionTrack[] {
  return tracks.map((track) => ({
    id: track.id,
    type: track.type === 'video' ? 'video' : 'audio',
    name: track.name,
    clips: convertClips(track.clips, fps),
    volume: track.volume,
    isMuted: track.isMuted,
  }));
}

/**
 * Convert clips to Remotion format
 */
function convertClips(clips: Clip[], fps: number): RemotionClip[] {
  return clips.map((clip) => ({
    id: clip.id,
    src: clip.assetUrl,
    name: clip.name,
    from: Math.round(clip.startTime * fps),
    durationInFrames: Math.round(clip.duration * fps),
    volume: clip.volume ?? 1,
    fadeInFrames: clip.fadeIn ? Math.round(clip.fadeIn * fps) : undefined,
    fadeOutFrames: clip.fadeOut ? Math.round(clip.fadeOut * fps) : undefined,
    startFrom: clip.sourceStart,
    endAt: clip.sourceEnd,
    isPlaceholder: clip.isPlaceholder,
  }));
}

/**
 * Convert transitions to Remotion format
 */
function convertTransitions(
  transitions: Transition[],
  fps: number,
): RemotionTransition[] {
  return transitions
    .filter((t) => t.type !== 'cut') // Cut is just no transition
    .map((transition) => ({
      id: transition.id,
      type: mapTransitionType(transition.type),
      clipBeforeId: transition.clipBeforeId,
      clipAfterId: transition.clipAfterId,
      durationInFrames: Math.round(transition.duration * fps),
      direction: transition.params?.direction as
        | 'left'
        | 'right'
        | 'up'
        | 'down'
        | undefined,
    }));
}

/**
 * Map timeline transition type to Remotion type
 */
function mapTransitionType(
  type: string,
): 'fade' | 'crossfade' | 'wipe' | 'dissolve' | 'slide' {
  switch (type) {
    case 'fade':
      return 'fade';
    case 'crossfade':
      return 'crossfade';
    case 'wipe':
      return 'wipe';
    case 'dissolve':
      return 'dissolve';
    case 'slide':
      return 'slide';
    default:
      return 'fade';
  }
}

/**
 * Convert render settings to Remotion config
 */
export function convertRenderSettings(
  settings: RenderSettings,
): RemotionRenderConfig {
  // Map codec
  let codec: RemotionRenderConfig['codec'] = 'h264';
  switch (settings.codec) {
    case 'h264':
      codec = 'h264';
      break;
    case 'h265':
      codec = 'h265';
      break;
    case 'vp9':
      codec = 'vp9';
      break;
    case 'prores':
      codec = 'prores';
      break;
  }

  return {
    codec,
    crf: settings.crf,
    pixelFormat: 'yuv420p',
    concurrency: getConcurrencyForQuality(settings.quality),
  };
}

/**
 * Get concurrency based on quality
 */
function getConcurrencyForQuality(
  quality: 'draft' | 'standard' | 'high',
): number {
  switch (quality) {
    case 'draft':
      return 8; // More concurrent for faster renders
    case 'standard':
      return 4;
    case 'high':
      return 2; // Less concurrent for better quality
    default:
      return 4;
  }
}

// ============================================================================
// Remotion Component Code Generation
// ============================================================================

/**
 * Generate Remotion composition code
 * This generates the actual React component code that can be used
 */
export function generateRemotionCompositionCode(
  props: RemotionCompositionProps,
): string {
  return `
import { Composition } from 'remotion';
import { TimelineComposition } from './TimelineComposition';

export const RemotionVideo = () => {
  return (
    <Composition
      id="Timeline"
      component={TimelineComposition}
      durationInFrames={${props.durationInFrames}}
      fps={${props.fps}}
      width={${props.width}}
      height={${props.height}}
      defaultProps={{
        tracks: ${JSON.stringify(props.tracks, null, 2)},
        transitions: ${JSON.stringify(props.transitions, null, 2)},
        defaultVolume: ${props.defaultVolume},
      }}
    />
  );
};
`.trim();
}

/**
 * Generate timeline composition component code
 */
export function generateTimelineComponentCode(): string {
  return `
import { AbsoluteFill, Sequence, Video, Audio, useCurrentFrame, interpolate } from 'remotion';

interface TimelineCompositionProps {
  tracks: RemotionTrack[];
  transitions: RemotionTransition[];
  defaultVolume: number;
}

export const TimelineComposition: React.FC<TimelineCompositionProps> = ({
  tracks,
  transitions,
  defaultVolume,
}) => {
  const frame = useCurrentFrame();

  const videoTrack = tracks.find(t => t.type === 'video');
  const audioTracks = tracks.filter(t => t.type === 'audio' && !t.isMuted);

  return (
    <AbsoluteFill style={{ backgroundColor: 'black' }}>
      {/* Video Track */}
      {videoTrack?.clips.map((clip) => {
        if (clip.isPlaceholder) return null;

        return (
          <Sequence
            key={clip.id}
            from={clip.from}
            durationInFrames={clip.durationInFrames}
          >
            <VideoClip
              clip={clip}
              transitions={transitions}
              defaultVolume={defaultVolume}
            />
          </Sequence>
        );
      })}

      {/* Audio Tracks */}
      {audioTracks.map((track) => (
        track.clips.map((clip) => {
          if (clip.isPlaceholder) return null;

          return (
            <Sequence
              key={clip.id}
              from={clip.from}
              durationInFrames={clip.durationInFrames}
            >
              <AudioClip
                clip={clip}
                trackVolume={track.volume}
                defaultVolume={defaultVolume}
              />
            </Sequence>
          );
        })
      ))}
    </AbsoluteFill>
  );
};

const VideoClip: React.FC<{
  clip: RemotionClip;
  transitions: RemotionTransition[];
  defaultVolume: number;
}> = ({ clip, transitions, defaultVolume }) => {
  const frame = useCurrentFrame();

  // Calculate opacity for fade transitions
  let opacity = 1;

  if (clip.fadeInFrames && frame < clip.fadeInFrames) {
    opacity = interpolate(frame, [0, clip.fadeInFrames], [0, 1]);
  }

  if (clip.fadeOutFrames) {
    const fadeOutStart = clip.durationInFrames - clip.fadeOutFrames;
    if (frame > fadeOutStart) {
      opacity = interpolate(
        frame,
        [fadeOutStart, clip.durationInFrames],
        [1, 0]
      );
    }
  }

  return (
    <AbsoluteFill style={{ opacity }}>
      <Video
        src={clip.src}
        startFrom={clip.startFrom ? clip.startFrom * 30 : 0}
        volume={clip.volume * defaultVolume}
      />
    </AbsoluteFill>
  );
};

const AudioClip: React.FC<{
  clip: RemotionClip;
  trackVolume: number;
  defaultVolume: number;
}> = ({ clip, trackVolume, defaultVolume }) => {
  const frame = useCurrentFrame();

  // Calculate volume for fades
  let volume = clip.volume * trackVolume * defaultVolume;

  if (clip.fadeInFrames && frame < clip.fadeInFrames) {
    volume *= interpolate(frame, [0, clip.fadeInFrames], [0, 1]);
  }

  if (clip.fadeOutFrames) {
    const fadeOutStart = clip.durationInFrames - clip.fadeOutFrames;
    if (frame > fadeOutStart) {
      volume *= interpolate(
        frame,
        [fadeOutStart, clip.durationInFrames],
        [1, 0]
      );
    }
  }

  return (
    <Audio
      src={clip.src}
      startFrom={clip.startFrom ? clip.startFrom * 30 : 0}
      volume={volume}
    />
  );
};
`.trim();
}

// ============================================================================
// Validation
// ============================================================================

/**
 * Validate timeline for Remotion compatibility
 */
export function validateTimelineForRemotion(timeline: Timeline): {
  valid: boolean;
  errors: string[];
  warnings: string[];
} {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Check duration
  if (timeline.duration > 1800) {
    warnings.push('Duration exceeds 30 minutes, Remotion Lambda may timeout');
  }

  // Check resolution
  if (timeline.renderSettings.width > 3840) {
    warnings.push('Width exceeds 4K, may have performance issues');
  }

  // Check for unsupported codecs
  if (timeline.renderSettings.codec === 'prores') {
    warnings.push(
      'ProRes codec may not be supported in all Remotion environments',
    );
  }

  // Check for placeholder clips
  const placeholders = timeline.tracks
    .flatMap((t) => t.clips)
    .filter((c) => c.isPlaceholder);
  if (placeholders.length > 0) {
    errors.push(`${placeholders.length} placeholder clips cannot be rendered`);
  }

  // Check for missing asset URLs
  const missingUrls = timeline.tracks
    .flatMap((t) => t.clips)
    .filter((c) => !c.isPlaceholder && !c.assetUrl);
  if (missingUrls.length > 0) {
    errors.push(`${missingUrls.length} clips have missing asset URLs`);
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
 * Calculate total frames from timeline
 */
export function calculateTotalFrames(timeline: Timeline): number {
  return Math.ceil(timeline.duration * timeline.renderSettings.fps);
}

/**
 * Convert seconds to frames
 */
export function secondsToFrames(seconds: number, fps: number): number {
  return Math.round(seconds * fps);
}

/**
 * Convert frames to seconds
 */
export function framesToSeconds(frames: number, fps: number): number {
  return frames / fps;
}
