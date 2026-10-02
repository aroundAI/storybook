/**
 * Duration-based content scaling utilities for Lambda handlers
 *
 * The one copy lives in `@kit/generation/duration-scaling` (FILM-1901),
 * where the stages' checks read it; this module keeps the worker's import
 * path. `@kit/episodes/lib` re-exports the same functions.
 */
export {
  type ContentScalingParams,
  type ContentScalingResult,
  type ContentStyle,
  calculateContentScaling,
  formatDuration,
} from '@kit/generation/duration-scaling';
