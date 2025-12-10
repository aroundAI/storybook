/**
 * FFmpeg exports for @kit/video-rendering
 */

// Provider
export {
  FFmpegRenderProvider,
  clearJobStorage,
  getAllJobs,
} from './ffmpeg-provider';

// Command builder
export {
  buildFFmpegCommand,
  buildConcatDemuxerCommand,
  buildFilterComplexCommand,
  commandToString,
  commandToArgs,
  type FFmpegCommand,
  type FFmpegInput,
  type FFmpegCommandOptions,
} from './command-builder';

// Concat demuxer
export {
  generateConcatDemuxerContent,
  generateConcatEntries,
  buildConcatDemuxerArgs,
  areClipsCompatible,
  validateConcatContent,
  calculateTotalDuration,
  estimateOutputSize,
  type ConcatDemuxerEntry,
  type ConcatDemuxerOptions,
} from './concat-demuxer';

// Transitions
export {
  mapTransitionToXfade,
  buildXfadeFilter,
  buildXfadeChain,
  isTransitionSupported,
  getSupportedTransitions,
  getAllXfadeTransitions,
  validateTransitionDuration,
  FFMPEG_TRANSITIONS,
  type TransitionConfig,
  type XfadeParams,
  type FFmpegTransition,
} from './transitions';

// Audio mixer
export {
  buildAudioFilterGraph,
  buildStreamFilters,
  buildMixFilter,
  buildSilentAudio,
  buildVolumeRamp,
  buildDuckingFilter,
  buildNormalizeFilter,
  buildEQFilter,
  getRecommendedVolumes,
  linearToDb,
  dbToLinear,
  type AudioStreamConfig,
  type AudioMixConfig,
} from './audio-mixer';

// Timeline converter
export {
  convertTimelineToFFmpeg,
  generatePreviewCommand,
  generateThumbnailCommand,
  generateProbeCommand,
  type ConversionResult,
  type ConversionOptions,
} from './timeline-converter';
