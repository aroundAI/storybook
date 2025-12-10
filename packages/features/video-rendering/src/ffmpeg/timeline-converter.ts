/**
 * Timeline to FFmpeg Converter
 *
 * Converts a Timeline object to FFmpeg commands.
 * Handles the complete conversion pipeline from timeline JSON
 * to executable FFmpeg arguments.
 */
import type { Clip, Timeline } from '../schema/timeline';
import {
  type FFmpegCommand,
  type FFmpegCommandOptions,
  buildFFmpegCommand,
  commandToArgs,
  commandToString,
} from './command-builder';
import {
  areClipsCompatible,
  generateConcatDemuxerContent,
} from './concat-demuxer';

// ============================================================================
// Types
// ============================================================================

export interface ConversionResult {
  /** FFmpeg command object */
  command: FFmpegCommand;

  /** Command as string */
  commandString: string;

  /** Command as array of arguments */
  args: string[];

  /** Concat demuxer file content (if using demuxer approach) */
  concatFileContent?: string;

  /** Approach used */
  approach: 'concat_demuxer' | 'filter_complex';

  /** Estimated render time in seconds */
  estimatedRenderTime: number;

  /** Any warnings generated during conversion */
  warnings: string[];
}

export interface ConversionOptions extends FFmpegCommandOptions {
  /** Force a specific approach */
  forceApproach?: 'concat_demuxer' | 'filter_complex';

  /** Output file path */
  outputPath: string;

  /** Validate timeline before conversion */
  validate?: boolean;
}

// ============================================================================
// Main Converter
// ============================================================================

/**
 * Convert timeline to FFmpeg command
 */
export function convertTimelineToFFmpeg(
  timeline: Timeline,
  options: ConversionOptions,
): ConversionResult {
  const warnings: string[] = [];

  // Validate timeline
  if (options.validate !== false) {
    const validationWarnings = validateTimelineForFFmpeg(timeline);
    warnings.push(...validationWarnings);
  }

  // Determine approach
  const approach = determineApproach(timeline, options.forceApproach);

  // Build command based on approach
  let command: FFmpegCommand;
  let concatFileContent: string | undefined;

  if (approach === 'concat_demuxer') {
    const videoClips = getVideoClips(timeline);
    concatFileContent = generateConcatDemuxerContent(videoClips, {
      includeDuration: true,
    });

    const concatFilePath = `${options.workingDir ?? '/tmp'}/concat_${Date.now()}.txt`;

    command = {
      inputs: [
        {
          path: concatFilePath,
          options: ['-f', 'concat', '-safe', '0'],
        },
      ],
      globalOptions: buildGlobalOptions(options),
      outputOptions: ['-c', 'copy'],
      outputPath: options.outputPath,
    };
  } else {
    command = buildFFmpegCommand(timeline, options.outputPath, options);
  }

  // Calculate estimated render time
  const estimatedRenderTime = estimateRenderTime(timeline, approach);

  return {
    command,
    commandString: commandToString(command, options.ffmpegPath),
    args: commandToArgs(command),
    concatFileContent,
    approach,
    estimatedRenderTime,
    warnings,
  };
}

/**
 * Determine the best approach for the timeline
 */
function determineApproach(
  timeline: Timeline,
  forceApproach?: 'concat_demuxer' | 'filter_complex',
): 'concat_demuxer' | 'filter_complex' {
  if (forceApproach) return forceApproach;

  // Check if concat demuxer is viable
  const videoClips = getVideoClips(timeline);

  // Need filter_complex if:
  // 1. Has transitions (other than cut)
  const hasTransitions = timeline.transitions.some((t) => t.type !== 'cut');
  if (hasTransitions) return 'filter_complex';

  // 2. Has audio tracks
  const hasAudio = timeline.tracks.some(
    (t) => t.type !== 'video' && t.clips.length > 0 && !t.isMuted,
  );
  if (hasAudio) return 'filter_complex';

  // 3. Clips are not compatible format
  const { compatible } = areClipsCompatible(videoClips);
  if (!compatible) return 'filter_complex';

  // 4. Need re-encoding (different output format/codec)
  // For now, assume concat is safe

  return 'concat_demuxer';
}

// ============================================================================
// Validation
// ============================================================================

/**
 * Validate timeline for FFmpeg rendering
 */
function validateTimelineForFFmpeg(timeline: Timeline): string[] {
  const warnings: string[] = [];

  // Check for empty timeline
  if (timeline.tracks.length === 0) {
    warnings.push('Timeline has no tracks');
  }

  // Check for video track
  const videoTrack = timeline.tracks.find((t) => t.type === 'video');
  if (!videoTrack) {
    warnings.push('Timeline has no video track');
  } else if (videoTrack.clips.length === 0) {
    warnings.push('Video track has no clips');
  }

  // Check for placeholder clips
  const placeholderCount = timeline.tracks
    .flatMap((t) => t.clips)
    .filter((c) => c.isPlaceholder).length;
  if (placeholderCount > 0) {
    warnings.push(`Timeline has ${placeholderCount} placeholder clip(s)`);
  }

  // Check transition validity
  for (const transition of timeline.transitions) {
    const clipBefore = findClipById(timeline, transition.clipBeforeId);
    const clipAfter = findClipById(timeline, transition.clipAfterId);

    if (!clipBefore) {
      warnings.push(
        `Transition ${transition.id} references missing clip ${transition.clipBeforeId}`,
      );
    }

    if (!clipAfter) {
      warnings.push(
        `Transition ${transition.id} references missing clip ${transition.clipAfterId}`,
      );
    }

    if (clipBefore && clipAfter) {
      // Check transition duration doesn't exceed clip duration
      if (transition.duration > clipBefore.duration) {
        warnings.push(
          `Transition ${transition.id} duration exceeds clip ${clipBefore.name} duration`,
        );
      }
      if (transition.duration > clipAfter.duration) {
        warnings.push(
          `Transition ${transition.id} duration exceeds clip ${clipAfter.name} duration`,
        );
      }
    }
  }

  // Check for overlapping clips on same track
  for (const track of timeline.tracks) {
    const sortedClips = [...track.clips].sort(
      (a, b) => a.startTime - b.startTime,
    );
    for (let i = 0; i < sortedClips.length - 1; i++) {
      const current = sortedClips[i];
      const next = sortedClips[i + 1];
      if (!current || !next) continue;

      const currentEnd = current.startTime + current.duration;

      if (currentEnd > next.startTime) {
        warnings.push(
          `Clips "${current.name}" and "${next.name}" overlap on track ${track.name}`,
        );
      }
    }
  }

  return warnings;
}

// ============================================================================
// Time Estimation
// ============================================================================

/**
 * Estimate render time in seconds
 */
function estimateRenderTime(
  timeline: Timeline,
  approach: 'concat_demuxer' | 'filter_complex',
): number {
  const baseDuration = timeline.duration;

  if (approach === 'concat_demuxer') {
    // Concat demuxer is very fast (essentially file copying)
    return Math.ceil(baseDuration * 0.1);
  }

  // filter_complex requires re-encoding
  const qualityMultiplier = getQualityMultiplier(timeline);
  const resolutionMultiplier = getResolutionMultiplier(timeline);
  const transitionOverhead = timeline.transitions.length * 2;
  const audioMixingOverhead =
    timeline.tracks.filter((t) => t.type !== 'video').length * 5;

  return Math.ceil(
    baseDuration * 0.5 * qualityMultiplier * resolutionMultiplier +
      transitionOverhead +
      audioMixingOverhead,
  );
}

function getQualityMultiplier(timeline: Timeline): number {
  switch (timeline.renderSettings.quality) {
    case 'draft':
      return 0.5;
    case 'standard':
      return 1.0;
    case 'high':
      return 2.0;
    default:
      return 1.0;
  }
}

function getResolutionMultiplier(timeline: Timeline): number {
  const pixels = timeline.renderSettings.width * timeline.renderSettings.height;
  const hdPixels = 1920 * 1080;

  if (pixels <= hdPixels * 0.5) return 0.7;
  if (pixels <= hdPixels) return 1.0;
  if (pixels <= hdPixels * 2) return 1.5;
  return 2.5;
}

// ============================================================================
// Helper Functions
// ============================================================================

function buildGlobalOptions(options: FFmpegCommandOptions): string[] {
  const globalOpts: string[] = ['-y', '-hide_banner'];

  if (options.hwaccel && options.hwaccel !== 'none') {
    globalOpts.push('-hwaccel', options.hwaccel);
  }

  if (options.threads) {
    globalOpts.push('-threads', options.threads.toString());
  }

  return globalOpts;
}

function getVideoClips(timeline: Timeline): Clip[] {
  const videoTrack = timeline.tracks.find((t) => t.type === 'video');
  if (!videoTrack) return [];
  return [...videoTrack.clips]
    .filter((c) => !c.isPlaceholder)
    .sort((a, b) => a.startTime - b.startTime);
}

function findClipById(timeline: Timeline, clipId: string): Clip | undefined {
  for (const track of timeline.tracks) {
    const clip = track.clips.find((c) => c.id === clipId);
    if (clip) return clip;
  }
  return undefined;
}

// ============================================================================
// Export Utilities
// ============================================================================

/**
 * Generate FFmpeg command for quick preview (lower quality, faster render)
 */
export function generatePreviewCommand(
  timeline: Timeline,
  outputPath: string,
): ConversionResult {
  // Override settings for preview
  const previewTimeline: Timeline = {
    ...timeline,
    renderSettings: {
      ...timeline.renderSettings,
      width: Math.min(timeline.renderSettings.width, 1280),
      height: Math.min(timeline.renderSettings.height, 720),
      quality: 'draft',
      crf: 28,
    },
  };

  return convertTimelineToFFmpeg(previewTimeline, {
    outputPath,
    forceApproach: 'filter_complex',
  });
}

/**
 * Generate FFmpeg command for thumbnail extraction
 */
export function generateThumbnailCommand(
  videoUrl: string,
  outputPath: string,
  timeSeconds = 0,
): string[] {
  return [
    '-y',
    '-hide_banner',
    '-ss',
    timeSeconds.toString(),
    '-i',
    videoUrl,
    '-vframes',
    '1',
    '-q:v',
    '2',
    outputPath,
  ];
}

/**
 * Generate FFmpeg command for video probe (get duration, resolution, etc.)
 */
export function generateProbeCommand(videoUrl: string): string[] {
  return [
    '-v',
    'quiet',
    '-print_format',
    'json',
    '-show_format',
    '-show_streams',
    videoUrl,
  ];
}
