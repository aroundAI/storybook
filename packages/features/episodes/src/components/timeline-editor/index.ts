/**
 * Timeline Editor - Barrel exports
 *
 * Multi-track timeline component for video editing with drag-drop, zoom, and playhead controls.
 */

export { TimelineEditor } from './timeline-editor';
export { useTimelineContext } from './timeline-context';
export type {
  TimelineEditorProps,
  TimelineData,
  TimelineClip,
  TimelineTrack,
  TimelineState,
  TimelineAction,
  ClipType,
  ZOOM_LEVELS,
  DEFAULT_TRACKS,
} from './types';
