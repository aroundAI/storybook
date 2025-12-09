/**
 * Video Rendering Constants
 *
 * Configuration constants for FFmpeg and rendering operations.
 */

import type { Resolution, QualityPreset, OutputFormat, VideoCodec } from './types';

/**
 * Resolution dimensions mapping
 */
export const RESOLUTION_DIMENSIONS: Record<Resolution, { width: number; height: number }> = {
  '480p': { width: 854, height: 480 },
  '720p': { width: 1280, height: 720 },
  '1080p': { width: 1920, height: 1080 },
  '4k': { width: 3840, height: 2160 },
};

/**
 * FFmpeg preset mappings for quality levels
 */
export const QUALITY_PRESETS: Record<QualityPreset, { preset: string; crf: number }> = {
  draft: { preset: 'ultrafast', crf: 28 },
  standard: { preset: 'medium', crf: 23 },
  high: { preset: 'slow', crf: 18 },
};

/**
 * Codec settings by format
 */
export const FORMAT_CODECS: Record<OutputFormat, { video: VideoCodec; audio: string }> = {
  mp4: { video: 'h264', audio: 'aac' },
  webm: { video: 'vp9', audio: 'opus' },
  mov: { video: 'h264', audio: 'aac' },
};

/**
 * FFmpeg video codec arguments
 */
export const VIDEO_CODEC_ARGS: Record<VideoCodec, string[]> = {
  h264: ['-c:v', 'libx264', '-profile:v', 'high', '-level:v', '4.1'],
  h265: ['-c:v', 'libx265', '-tag:v', 'hvc1'],
  vp9: ['-c:v', 'libvpx-vp9', '-row-mt', '1'],
  av1: ['-c:v', 'libaom-av1', '-cpu-used', '4'],
};

/**
 * FFmpeg audio codec arguments
 */
export const AUDIO_CODEC_ARGS: Record<string, string[]> = {
  aac: ['-c:a', 'aac', '-b:a', '192k'],
  mp3: ['-c:a', 'libmp3lame', '-b:a', '192k'],
  opus: ['-c:a', 'libopus', '-b:a', '128k'],
  vorbis: ['-c:a', 'libvorbis', '-b:a', '192k'],
};

/**
 * FFmpeg transition mappings
 * Maps our transition types to FFmpeg xfade filter transitions
 */
export const FFMPEG_TRANSITIONS: Record<string, string> = {
  cut: 'fade', // Actually no transition, handled separately
  fade: 'fade',
  crossfade: 'fade',
  dissolve: 'dissolve',
  'wipe-left': 'wipeleft',
  'wipe-right': 'wiperight',
  'wipe-up': 'wipeup',
  'wipe-down': 'wipedown',
};

/**
 * Default render settings
 */
export const DEFAULT_RENDER_SETTINGS = {
  framerate: 30,
  resolution: '1080p' as Resolution,
  quality: 'standard' as QualityPreset,
  outputFormat: 'mp4' as OutputFormat,
  maxConcurrentJobs: 4,
  tempDir: '/tmp/video-rendering',
  renderTimeout: 600000, // 10 minutes
};

/**
 * Cost estimates per provider (USD)
 * These are approximate estimates for comparison
 */
export const COST_ESTIMATES = {
  'ffmpeg-local': {
    perRender: 0.01, // Server costs only
    perMinuteOutput: 0.002,
    notes: 'Self-hosted, includes compute costs',
  },
  'ffmpeg-docker': {
    perRender: 0.02,
    perMinuteOutput: 0.003,
    notes: 'Docker container on cloud',
  },
  remotion: {
    perRender: 0.05,
    perMinuteOutput: 0.01,
    notes: 'Remotion Lambda pricing',
  },
  shotstack: {
    perRender: 0.1,
    perMinuteOutput: 0.02,
    notes: 'Pay-per-render cloud service',
  },
  creatomate: {
    perRender: 0.08,
    perMinuteOutput: 0.015,
    notes: 'Pay-per-render cloud service',
  },
  mux: {
    perRender: 0.0,
    perMinuteOutput: 0.0,
    notes: 'Mux does not support video composition/stitching',
  },
};

/**
 * Benchmark scenarios for testing
 */
export const BENCHMARK_SCENARIOS = [
  { shots: 5, shotDuration: 5, resolution: '720p' as Resolution },
  { shots: 10, shotDuration: 5, resolution: '1080p' as Resolution },
  { shots: 20, shotDuration: 5, resolution: '1080p' as Resolution },
  { shots: 10, shotDuration: 10, resolution: '4k' as Resolution },
];

/**
 * Maximum limits
 */
export const LIMITS = {
  maxShots: 100,
  maxAudioTracks: 10,
  maxTransitionDuration: 5, // seconds
  maxTextOverlays: 50,
  maxOutputDuration: 3600, // 1 hour
  maxConcurrentRenders: 10,
};
