/**
 * FFmpeg Command Builder
 *
 * Generates FFmpeg commands for video concatenation, transitions, and audio mixing.
 * Supports complex filter graphs for professional video rendering.
 */

import type {
  VideoClip,
  AudioClip,
  Transition,
  RenderRequest,
  FFmpegCommand,
  Resolution,
  QualityPreset,
  OutputFormat,
} from '../types';
import {
  RESOLUTION_DIMENSIONS,
  QUALITY_PRESETS,
  FORMAT_CODECS,
  VIDEO_CODEC_ARGS,
  AUDIO_CODEC_ARGS,
  FFMPEG_TRANSITIONS,
} from '../constants';

/**
 * Build a simple concatenation command for multiple video clips
 * Uses the concat filter for re-encoding (handles different codecs/formats)
 */
export function buildConcatCommand(
  clips: VideoClip[],
  outputPath: string,
  options: {
    resolution?: Resolution;
    quality?: QualityPreset;
    format?: OutputFormat;
  } = {}
): FFmpegCommand {
  const { resolution = '1080p', quality = 'standard', format = 'mp4' } = options;

  // Generate input arguments
  const inputs = clips.map((clip) => `-i "${clip.sourceUrl}"`);

  // Build filter complex for concatenation
  // Format: [0:v][0:a][1:v][1:a]...concat=n=N:v=1:a=1[outv][outa]
  const filterInputs = clips.map((_, i) => `[${i}:v][${i}:a]`).join('');
  const filterComplex = `${filterInputs}concat=n=${clips.length}:v=1:a=1[outv][outa]`;

  // Get codec and quality settings
  const codecArgs = getCodecArgs(format, quality);
  const resolutionArgs = getResolutionFilter(resolution);

  const outputArgs = [
    '-map "[outv]"',
    '-map "[outa]"',
    ...codecArgs,
    `-vf "${resolutionArgs}"`,
    '-movflags +faststart', // Enable fast start for web playback
    `"${outputPath}"`,
  ];

  const fullCommand = `ffmpeg ${inputs.join(' ')} -filter_complex "${filterComplex}" ${outputArgs.join(' ')}`;

  return {
    inputs,
    filterComplex,
    outputArgs,
    fullCommand,
  };
}

/**
 * Build a command with crossfade transitions between clips
 */
export function buildTransitionCommand(
  clips: VideoClip[],
  transitions: Transition[],
  outputPath: string,
  options: {
    resolution?: Resolution;
    quality?: QualityPreset;
    format?: OutputFormat;
  } = {}
): FFmpegCommand {
  const { resolution = '1080p', quality = 'standard', format = 'mp4' } = options;

  if (clips.length < 2) {
    return buildConcatCommand(clips, outputPath, options);
  }

  const inputs = clips.map((clip) => `-i "${clip.sourceUrl}"`);

  // Build xfade filter chain for video
  // Each xfade combines two inputs into one, then that output is used for the next
  const videoFilters: string[] = [];
  const audioFilters: string[] = [];

  let currentVideoLabel = '0:v';
  let currentAudioLabel = '0:a';

  for (let i = 1; i < clips.length; i++) {
    const transition = transitions[i - 1] || { type: 'crossfade', duration: 0.5 };
    const transitionType = FFMPEG_TRANSITIONS[transition.type] || 'fade';
    const transitionDuration = transition.duration;

    // Calculate offset: previous clip duration minus transition duration
    const previousClip = clips[i - 1];
    const offset = previousClip.duration - transitionDuration;

    const outputVideoLabel = i === clips.length - 1 ? 'outv' : `v${i}`;
    const outputAudioLabel = i === clips.length - 1 ? 'outa' : `a${i}`;

    // Video transition
    videoFilters.push(
      `[${currentVideoLabel}][${i}:v]xfade=transition=${transitionType}:duration=${transitionDuration}:offset=${offset}[${outputVideoLabel}]`
    );

    // Audio crossfade
    audioFilters.push(
      `[${currentAudioLabel}][${i}:a]acrossfade=d=${transitionDuration}:c1=tri:c2=tri[${outputAudioLabel}]`
    );

    currentVideoLabel = outputVideoLabel;
    currentAudioLabel = outputAudioLabel;
  }

  const filterComplex = [...videoFilters, ...audioFilters].join(';');

  const codecArgs = getCodecArgs(format, quality);
  const resolutionArgs = getResolutionFilter(resolution);

  const outputArgs = [
    '-map "[outv]"',
    '-map "[outa]"',
    ...codecArgs,
    `-vf "${resolutionArgs}"`,
    '-movflags +faststart',
    `"${outputPath}"`,
  ];

  const fullCommand = `ffmpeg ${inputs.join(' ')} -filter_complex "${filterComplex}" ${outputArgs.join(' ')}`;

  return {
    inputs,
    filterComplex,
    outputArgs,
    fullCommand,
  };
}

/**
 * Build a command that includes background audio mixing
 */
export function buildAudioMixCommand(
  clips: VideoClip[],
  audioTracks: AudioClip[],
  outputPath: string,
  options: {
    resolution?: Resolution;
    quality?: QualityPreset;
    format?: OutputFormat;
  } = {}
): FFmpegCommand {
  const { resolution = '1080p', quality = 'standard', format = 'mp4' } = options;

  // Video inputs first, then audio inputs
  const videoInputs = clips.map((clip) => `-i "${clip.sourceUrl}"`);
  const audioInputs = audioTracks.map((audio) => `-i "${audio.sourceUrl}"`);
  const inputs = [...videoInputs, ...audioInputs];

  const videoCount = clips.length;
  const filterParts: string[] = [];

  // Concatenate videos
  const videoFilterInputs = clips.map((_, i) => `[${i}:v]`).join('');
  const videoAudioFilterInputs = clips.map((_, i) => `[${i}:a]`).join('');
  filterParts.push(
    `${videoFilterInputs}concat=n=${clips.length}:v=1:a=0[outv]`
  );
  filterParts.push(
    `${videoAudioFilterInputs}concat=n=${clips.length}:v=0:a=1[video_audio]`
  );

  // Process each background audio track
  const audioLabels: string[] = ['video_audio'];
  audioTracks.forEach((audio, i) => {
    const inputIndex = videoCount + i;
    const volume = audio.volume ?? 0.3; // Background music typically quieter
    const label = `bg_audio_${i}`;

    let filter = `[${inputIndex}:a]volume=${volume}`;

    // Add fade in/out if specified
    if (audio.fadeIn) {
      filter += `,afade=t=in:st=0:d=${audio.fadeIn}`;
    }
    if (audio.fadeOut) {
      const fadeOutStart = audio.duration - audio.fadeOut;
      filter += `,afade=t=out:st=${fadeOutStart}:d=${audio.fadeOut}`;
    }

    // Delay to start at the right time
    if (audio.startTime > 0) {
      filter += `,adelay=${Math.round(audio.startTime * 1000)}|${Math.round(audio.startTime * 1000)}`;
    }

    filterParts.push(`${filter}[${label}]`);
    audioLabels.push(label);
  });

  // Mix all audio streams
  const mixInputs = audioLabels.map((l) => `[${l}]`).join('');
  filterParts.push(
    `${mixInputs}amix=inputs=${audioLabels.length}:duration=first:dropout_transition=2[outa]`
  );

  const filterComplex = filterParts.join(';');

  const codecArgs = getCodecArgs(format, quality);
  const resolutionArgs = getResolutionFilter(resolution);

  const outputArgs = [
    '-map "[outv]"',
    '-map "[outa]"',
    ...codecArgs,
    `-vf "${resolutionArgs}"`,
    '-movflags +faststart',
    `"${outputPath}"`,
  ];

  const fullCommand = `ffmpeg ${inputs.join(' ')} -filter_complex "${filterComplex}" ${outputArgs.join(' ')}`;

  return {
    inputs,
    filterComplex,
    outputArgs,
    fullCommand,
  };
}

/**
 * Build a complete render command from a RenderRequest
 */
export function buildCompleteRenderCommand(
  request: RenderRequest,
  outputPath: string
): FFmpegCommand {
  const { shots, audioTracks, transitions, resolution, quality, outputFormat } = request;

  const options = { resolution, quality, format: outputFormat };

  // If we have background audio, use audio mix command
  if (audioTracks && audioTracks.length > 0) {
    return buildAudioMixCommand(shots, audioTracks, outputPath, options);
  }

  // If we have transitions, use transition command
  if (transitions && transitions.length > 0) {
    return buildTransitionCommand(shots, transitions, outputPath, options);
  }

  // Otherwise, simple concatenation
  return buildConcatCommand(shots, outputPath, options);
}

/**
 * Get codec arguments for the given format and quality
 */
function getCodecArgs(format: OutputFormat, quality: QualityPreset): string[] {
  const codec = FORMAT_CODECS[format];
  const qualitySettings = QUALITY_PRESETS[quality];
  const videoArgs = VIDEO_CODEC_ARGS[codec.video];
  const audioArgs = AUDIO_CODEC_ARGS[codec.audio];

  return [
    ...videoArgs,
    `-preset ${qualitySettings.preset}`,
    `-crf ${qualitySettings.crf}`,
    ...audioArgs,
  ];
}

/**
 * Get resolution scale filter
 */
function getResolutionFilter(resolution: Resolution): string {
  const dims = RESOLUTION_DIMENSIONS[resolution];
  // Scale to resolution while maintaining aspect ratio, padding if needed
  return `scale=${dims.width}:${dims.height}:force_original_aspect_ratio=decrease,pad=${dims.width}:${dims.height}:(ow-iw)/2:(oh-ih)/2`;
}

/**
 * Build a probe command to get video metadata
 */
export function buildProbeCommand(inputPath: string): string {
  return `ffprobe -v quiet -print_format json -show_format -show_streams "${inputPath}"`;
}

/**
 * Build a thumbnail extraction command
 */
export function buildThumbnailCommand(
  inputPath: string,
  outputPath: string,
  timestamp: number = 0
): string {
  return `ffmpeg -ss ${timestamp} -i "${inputPath}" -vframes 1 -q:v 2 "${outputPath}"`;
}

/**
 * Estimate render time based on input duration and quality
 * Returns estimated time in milliseconds
 */
export function estimateRenderTime(
  totalDuration: number,
  resolution: Resolution,
  quality: QualityPreset
): number {
  // Base multiplier: seconds of render time per second of video
  const baseMultipliers: Record<Resolution, number> = {
    '480p': 0.5,
    '720p': 1.0,
    '1080p': 2.0,
    '4k': 8.0,
  };

  const qualityMultipliers: Record<QualityPreset, number> = {
    draft: 0.5,
    standard: 1.0,
    high: 2.0,
  };

  const multiplier = baseMultipliers[resolution] * qualityMultipliers[quality];
  return Math.round(totalDuration * multiplier * 1000);
}
