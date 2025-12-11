/**
 * Timeline Editor - Barrel exports
 *
 * Multi-track timeline component for video editing with drag-drop, zoom, and playhead controls.
 */

export { TimelineEditor } from './timeline-editor';
export { useTimelineContext } from './timeline-context';
export { ClipEditor } from './clip-editor';
export { DualRangeSlider } from './dual-range-slider';

// Export types
export type {
  TimelineEditorProps,
  TimelineData,
  TimelineClip,
  TimelineTrack,
  TimelineState,
  TimelineAction,
  ClipType,
  ClipMetadata,
} from './types';

// Export constants (these are runtime values, not types)
export { ZOOM_LEVELS, DEFAULT_TRACKS } from './types';
