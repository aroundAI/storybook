/**
 * TypeScript interfaces for the Timeline Editor component
 *
 * Provides type definitions for timeline state, tracks, clips, and actions.
 */
import type { TrackType } from '@kit/film-studio/design-tokens';

// ============================================================================
// Core Types
// ============================================================================

/**
 * Clip types that can appear on the timeline
 */
export type ClipType = 'video' | 'dialogue' | 'music' | 'sfx' | 'ambient';

/**
 * Individual clip on a timeline track
 */
export interface TimelineClip {
  /** Unique identifier for this clip */
  id: string;
  /** Type of track this clip belongs to */
  trackType: ClipType;
  /** Starting frame position on timeline */
  startFrame: number;
  /** Duration in frames */
  durationFrames: number;
  /** Display name for the clip */
  name: string;
  /** Reference to source shot (for video clips) */
  shotId?: string;
  /** Reference to audio asset (for audio clips) */
  audioAssetId?: string;
  /** Video URL for preview */
  videoUrl?: string;
  /** Thumbnail URL for video clips */
  thumbnailUrl?: string;
  /** Waveform data for audio clips */
  waveformData?: number[];
  /** Whether clip is locked from editing */
  isLocked: boolean;
}

/**
 * Timeline track containing clips
 */
export interface TimelineTrack {
  /** Unique identifier for this track */
  id: string;
  /** Type of track (video, dialogue, music, sfx, ambient) */
  type: ClipType;
  /** Display name for the track */
  name: string;
  /** Clips on this track */
  clips: TimelineClip[];
  /** Whether track audio is muted */
  isMuted: boolean;
  /** Whether track is solo (only this track plays) */
  isSolo: boolean;
  /** Whether track is locked from editing */
  isLocked: boolean;
  /** Track height in pixels */
  height: number;
}

/**
 * History entry for undo/redo
 */
export interface TimelineHistoryEntry {
  /** Timestamp when action was performed */
  timestamp: number;
  /** Description of the action */
  action: string;
  /** Snapshot of tracks state */
  tracks: TimelineTrack[];
  /** Playhead position at time of action */
  playheadFrame: number;
}

/**
 * Complete timeline state
 */
export interface TimelineState {
  /** All tracks in the timeline */
  tracks: TimelineTrack[];
  /** Current playhead position in frames */
  playheadFrame: number;
  /** Whether playback is active */
  isPlaying: boolean;
  /** Total duration in frames */
  totalFrames: number;
  /** Frames per second */
  fps: number;

  /** Zoom level (pixels per second, 10-500) */
  zoom: number;
  /** Horizontal scroll position */
  scrollX: number;
  /** Vertical scroll position */
  scrollY: number;

  /** Currently selected clip IDs */
  selectedClipIds: Set<string>;
  /** Currently selected track ID */
  selectedTrackId: string | null;

  /** Loop in-point (start) in frames */
  inPoint: number | null;
  /** Loop out-point (end) in frames */
  outPoint: number | null;

  /** Undo/redo history */
  history: TimelineHistoryEntry[];
  /** Current position in history */
  historyIndex: number;

  /** Whether snap-to-grid is enabled */
  snapEnabled: boolean;

  /** Current drag state */
  isDragging: boolean;
  /** ID of clip being dragged */
  draggedClipId: string | null;
  /** Edge being resized (null if moving) */
  resizeEdge: 'left' | 'right' | null;
}

// ============================================================================
// Action Types
// ============================================================================

export type TimelineAction =
  | { type: 'SET_PLAYHEAD'; frame: number }
  | { type: 'PLAY' }
  | { type: 'PAUSE' }
  | { type: 'TOGGLE_PLAYBACK' }
  | { type: 'TICK' }
  | { type: 'SET_ZOOM'; zoom: number }
  | { type: 'ZOOM_IN' }
  | { type: 'ZOOM_OUT' }
  | { type: 'SET_SCROLL'; x: number; y: number }
  | { type: 'SELECT_CLIP'; clipId: string; additive?: boolean }
  | { type: 'SELECT_CLIPS'; clipIds: string[] }
  | { type: 'DESELECT_ALL' }
  | {
      type: 'MOVE_CLIP';
      clipId: string;
      newStartFrame: number;
      newTrackId?: string;
    }
  | {
      type: 'RESIZE_CLIP';
      clipId: string;
      newStartFrame: number;
      newDurationFrames: number;
    }
  | { type: 'DELETE_CLIPS'; clipIds: string[] }
  | { type: 'DELETE_SELECTED' }
  | { type: 'ADD_CLIP'; trackId: string; clip: Omit<TimelineClip, 'id'> }
  | { type: 'SET_IN_POINT'; frame: number | null }
  | { type: 'SET_OUT_POINT'; frame: number | null }
  | { type: 'TOGGLE_TRACK_MUTE'; trackId: string }
  | { type: 'TOGGLE_TRACK_SOLO'; trackId: string }
  | { type: 'TOGGLE_TRACK_LOCK'; trackId: string }
  | { type: 'TOGGLE_SNAP' }
  | { type: 'UNDO' }
  | { type: 'REDO' }
  | { type: 'LOAD_TIMELINE'; data: TimelineData }
  | { type: 'START_DRAG'; clipId: string; resizeEdge?: 'left' | 'right' }
  | { type: 'END_DRAG' };

// ============================================================================
// Props and Data Types
// ============================================================================

/**
 * Props for the main TimelineEditor component
 */
export interface TimelineEditorProps {
  /** Episode ID for loading/saving timeline data */
  episodeId: string;
  /** Initial timeline data to load */
  initialData?: TimelineData;
  /** Callback when timeline is saved */
  onSave?: (data: TimelineData) => Promise<void>;
  /** Callback when playback state changes */
  onPlaybackStateChange?: (isPlaying: boolean, frame: number) => void;
  /** Frames per second (default: 30) */
  fps?: number;
  /** Additional CSS classes */
  className?: string;
}

/**
 * Serializable timeline data for persistence
 */
export interface TimelineData {
  /** All tracks with clips */
  tracks: TimelineTrack[];
  /** Total duration in frames */
  totalFrames: number;
  /** Frames per second */
  fps: number;
  /** Loop in-point */
  inPoint: number | null;
  /** Loop out-point */
  outPoint: number | null;
  /** Data format version */
  version: number;
}

// ============================================================================
// Constants
// ============================================================================

/**
 * Zoom level constraints
 */
export const ZOOM_LEVELS = {
  MIN: 10,
  MAX: 500,
  DEFAULT: 50,
  STEPS: [10, 25, 50, 100, 200, 500],
} as const;

/**
 * Default track configuration
 */
export const DEFAULT_TRACKS: Omit<TimelineTrack, 'id' | 'clips'>[] = [
  {
    type: 'video',
    name: 'Video',
    isMuted: false,
    isSolo: false,
    isLocked: false,
    height: 80,
  },
  {
    type: 'dialogue',
    name: 'Dialogue',
    isMuted: false,
    isSolo: false,
    isLocked: false,
    height: 60,
  },
  {
    type: 'music',
    name: 'Music',
    isMuted: false,
    isSolo: false,
    isLocked: false,
    height: 60,
  },
  {
    type: 'sfx',
    name: 'SFX',
    isMuted: false,
    isSolo: false,
    isLocked: false,
    height: 60,
  },
  {
    type: 'ambient',
    name: 'Ambient',
    isMuted: false,
    isSolo: false,
    isLocked: false,
    height: 60,
  },
];

/**
 * Maximum history entries for undo/redo
 */
export const MAX_HISTORY_SIZE = 50;

/**
 * Track type to TrackType mapping for design tokens
 */
export const CLIP_TYPE_TO_TRACK_TYPE: Record<ClipType, TrackType> = {
  video: 'video',
  dialogue: 'dialogue',
  music: 'music',
  sfx: 'sfx',
  ambient: 'ambient',
};
