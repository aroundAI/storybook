/**
 * Remotion exports for @kit/video-rendering
 */

// Provider
export {
  RemotionRenderProvider,
  clearRemotionJobStorage,
  getAllRemotionJobs,
} from './remotion-provider';

// Timeline converter
export {
  convertTimelineToRemotion,
  convertRenderSettings,
  validateTimelineForRemotion,
  generateRemotionCompositionCode,
  generateTimelineComponentCode,
  calculateTotalFrames,
  secondsToFrames,
  framesToSeconds,
  type RemotionCompositionProps,
  type RemotionTrack,
  type RemotionClip,
  type RemotionTransition,
  type RemotionRenderConfig,
} from './timeline-converter';
