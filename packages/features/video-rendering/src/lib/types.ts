/**
 * Video Rendering Types
 *
 * Core type definitions for the video rendering pipeline.
 * Supports FFmpeg, Remotion, and cloud rendering services.
 */

/**
 * Available rendering providers
 */
export type RenderProvider =
  | 'ffmpeg-local'
  | 'ffmpeg-docker'
  | 'remotion'
  | 'shotstack'
  | 'creatomate'
  | 'mux';

/**
 * Render job status
 */
export type RenderStatus =
  | 'pending'
  | 'processing'
  | 'completed'
  | 'failed'
  | 'cancelled';

/**
 * Transition types between clips
 */
export type TransitionType =
  | 'cut'
  | 'fade'
  | 'crossfade'
  | 'dissolve'
  | 'wipe-left'
  | 'wipe-right'
  | 'wipe-up'
  | 'wipe-down';

/**
 * Output video format
 */
export type OutputFormat = 'mp4' | 'webm' | 'mov';

/**
 * Video resolution preset
 */
export type Resolution = '480p' | '720p' | '1080p' | '4k';

/**
 * Quality preset for encoding
 */
export type QualityPreset = 'draft' | 'standard' | 'high';

/**
 * Video codec options
 */
export type VideoCodec = 'h264' | 'h265' | 'vp9' | 'av1';

/**
 * Audio codec options
 */
export type AudioCodec = 'aac' | 'mp3' | 'opus' | 'vorbis';

/**
 * Represents a video clip in the rendering pipeline
 */
export interface VideoClip {
  /** Unique identifier for the clip */
  id: string;
  /** URL or path to the source video */
  sourceUrl: string;
  /** Duration of the clip in seconds */
  duration: number;
  /** Start time in the timeline (seconds) */
  startTime: number;
  /** Optional end time for trimming (seconds) */
  endTime?: number;
  /** In-point for trimming within the source (seconds) */
  inPoint?: number;
  /** Out-point for trimming within the source (seconds) */
  outPoint?: number;
  /** Volume multiplier (0-2, default 1) */
  volume?: number;
}

/**
 * Represents an audio clip in the rendering pipeline
 */
export interface AudioClip {
  /** Unique identifier for the clip */
  id: string;
  /** URL or path to the source audio */
  sourceUrl: string;
  /** Start time in the timeline (seconds) */
  startTime: number;
  /** Duration of the clip in seconds */
  duration: number;
  /** Volume multiplier (0-2, default 1) */
  volume?: number;
  /** Fade in duration (seconds) */
  fadeIn?: number;
  /** Fade out duration (seconds) */
  fadeOut?: number;
  /** Whether this is background music (mix under video audio) */
  isBackground?: boolean;
}

/**
 * Transition configuration between clips
 */
export interface Transition {
  /** Type of transition effect */
  type: TransitionType;
  /** Duration of the transition in seconds */
  duration: number;
  /** Easing function (linear, ease-in, ease-out, ease-in-out) */
  easing?: string;
}

/**
 * Text overlay configuration
 */
export interface TextOverlay {
  /** Text content */
  text: string;
  /** Start time in the timeline (seconds) */
  startTime: number;
  /** Duration to display (seconds) */
  duration: number;
  /** X position (0-1 normalized) */
  x?: number;
  /** Y position (0-1 normalized) */
  y?: number;
  /** Font size */
  fontSize?: number;
  /** Font color (hex) */
  fontColor?: string;
  /** Background color (hex) */
  backgroundColor?: string;
  /** Font family */
  fontFamily?: string;
}

/**
 * Request to render an episode or video composition
 */
export interface RenderRequest {
  /** Episode or job identifier */
  id: string;
  /** Project identifier */
  projectId?: string;
  /** Account identifier */
  accountId?: string;
  /** Video clips to stitch together */
  shots: VideoClip[];
  /** Optional audio tracks to mix */
  audioTracks?: AudioClip[];
  /** Transitions between clips */
  transitions?: Transition[];
  /** Text overlays */
  textOverlays?: TextOverlay[];
  /** Output video format */
  outputFormat: OutputFormat;
  /** Output resolution */
  resolution: Resolution;
  /** Quality preset */
  quality: QualityPreset;
  /** Video codec (optional, defaults based on format) */
  videoCodec?: VideoCodec;
  /** Audio codec (optional, defaults based on format) */
  audioCodec?: AudioCodec;
  /** Output framerate (default 30) */
  framerate?: number;
  /** Callback URL for completion notification */
  callbackUrl?: string;
}

/**
 * Result of a render operation
 */
export interface RenderResult {
  /** Job identifier */
  jobId: string;
  /** Current status */
  status: RenderStatus;
  /** Progress percentage (0-100) */
  progress?: number;
  /** URL to the rendered output (when completed) */
  outputUrl?: string;
  /** Duration of the rendered video (seconds) */
  duration?: number;
  /** File size in bytes */
  fileSize?: number;
  /** Time taken to render (milliseconds) */
  renderTime?: number;
  /** Error message (when failed) */
  error?: string;
  /** Estimated time remaining (seconds) */
  estimatedTimeRemaining?: number;
}

/**
 * Provider capabilities
 */
export interface RenderCapabilities {
  /** Supported output formats */
  supportedFormats: readonly OutputFormat[];
  /** Maximum resolution */
  maxResolution: Resolution;
  /** Supports transitions */
  supportsTransitions: boolean;
  /** Supported transition types */
  supportedTransitions?: readonly TransitionType[];
  /** Supports audio mixing */
  supportsAudioMixing: boolean;
  /** Supports text overlays */
  supportsTextOverlays: boolean;
  /** Maximum concurrent jobs */
  maxConcurrentJobs: number;
  /** Maximum input video count */
  maxInputVideos?: number;
  /** Maximum total duration (seconds) */
  maxDuration?: number;
}

/**
 * Provider configuration
 */
export interface ProviderConfig {
  /** Path to FFmpeg binary (for local providers) */
  ffmpegPath?: string;
  /** Path to FFprobe binary (for local providers) */
  ffprobePath?: string;
  /** Temporary directory for processing */
  tempDir?: string;
  /** Maximum concurrent render jobs */
  maxConcurrency?: number;
  /** API key (for cloud providers) */
  apiKey?: string;
  /** API base URL (for cloud providers) */
  baseUrl?: string;
  /** Request timeout in milliseconds */
  timeout?: number;
}

/**
 * Progress callback function type
 */
export type ProgressCallback = (progress: RenderProgress) => void;

/**
 * Detailed progress information
 */
export interface RenderProgress {
  /** Job identifier */
  jobId: string;
  /** Progress percentage (0-100) */
  percent: number;
  /** Current frame being processed */
  frame?: number;
  /** Total frames */
  totalFrames?: number;
  /** Current processing time (seconds) */
  currentTime?: number;
  /** Total duration to process (seconds) */
  totalTime?: number;
  /** Processing speed (e.g., "2.5x") */
  speed?: string;
  /** Current bitrate */
  bitrate?: string;
  /** Estimated time remaining (seconds) */
  eta?: number;
}

/**
 * FFmpeg command representation
 */
export interface FFmpegCommand {
  /** Input arguments */
  inputs: string[];
  /** Filter complex expression */
  filterComplex?: string;
  /** Output arguments */
  outputArgs: string[];
  /** Full command string (for debugging) */
  fullCommand: string;
}

/**
 * Benchmark result for a render operation
 */
export interface BenchmarkResult {
  /** Provider used */
  provider: RenderProvider;
  /** Number of input videos */
  inputCount: number;
  /** Total input duration (seconds) */
  inputDuration: number;
  /** Output resolution */
  resolution: Resolution;
  /** Quality preset used */
  quality: QualityPreset;
  /** Render time (milliseconds) */
  renderTime: number;
  /** Peak memory usage (bytes) */
  peakMemory?: number;
  /** Average CPU usage (percentage) */
  avgCpuUsage?: number;
  /** Output file size (bytes) */
  outputSize: number;
  /** Estimated cost (USD) */
  estimatedCost?: number;
}

/**
 * Cost estimation for different scale scenarios
 */
export interface CostEstimate {
  /** Provider */
  provider: RenderProvider;
  /** Cost per render (USD) */
  costPerRender: number;
  /** Monthly cost at 100 users */
  costAt100Users: number;
  /** Monthly cost at 1000 users */
  costAt1000Users: number;
  /** Monthly cost at 10000 users */
  costAt10000Users: number;
  /** Notes about pricing */
  notes?: string;
}
