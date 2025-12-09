/**
 * Timeline to FFmpeg Converter
 *
 * Converts timeline editor JSON structure to FFmpeg commands.
 * This is the bridge between the Edit Suite and the rendering pipeline.
 */

import type {
  TimelineProject,
  TimelineTrack,
  TimelineClip,
  ClipEffect,
  ClipTransition,
  TimelineExportSettings,
} from './timeline-types';
import { framesToSeconds, sortClipsByStart } from './timeline-types';
import type { RenderRequest, VideoClip, AudioClip, Transition, TransitionType } from '../types';
import { FFMPEG_TRANSITIONS } from '../constants';

/**
 * Render plan generated from timeline
 */
export interface TimelineRenderPlan {
  /** FFmpeg inputs (-i arguments) */
  inputs: string[];
  /** Filter graph string */
  filterGraph: string;
  /** Output options */
  outputOptions: string[];
  /** Estimated render duration in seconds */
  estimatedDuration: number;
  /** Total output duration in seconds */
  outputDuration: number;
}

/**
 * Convert a timeline project to a RenderRequest
 */
export function timelineToRenderRequest(
  project: TimelineProject,
  exportSettings: TimelineExportSettings
): RenderRequest {
  const videoTracks = project.tracks.filter(
    (t) => t.type === 'video' && t.visible !== false
  );
  const audioTracks = project.tracks.filter(
    (t) => t.type === 'audio' && !t.muted
  );

  // Get all video clips sorted by start time
  const allVideoClips: TimelineClip[] = [];
  for (const track of videoTracks) {
    allVideoClips.push(...track.clips);
  }
  const sortedVideoClips = sortClipsByStart(allVideoClips);

  // Convert timeline clips to VideoClip format
  const shots: VideoClip[] = sortedVideoClips.map((clip) =>
    timelineClipToVideoClip(clip, project.frameRate)
  );

  // Extract transitions between clips (N-1 transitions for N clips)
  const transitions: Transition[] = [];
  for (let i = 1; i < sortedVideoClips.length; i++) {
    const clip = sortedVideoClips[i];
    if (clip.transitionIn) {
      transitions.push(timelineTransitionToTransition(clip.transitionIn, project.frameRate));
    } else {
      // Default cut transition between clips
      transitions.push({ type: 'cut', duration: 0 });
    }
  }

  // Convert audio clips
  const audioClips: AudioClip[] = [];
  for (const track of audioTracks) {
    for (const clip of track.clips) {
      audioClips.push(timelineClipToAudioClip(clip, project.frameRate, track.volume));
    }
  }

  // Build render request
  return {
    id: project.id,
    shots,
    transitions: transitions.length > 0 ? transitions : undefined,
    audioTracks: audioClips.length > 0 ? audioClips : undefined,
    outputFormat: exportSettings.format,
    resolution: exportSettings.resolution === 'custom' ? '1080p' : exportSettings.resolution,
    quality: exportSettings.quality,
    videoCodec: exportSettings.videoCodec,
    audioCodec: exportSettings.audioCodec,
    framerate: exportSettings.frameRate,
  };
}

/**
 * Convert a TimelineClip to a VideoClip
 */
function timelineClipToVideoClip(clip: TimelineClip, frameRate: number): VideoClip {
  return {
    id: clip.id,
    sourceUrl: clip.sourceUrl,
    duration: framesToSeconds(clip.outPoint - clip.inPoint, frameRate),
    startTime: framesToSeconds(clip.startFrame, frameRate),
    inPoint: framesToSeconds(clip.inPoint, frameRate),
    outPoint: framesToSeconds(clip.outPoint, frameRate),
    volume: clip.volume,
  };
}

/**
 * Convert a TimelineClip to an AudioClip
 */
function timelineClipToAudioClip(
  clip: TimelineClip,
  frameRate: number,
  trackVolume?: number
): AudioClip {
  // Find fade effects
  let fadeIn: number | undefined;
  let fadeOut: number | undefined;

  if (clip.effects) {
    for (const effect of clip.effects) {
      if (effect.type === 'fade-in' && effect.parameters.duration) {
        fadeIn = framesToSeconds(effect.parameters.duration, frameRate);
      }
      if (effect.type === 'fade-out' && effect.parameters.duration) {
        fadeOut = framesToSeconds(effect.parameters.duration, frameRate);
      }
    }
  }

  // Combine clip volume with track volume
  const volume = (clip.volume ?? 1) * (trackVolume ?? 1);

  return {
    id: clip.id,
    sourceUrl: clip.sourceUrl,
    startTime: framesToSeconds(clip.startFrame, frameRate),
    duration: framesToSeconds(clip.outPoint - clip.inPoint, frameRate),
    volume,
    fadeIn,
    fadeOut,
    isBackground: clip.metadata?.isBackground === true,
  };
}

/**
 * Convert a ClipTransition to a Transition
 */
function timelineTransitionToTransition(
  transition: ClipTransition,
  frameRate: number
): Transition {
  // Map timeline transition types to our TransitionType
  const typeMap: Record<string, TransitionType> = {
    crossfade: 'crossfade',
    dissolve: 'dissolve',
    'fade-to-black': 'fade',
    'fade-from-black': 'fade',
    'wipe-left': 'wipe-left',
    'wipe-right': 'wipe-right',
    'wipe-up': 'wipe-up',
    'wipe-down': 'wipe-down',
    'slide-left': 'wipe-left',
    'slide-right': 'wipe-right',
    'zoom-in': 'fade',
    'zoom-out': 'fade',
  };

  return {
    type: typeMap[transition.type] || 'crossfade',
    duration: framesToSeconds(transition.durationFrames, frameRate),
    easing: transition.easing,
  };
}

/**
 * Generate a complete FFmpeg render plan from a timeline
 */
export function generateRenderPlan(
  project: TimelineProject,
  exportSettings: TimelineExportSettings
): TimelineRenderPlan {
  const videoTracks = project.tracks.filter((t) => t.type === 'video');
  const audioTracks = project.tracks.filter((t) => t.type === 'audio');

  const inputs: string[] = [];
  const filterParts: string[] = [];
  let inputIndex = 0;

  // Collect all unique source files
  const sourceMap = new Map<string, number>();

  // Process video tracks
  for (const track of videoTracks) {
    const sortedClips = sortClipsByStart(track.clips);

    for (const clip of sortedClips) {
      if (!sourceMap.has(clip.sourceUrl)) {
        sourceMap.set(clip.sourceUrl, inputIndex);
        inputs.push(clip.sourceUrl);
        inputIndex++;
      }
    }
  }

  // Process audio tracks
  for (const track of audioTracks) {
    for (const clip of track.clips) {
      if (!sourceMap.has(clip.sourceUrl)) {
        sourceMap.set(clip.sourceUrl, inputIndex);
        inputs.push(clip.sourceUrl);
        inputIndex++;
      }
    }
  }

  // Build video filter chain
  const videoFilterChain = buildVideoFilterChain(videoTracks, sourceMap, project.frameRate);
  filterParts.push(...videoFilterChain);

  // Build audio filter chain
  const audioFilterChain = buildAudioFilterChain(audioTracks, sourceMap, project.frameRate);
  filterParts.push(...audioFilterChain);

  // Build output options
  const outputOptions = buildOutputOptions(exportSettings);

  // Calculate durations
  const outputDuration = framesToSeconds(project.durationFrames, project.frameRate);
  const estimatedDuration = estimateRenderTime(
    outputDuration,
    exportSettings.resolution,
    exportSettings.quality
  );

  return {
    inputs,
    filterGraph: filterParts.join(';'),
    outputOptions,
    estimatedDuration,
    outputDuration,
  };
}

/**
 * Build video filter chain
 */
function buildVideoFilterChain(
  tracks: TimelineTrack[],
  sourceMap: Map<string, number>,
  frameRate: number
): string[] {
  const filters: string[] = [];
  const clipOutputs: string[] = [];
  let clipIndex = 0;

  for (const track of tracks) {
    const sortedClips = sortClipsByStart(track.clips);

    for (const clip of sortedClips) {
      const inputIdx = sourceMap.get(clip.sourceUrl);
      if (inputIdx === undefined) continue;

      const outputLabel = `v${clipIndex}`;
      const startSec = framesToSeconds(clip.inPoint, frameRate);
      const endSec = framesToSeconds(clip.outPoint, frameRate);

      // Build trim and setpts filter
      let filter = `[${inputIdx}:v]trim=start=${startSec}:end=${endSec},setpts=PTS-STARTPTS`;

      // Apply effects
      if (clip.effects) {
        for (const effect of clip.effects) {
          filter += `,${buildEffectFilter(effect, frameRate)}`;
        }
      }

      filters.push(`${filter}[${outputLabel}]`);
      clipOutputs.push(outputLabel);
      clipIndex++;
    }
  }

  // Concatenate all video clips
  if (clipOutputs.length > 1) {
    const concatInputs = clipOutputs.map((l) => `[${l}]`).join('');
    filters.push(`${concatInputs}concat=n=${clipOutputs.length}:v=1:a=0[outv]`);
  } else if (clipOutputs.length === 1) {
    // Use null filter to pass through single clip (FFmpeg doesn't have a 'copy' video filter)
    filters.push(`[${clipOutputs[0]}]null[outv]`);
  }

  return filters;
}

/**
 * Build audio filter chain
 */
function buildAudioFilterChain(
  tracks: TimelineTrack[],
  sourceMap: Map<string, number>,
  frameRate: number
): string[] {
  const filters: string[] = [];
  const audioOutputs: string[] = [];
  let audioIndex = 0;

  for (const track of tracks) {
    if (track.muted) continue;

    for (const clip of track.clips) {
      const inputIdx = sourceMap.get(clip.sourceUrl);
      if (inputIdx === undefined) continue;

      const outputLabel = `a${audioIndex}`;
      const startSec = framesToSeconds(clip.inPoint, frameRate);
      const endSec = framesToSeconds(clip.outPoint, frameRate);
      const volume = (clip.volume ?? 1) * (track.volume ?? 1);

      // Build audio filter
      let filter = `[${inputIdx}:a]atrim=start=${startSec}:end=${endSec},asetpts=PTS-STARTPTS`;

      // Apply volume
      if (volume !== 1) {
        filter += `,volume=${volume}`;
      }

      // Apply delay for timeline position
      const delaySec = framesToSeconds(clip.startFrame, frameRate);
      if (delaySec > 0) {
        const delayMs = Math.round(delaySec * 1000);
        filter += `,adelay=${delayMs}|${delayMs}`;
      }

      filters.push(`${filter}[${outputLabel}]`);
      audioOutputs.push(outputLabel);
      audioIndex++;
    }
  }

  // Mix all audio streams
  if (audioOutputs.length > 1) {
    const mixInputs = audioOutputs.map((l) => `[${l}]`).join('');
    filters.push(`${mixInputs}amix=inputs=${audioOutputs.length}:duration=longest[outa]`);
  } else if (audioOutputs.length === 1) {
    filters.push(`[${audioOutputs[0]}]acopy[outa]`);
  }

  return filters;
}

/**
 * Build effect filter string
 */
function buildEffectFilter(effect: ClipEffect, frameRate: number): string {
  const { type, parameters } = effect;

  switch (type) {
    case 'fade-in':
      return `fade=t=in:st=0:d=${framesToSeconds(parameters.duration ?? 30, frameRate)}`;
    case 'fade-out':
      return `fade=t=out:st=${framesToSeconds(effect.startFrame, frameRate)}:d=${framesToSeconds(parameters.duration ?? 30, frameRate)}`;
    case 'brightness':
      return `eq=brightness=${parameters.brightness ?? 0}`;
    case 'contrast':
      return `eq=contrast=${parameters.contrast ?? 1}`;
    case 'saturation':
      return `eq=saturation=${parameters.saturation ?? 1}`;
    case 'blur':
      return `boxblur=${parameters.blurRadius ?? 5}:${parameters.blurRadius ?? 5}`;
    case 'speed':
      return `setpts=${1 / (parameters.speed ?? 1)}*PTS`;
    case 'reverse':
      return 'reverse';
    case 'rotate':
      return `rotate=${parameters.rotation ?? 0}*PI/180`;
    case 'flip-horizontal':
      return 'hflip';
    case 'flip-vertical':
      return 'vflip';
    default:
      return 'null'; // Use null filter for unknown effects (pass-through)
  }
}

/**
 * Build output options
 */
function buildOutputOptions(settings: TimelineExportSettings): string[] {
  const options: string[] = [];

  // Resolution
  const resolutionMap: Record<string, string> = {
    '480p': '854:480',
    '720p': '1280:720',
    '1080p': '1920:1080',
    '4k': '3840:2160',
  };

  if (settings.resolution !== 'custom') {
    const scale = resolutionMap[settings.resolution];
    options.push(`-vf scale=${scale}:force_original_aspect_ratio=decrease,pad=${scale.split(':')[0]}:${scale.split(':')[1]}:(ow-iw)/2:(oh-ih)/2`);
  } else if (settings.customResolution) {
    const { width, height } = settings.customResolution;
    options.push(`-vf scale=${width}:${height}`);
  }

  // Video codec
  const videoCodecMap: Record<string, string[]> = {
    h264: ['-c:v', 'libx264', '-profile:v', 'high'],
    h265: ['-c:v', 'libx265', '-tag:v', 'hvc1'],
    vp9: ['-c:v', 'libvpx-vp9'],
    av1: ['-c:v', 'libaom-av1'],
  };
  options.push(...(videoCodecMap[settings.videoCodec ?? 'h264'] ?? videoCodecMap.h264));

  // Quality
  const qualityMap: Record<string, string[]> = {
    draft: ['-preset', 'ultrafast', '-crf', '28'],
    standard: ['-preset', 'medium', '-crf', '23'],
    high: ['-preset', 'slow', '-crf', '18'],
  };
  options.push(...(qualityMap[settings.quality] ?? qualityMap.standard));

  // Audio codec
  const audioCodecMap: Record<string, string[]> = {
    aac: ['-c:a', 'aac', '-b:a', `${settings.audioBitrate ?? 192}k`],
    mp3: ['-c:a', 'libmp3lame', '-b:a', `${settings.audioBitrate ?? 192}k`],
    opus: ['-c:a', 'libopus', '-b:a', `${settings.audioBitrate ?? 128}k`],
  };
  options.push(...(audioCodecMap[settings.audioCodec ?? 'aac'] ?? audioCodecMap.aac));

  // Frame rate
  options.push('-r', String(settings.frameRate));

  // Fast start for web
  if (settings.format === 'mp4') {
    options.push('-movflags', '+faststart');
  }

  return options;
}

/**
 * Estimate render time in seconds
 */
function estimateRenderTime(
  duration: number,
  resolution: string,
  quality: string
): number {
  // Base: 1 second video = 2 seconds render
  let multiplier = 2;

  // Resolution multiplier
  const resMultiplier: Record<string, number> = {
    '480p': 0.5,
    '720p': 0.75,
    '1080p': 1,
    '4k': 4,
  };
  multiplier *= resMultiplier[resolution] ?? 1;

  // Quality multiplier
  const qualMultiplier: Record<string, number> = {
    draft: 0.5,
    standard: 1,
    high: 2,
  };
  multiplier *= qualMultiplier[quality] ?? 1;

  return duration * multiplier;
}
