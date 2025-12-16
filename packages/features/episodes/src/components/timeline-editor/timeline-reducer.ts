/**
 * Timeline state reducer for managing timeline editor state
 *
 * Handles playback, clip manipulation, selection, zoom, and undo/redo.
 */
import type {
  TimelineAction,
  TimelineHistoryEntry,
  TimelineState,
  TimelineTrack,
} from './types';
import { DEFAULT_TRACKS, MAX_HISTORY_SIZE, ZOOM_LEVELS } from './types';

// ============================================================================
// History Helpers
// ============================================================================

function createHistoryEntry(
  state: TimelineState,
  action: string,
): TimelineHistoryEntry {
  return {
    timestamp: Date.now(),
    action,
    tracks: JSON.parse(JSON.stringify(state.tracks)) as TimelineTrack[],
    playheadFrame: state.playheadFrame,
  };
}

function pushHistory(state: TimelineState, action: string): TimelineState {
  const newEntry = createHistoryEntry(state, action);
  const newHistory = [
    ...state.history.slice(0, state.historyIndex + 1),
    newEntry,
  ].slice(-MAX_HISTORY_SIZE);

  return {
    ...state,
    history: newHistory,
    historyIndex: newHistory.length - 1,
  };
}

// ============================================================================
// ID Generator
// ============================================================================

function generateClipId(): string {
  return `clip-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

// ============================================================================
// Reducer
// ============================================================================

export function timelineReducer(
  state: TimelineState,
  action: TimelineAction,
): TimelineState {
  switch (action.type) {
    // Playback actions
    case 'SET_PLAYHEAD':
      return {
        ...state,
        playheadFrame: Math.max(
          0,
          Math.min(action.frame, state.totalFrames - 1),
        ),
      };

    case 'PLAY':
      return { ...state, isPlaying: true };

    case 'PAUSE':
      return { ...state, isPlaying: false };

    case 'TOGGLE_PLAYBACK':
      return { ...state, isPlaying: !state.isPlaying };

    case 'TICK': {
      const nextFrame = state.playheadFrame + 1;

      // Check for loop out-point
      if (state.outPoint !== null && nextFrame >= state.outPoint) {
        return {
          ...state,
          playheadFrame: state.inPoint ?? 0,
        };
      }

      // Check for end of timeline
      if (nextFrame >= state.totalFrames) {
        return {
          ...state,
          playheadFrame: 0,
          isPlaying: false,
        };
      }

      return { ...state, playheadFrame: nextFrame };
    }

    // Zoom actions
    case 'SET_ZOOM':
      return {
        ...state,
        zoom: Math.max(ZOOM_LEVELS.MIN, Math.min(action.zoom, ZOOM_LEVELS.MAX)),
      };

    case 'ZOOM_IN':
      return {
        ...state,
        zoom: Math.min(state.zoom * 1.5, ZOOM_LEVELS.MAX),
      };

    case 'ZOOM_OUT':
      return {
        ...state,
        zoom: Math.max(state.zoom / 1.5, ZOOM_LEVELS.MIN),
      };

    // Scroll actions
    case 'SET_SCROLL':
      return {
        ...state,
        scrollX: Math.max(0, action.x),
        scrollY: Math.max(0, action.y),
      };

    // Selection actions
    case 'SELECT_CLIP': {
      const newSelected = action.additive
        ? new Set([...state.selectedClipIds, action.clipId])
        : new Set([action.clipId]);
      return { ...state, selectedClipIds: newSelected };
    }

    case 'SELECT_CLIPS':
      return { ...state, selectedClipIds: new Set(action.clipIds) };

    case 'DESELECT_ALL':
      return { ...state, selectedClipIds: new Set() };

    // Clip manipulation actions
    case 'MOVE_CLIP': {
      const stateWithHistory = pushHistory(state, 'MOVE_CLIP');

      // Find the source track and clip
      let sourceTrackIndex = -1;
      let clipIndex = -1;
      let clip:
        | (typeof stateWithHistory.tracks)[number]['clips'][number]
        | null = null;

      for (let i = 0; i < stateWithHistory.tracks.length; i++) {
        const track = stateWithHistory.tracks[i];
        if (!track) continue;
        const idx = track.clips.findIndex((c) => c.id === action.clipId);
        if (idx !== -1) {
          sourceTrackIndex = i;
          clipIndex = idx;
          clip = track.clips[idx] ?? null;
          break;
        }
      }

      if (sourceTrackIndex === -1 || !clip) return stateWithHistory;

      // Moving to different track
      if (action.newTrackId) {
        const targetTrackIndex = stateWithHistory.tracks.findIndex(
          (t) => t.id === action.newTrackId,
        );
        if (targetTrackIndex === -1) return stateWithHistory;

        const targetTrack = stateWithHistory.tracks[targetTrackIndex];
        const sourceTrack = stateWithHistory.tracks[sourceTrackIndex];
        if (!targetTrack || !sourceTrack) return stateWithHistory;

        // Only allow moving to compatible tracks
        if (targetTrack.type !== clip.trackType) return stateWithHistory;

        const updatedTracks = [...stateWithHistory.tracks];

        // Remove from source track
        updatedTracks[sourceTrackIndex] = {
          ...sourceTrack,
          clips: sourceTrack.clips.filter((c) => c.id !== action.clipId),
        };

        // Add to target track
        updatedTracks[targetTrackIndex] = {
          ...targetTrack,
          clips: [
            ...targetTrack.clips,
            { ...clip, startFrame: Math.max(0, action.newStartFrame) },
          ],
        };

        return { ...stateWithHistory, tracks: updatedTracks };
      }

      // Moving within same track
      const sourceTrack = stateWithHistory.tracks[sourceTrackIndex];
      if (!sourceTrack) return stateWithHistory;

      const updatedTracks = [...stateWithHistory.tracks];
      const updatedClips = [...sourceTrack.clips];
      updatedClips[clipIndex] = {
        ...clip,
        startFrame: Math.max(0, action.newStartFrame),
      };
      updatedTracks[sourceTrackIndex] = {
        ...sourceTrack,
        clips: updatedClips,
      };

      return { ...stateWithHistory, tracks: updatedTracks };
    }

    case 'RESIZE_CLIP': {
      const stateWithHistory = pushHistory(state, 'RESIZE_CLIP');

      const updatedTracks = stateWithHistory.tracks.map((track) => ({
        ...track,
        clips: track.clips.map((clip) =>
          clip.id === action.clipId
            ? {
                ...clip,
                startFrame: Math.max(0, action.newStartFrame),
                durationFrames: Math.max(1, action.newDurationFrames),
              }
            : clip,
        ),
      }));

      return { ...stateWithHistory, tracks: updatedTracks };
    }

    case 'DELETE_CLIPS': {
      const stateWithHistory = pushHistory(state, 'DELETE_CLIPS');
      const clipIdsSet = new Set(action.clipIds);

      const updatedTracks = stateWithHistory.tracks.map((track) => ({
        ...track,
        clips: track.clips.filter((clip) => !clipIdsSet.has(clip.id)),
      }));

      return {
        ...stateWithHistory,
        tracks: updatedTracks,
        selectedClipIds: new Set(),
      };
    }

    case 'DELETE_SELECTED': {
      if (state.selectedClipIds.size === 0) return state;

      const stateWithHistory = pushHistory(state, 'DELETE_SELECTED');

      const updatedTracks = stateWithHistory.tracks.map((track) => ({
        ...track,
        clips: track.clips.filter(
          (clip) => !stateWithHistory.selectedClipIds.has(clip.id),
        ),
      }));

      return {
        ...stateWithHistory,
        tracks: updatedTracks,
        selectedClipIds: new Set(),
      };
    }

    case 'ADD_CLIP': {
      const stateWithHistory = pushHistory(state, 'ADD_CLIP');
      const newClipId = generateClipId();

      const updatedTracks = stateWithHistory.tracks.map((track) =>
        track.id === action.trackId
          ? {
              ...track,
              clips: [...track.clips, { ...action.clip, id: newClipId }],
            }
          : track,
      );

      return { ...stateWithHistory, tracks: updatedTracks };
    }

    // In/Out point actions
    case 'SET_IN_POINT':
      return { ...state, inPoint: action.frame };

    case 'SET_OUT_POINT':
      return { ...state, outPoint: action.frame };

    // Track control actions
    case 'TOGGLE_TRACK_MUTE':
      return {
        ...state,
        tracks: state.tracks.map((track) =>
          track.id === action.trackId
            ? { ...track, isMuted: !track.isMuted }
            : track,
        ),
      };

    case 'TOGGLE_TRACK_SOLO':
      return {
        ...state,
        tracks: state.tracks.map((track) =>
          track.id === action.trackId
            ? { ...track, isSolo: !track.isSolo }
            : track,
        ),
      };

    case 'TOGGLE_TRACK_LOCK':
      return {
        ...state,
        tracks: state.tracks.map((track) =>
          track.id === action.trackId
            ? { ...track, isLocked: !track.isLocked }
            : track,
        ),
      };

    case 'TOGGLE_SNAP':
      return { ...state, snapEnabled: !state.snapEnabled };

    // Undo/Redo actions
    case 'UNDO': {
      // Cannot undo if no history or already at the beginning
      if (state.history.length === 0 || state.historyIndex < 0) return state;

      const prevEntry = state.history[state.historyIndex];
      if (!prevEntry) return state;

      return {
        ...state,
        tracks: JSON.parse(JSON.stringify(prevEntry.tracks)) as TimelineTrack[],
        playheadFrame: prevEntry.playheadFrame,
        historyIndex: state.historyIndex - 1,
        selectedClipIds: new Set(),
      };
    }

    case 'REDO': {
      if (state.historyIndex >= state.history.length - 1) return state;

      const nextEntry = state.history[state.historyIndex + 1];
      if (!nextEntry) return state;

      return {
        ...state,
        tracks: JSON.parse(JSON.stringify(nextEntry.tracks)) as TimelineTrack[],
        playheadFrame: nextEntry.playheadFrame,
        historyIndex: state.historyIndex + 1,
        selectedClipIds: new Set(),
      };
    }

    // Load timeline data
    case 'LOAD_TIMELINE':
      return {
        ...state,
        tracks: action.data.tracks,
        totalFrames: action.data.totalFrames,
        fps: action.data.fps,
        inPoint: action.data.inPoint,
        outPoint: action.data.outPoint,
        history: [],
        historyIndex: -1,
        selectedClipIds: new Set(),
      };

    // Drag state actions
    case 'START_DRAG':
      return {
        ...state,
        isDragging: true,
        draggedClipId: action.clipId,
        resizeEdge: action.resizeEdge ?? null,
      };

    case 'END_DRAG':
      return {
        ...state,
        isDragging: false,
        draggedClipId: null,
        resizeEdge: null,
      };

    // Clip editor actions
    case 'UPDATE_CLIP': {
      const stateWithHistory = pushHistory(state, 'UPDATE_CLIP');

      const updatedTracks = stateWithHistory.tracks.map((track) => ({
        ...track,
        clips: track.clips.map((clip) =>
          clip.id === action.clipId ? { ...clip, ...action.updates } : clip,
        ),
      }));

      return { ...stateWithHistory, tracks: updatedTracks };
    }

    case 'OPEN_CLIP_EDITOR':
      return { ...state, editingClipId: action.clipId };

    case 'CLOSE_CLIP_EDITOR':
      return { ...state, editingClipId: null };

    default:
      return state;
  }
}

// ============================================================================
// Initial State Factory
// ============================================================================

export function createInitialState(fps: number = 30): TimelineState {
  const tracks = DEFAULT_TRACKS.map((track, index) => ({
    ...track,
    id: `track-${track.type}-${index}`,
    clips: [],
  }));

  // Start with empty history - initial state is not part of undo stack
  // This ensures the first undo after a user action reverts to the state
  // before that action, not to an empty initial state
  return {
    tracks,
    playheadFrame: 0,
    isPlaying: false,
    totalFrames: fps * 60 * 5, // 5 minutes default
    fps,
    zoom: ZOOM_LEVELS.DEFAULT,
    scrollX: 0,
    scrollY: 0,
    selectedClipIds: new Set(),
    selectedTrackId: null,
    inPoint: null,
    outPoint: null,
    history: [],
    historyIndex: -1,
    snapEnabled: true,
    isDragging: false,
    draggedClipId: null,
    resizeEdge: null,
    editingClipId: null,
  };
}
