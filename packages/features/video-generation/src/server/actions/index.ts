/**
 * Video Generation Actions
 *
 * Server actions for video generation including single and batch operations.
 */

export * from './schemas';
export { generateVideoAction } from './generate-video-action';
export { batchGenerateVideosAction } from './batch-generate-action';
export { pollVideoStatusAction } from './poll-status-action';
export { cancelVideoJobAction } from './cancel-action';

// Backward compatibility re-exports (deprecated)
export {
  pollVideoStatusAction as legacyPollVideoStatusAction,
  cancelVideoJobAction as legacyCancelVideoJobAction,
} from './poll-cancel-actions';
