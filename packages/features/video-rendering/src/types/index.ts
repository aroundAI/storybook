/**
 * Type exports for @kit/video-rendering
 */

// Timeline types
export type {
  TrackType,
  TransitionType,
  VideoCodec,
  AudioCodec,
  OutputFormat,
  RenderQuality,
  WipeDirection,
  Clip,
  Track,
  Transition,
  TransitionParams,
  RenderSettings,
  TimelineMetadata,
  Timeline,
  CreateTimeline,
  UpdateTimeline,
  ResolvedClip,
  TimelineGap,
  ClipOverlap,
  TimelineValidationResult,
  TimelineValidationError,
  TimelineValidationWarning,
  TimelineStats,
  AspectRatioPreset,
  ResolutionPreset,
  QualityPresetConfig,
} from './timeline';

export { RESOLUTION_PRESETS, QUALITY_PRESETS } from './timeline';

// Render job types
export type {
  RenderStatus,
  RenderProviderType,
  RenderJobRequest,
  RenderJobResponse,
  RenderJobStatus,
  RenderCostEstimate,
  RenderCapabilities,
  BaseProviderConfig,
  FFmpegProviderConfig,
  RemotionProviderConfig,
  ShotstackProviderConfig,
  CreatomateProviderConfig,
  ProviderConfig,
  RenderWebhookPayload,
} from './render-job';
