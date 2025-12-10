/**
 * Schema exports for @kit/video-rendering
 */

export {
  // Enum schemas
  TrackTypeSchema,
  TransitionTypeSchema,
  VideoCodecSchema,
  AudioCodecSchema,
  OutputFormatSchema,
  RenderQualitySchema,
  WipeDirectionSchema,
  // Object schemas
  ClipSchema,
  TrackSchema,
  TransitionSchema,
  TransitionParamsSchema,
  RenderSettingsSchema,
  TimelineMetadataSchema,
  TimelineSchema,
  CreateTimelineSchema,
  UpdateTimelineSchema,
  // Types
  type TrackType,
  type TransitionType,
  type VideoCodec,
  type AudioCodec,
  type OutputFormat,
  type RenderQuality,
  type WipeDirection,
  type Clip,
  type Track,
  type Transition,
  type TransitionParams,
  type RenderSettings,
  type TimelineMetadata,
  type Timeline,
  type CreateTimeline,
  type UpdateTimeline,
  // Helpers
  validateTimeline,
  parseTimeline,
  calculateTimelineDuration,
  sortTrackClips,
  getAllClipsSorted,
  getClipsByTrackType,
} from './timeline';
