# FILM-601: Timeline Editor

## Metadata
- **Phase:** 6 - Edit Suite
- **Priority:** P1 (Post-MVP)
- **Effort:** XL (3-5 days)
- **Status:** ✅ Complete
- **Dependencies:** FILM-409 (Visual Studio), FILM-505 (Audio Studio), FILM-DS-03 (Interaction Patterns)
- **Blocks:** FILM-602 (Track Layer), FILM-603 (Clip Editor), FILM-604 (Auto-Stitch)

---

## Context

The Timeline Editor is the core component of the Edit Suite, allowing users to arrange video clips, dialogue, music, and sound effects on a multi-track timeline. This is a complex component requiring frame-accurate positioning, real-time preview, and intuitive drag-and-drop interactions.

---

## Specification

### Requirements

1. **Multi-track Timeline**: Support video, dialogue, music, SFX, and ambient tracks
2. **Playhead Scrubbing**: Frame-accurate seeking with keyboard and mouse
3. **Clip Manipulation**: Drag to move, resize from edges, snap to grid
4. **Zoom Control**: Zoom in/out with smooth transitions
5. **Real-time Preview**: Sync playback across all tracks
6. **Undo/Redo**: Full history for all editing operations
7. **Keyboard Shortcuts**: Professional editing shortcuts

### Component Architecture

```
TimelineEditor
├── TimelineHeader
│   ├── ZoomControls
│   ├── TimecodeDisplay
│   └── PlaybackControls
├── TimelineRuler
│   ├── TimeMarkers
│   └── PlayheadMarker
├── TrackContainer
│   ├── TrackLayer (video)
│   ├── TrackLayer (dialogue)
│   ├── TrackLayer (music)
│   ├── TrackLayer (sfx)
│   └── TrackLayer (ambient)
├── PlayheadLine
└── TimelineFooter
    └── DurationDisplay
```

### Interface Definitions

```typescript
// packages/features/episodes/src/components/timeline-editor/types.ts

export interface TimelineState {
  duration: number;           // Total duration in seconds
  currentTime: number;        // Playhead position in seconds
  zoom: number;               // Pixels per second (e.g., 50 = 50px/sec)
  scrollX: number;            // Horizontal scroll position
  isPlaying: boolean;
  inPoint: number | null;     // Loop start
  outPoint: number | null;    // Loop end
  selectedClipIds: Set<string>;
}

export interface Track {
  id: string;
  type: 'video' | 'dialogue' | 'music' | 'sfx' | 'ambient';
  name: string;
  clips: Clip[];
  isMuted: boolean;
  isLocked: boolean;
  volume: number;            // 0-1
}

export interface Clip {
  id: string;
  trackId: string;
  assetId?: string;          // Reference to asset
  name: string;
  startTime: number;         // Position on timeline (seconds)
  duration: number;          // Clip length (seconds)
  sourceStart?: number;      // Offset in source file
  sourceEnd?: number;
  thumbnailUrl?: string;
  waveformData?: number[];   // For audio tracks
}

export interface TimelineAction {
  type: 'MOVE_CLIP' | 'RESIZE_CLIP' | 'ADD_CLIP' | 'DELETE_CLIP' | 'SPLIT_CLIP';
  clipId: string;
  payload: unknown;
  previousState: unknown;    // For undo
}
```

### Component Implementation

```typescript
// packages/features/episodes/src/components/timeline-editor/timeline-editor.tsx

'use client';

import { useReducer, useRef, useCallback, useEffect } from 'react';
import { useHotkeys } from 'react-hotkeys-hook';
import { TimelineHeader } from './timeline-header';
import { TimelineRuler } from './timeline-ruler';
import { TrackLayer } from './track-layer';
import { Playhead } from './playhead';
import { timelineReducer, initialState } from './timeline-reducer';

interface TimelineEditorProps {
  episodeId: string;
  tracks: Track[];
  onSave: (tracks: Track[]) => Promise<void>;
}

export function TimelineEditor({ episodeId, tracks, onSave }: TimelineEditorProps) {
  const [state, dispatch] = useReducer(timelineReducer, {
    ...initialState,
    tracks,
  });

  const containerRef = useRef<HTMLDivElement>(null);
  const playbackRef = useRef<{ video: HTMLVideoElement | null }>({ video: null });

  // Calculate timeline width based on zoom and duration
  const timelineWidth = state.duration * state.zoom;

  // Keyboard shortcuts
  useHotkeys('space', (e) => {
    e.preventDefault();
    dispatch({ type: 'TOGGLE_PLAYBACK' });
  });

  useHotkeys('left', () => dispatch({ type: 'SEEK', time: state.currentTime - 1/30 }));
  useHotkeys('right', () => dispatch({ type: 'SEEK', time: state.currentTime + 1/30 }));
  useHotkeys('shift+left', () => dispatch({ type: 'SEEK', time: state.currentTime - 1 }));
  useHotkeys('shift+right', () => dispatch({ type: 'SEEK', time: state.currentTime + 1 }));
  useHotkeys('[', () => dispatch({ type: 'SET_IN_POINT', time: state.currentTime }));
  useHotkeys(']', () => dispatch({ type: 'SET_OUT_POINT', time: state.currentTime }));
  useHotkeys('home', () => dispatch({ type: 'SEEK', time: 0 }));
  useHotkeys('end', () => dispatch({ type: 'SEEK', time: state.duration }));
  useHotkeys('mod+z', () => dispatch({ type: 'UNDO' }));
  useHotkeys('mod+shift+z', () => dispatch({ type: 'REDO' }));
  useHotkeys('delete', () => dispatch({ type: 'DELETE_SELECTED' }));
  useHotkeys('=', () => dispatch({ type: 'ZOOM_IN' }));
  useHotkeys('-', () => dispatch({ type: 'ZOOM_OUT' }));

  // Playback sync
  useEffect(() => {
    if (!state.isPlaying) return;

    const interval = setInterval(() => {
      dispatch({ type: 'TICK' });
    }, 1000 / 30); // 30fps update

    return () => clearInterval(interval);
  }, [state.isPlaying]);

  // Handle clip drag
  const handleClipMove = useCallback((clipId: string, newStartTime: number) => {
    dispatch({
      type: 'MOVE_CLIP',
      clipId,
      startTime: snapToGrid(newStartTime, state.snapEnabled),
    });
  }, [state.snapEnabled]);

  // Handle clip resize
  const handleClipResize = useCallback((
    clipId: string,
    edge: 'left' | 'right',
    delta: number
  ) => {
    dispatch({
      type: 'RESIZE_CLIP',
      clipId,
      edge,
      delta: snapToGrid(delta, state.snapEnabled),
    });
  }, [state.snapEnabled]);

  return (
    <div
      ref={containerRef}
      className="flex flex-col h-full bg-background border rounded-lg overflow-hidden"
      role="application"
      aria-label="Timeline editor"
    >
      {/* Header with controls */}
      <TimelineHeader
        currentTime={state.currentTime}
        duration={state.duration}
        isPlaying={state.isPlaying}
        zoom={state.zoom}
        onPlay={() => dispatch({ type: 'PLAY' })}
        onPause={() => dispatch({ type: 'PAUSE' })}
        onSeek={(time) => dispatch({ type: 'SEEK', time })}
        onZoomChange={(zoom) => dispatch({ type: 'SET_ZOOM', zoom })}
      />

      {/* Timeline area */}
      <div className="flex-1 overflow-auto relative">
        {/* Time ruler */}
        <TimelineRuler
          duration={state.duration}
          zoom={state.zoom}
          currentTime={state.currentTime}
        />

        {/* Tracks */}
        <div className="relative" style={{ width: timelineWidth }}>
          {state.tracks.map((track) => (
            <TrackLayer
              key={track.id}
              track={track}
              zoom={state.zoom}
              selectedClipIds={state.selectedClipIds}
              onClipSelect={(clipId) => dispatch({ type: 'SELECT_CLIP', clipId })}
              onClipMove={handleClipMove}
              onClipResize={handleClipResize}
              onClipDoubleClick={(clipId) => dispatch({ type: 'OPEN_CLIP_EDITOR', clipId })}
            />
          ))}

          {/* Playhead */}
          <Playhead
            currentTime={state.currentTime}
            zoom={state.zoom}
            height="100%"
            onDrag={(time) => dispatch({ type: 'SEEK', time })}
          />
        </div>
      </div>
    </div>
  );
}

// Snap to grid helper
function snapToGrid(time: number, enabled: boolean): number {
  if (!enabled) return time;
  const gridSize = 1 / 30; // Snap to frames at 30fps
  return Math.round(time / gridSize) * gridSize;
}
```

### State Reducer

```typescript
// packages/features/episodes/src/components/timeline-editor/timeline-reducer.ts

type TimelineAction =
  | { type: 'PLAY' }
  | { type: 'PAUSE' }
  | { type: 'TOGGLE_PLAYBACK' }
  | { type: 'SEEK'; time: number }
  | { type: 'TICK' }
  | { type: 'SET_ZOOM'; zoom: number }
  | { type: 'ZOOM_IN' }
  | { type: 'ZOOM_OUT' }
  | { type: 'SET_IN_POINT'; time: number }
  | { type: 'SET_OUT_POINT'; time: number }
  | { type: 'SELECT_CLIP'; clipId: string; additive?: boolean }
  | { type: 'DESELECT_ALL' }
  | { type: 'MOVE_CLIP'; clipId: string; startTime: number }
  | { type: 'RESIZE_CLIP'; clipId: string; edge: 'left' | 'right'; delta: number }
  | { type: 'DELETE_SELECTED' }
  | { type: 'UNDO' }
  | { type: 'REDO' };

export function timelineReducer(state: TimelineState, action: TimelineAction): TimelineState {
  switch (action.type) {
    case 'PLAY':
      return { ...state, isPlaying: true };

    case 'PAUSE':
      return { ...state, isPlaying: false };

    case 'TOGGLE_PLAYBACK':
      return { ...state, isPlaying: !state.isPlaying };

    case 'SEEK':
      return {
        ...state,
        currentTime: Math.max(0, Math.min(action.time, state.duration)),
      };

    case 'TICK':
      const nextTime = state.currentTime + 1/30;
      if (state.outPoint && nextTime >= state.outPoint) {
        return { ...state, currentTime: state.inPoint || 0 };
      }
      if (nextTime >= state.duration) {
        return { ...state, currentTime: 0, isPlaying: false };
      }
      return { ...state, currentTime: nextTime };

    case 'ZOOM_IN':
      return { ...state, zoom: Math.min(state.zoom * 1.5, 500) };

    case 'ZOOM_OUT':
      return { ...state, zoom: Math.max(state.zoom / 1.5, 10) };

    case 'SET_ZOOM':
      return { ...state, zoom: action.zoom };

    case 'SELECT_CLIP':
      const newSelected = action.additive
        ? new Set([...state.selectedClipIds, action.clipId])
        : new Set([action.clipId]);
      return { ...state, selectedClipIds: newSelected };

    case 'MOVE_CLIP':
      return {
        ...state,
        tracks: state.tracks.map(track => ({
          ...track,
          clips: track.clips.map(clip =>
            clip.id === action.clipId
              ? { ...clip, startTime: action.startTime }
              : clip
          ),
        })),
        history: [...state.history, createHistoryEntry(state, action)],
      };

    // ... more cases

    default:
      return state;
  }
}
```

### File Changes

| Action | Path |
|--------|------|
| CREATE | `packages/features/episodes/src/components/timeline-editor/types.ts` |
| CREATE | `packages/features/episodes/src/components/timeline-editor/timeline-reducer.ts` |
| CREATE | `packages/features/episodes/src/components/timeline-editor/timeline-context.tsx` |
| CREATE | `packages/features/episodes/src/components/timeline-editor/timeline-editor.tsx` |
| CREATE | `packages/features/episodes/src/components/timeline-editor/preview-player.tsx` |
| CREATE | `packages/features/episodes/src/components/timeline-editor/timeline-header.tsx` |
| CREATE | `packages/features/episodes/src/components/timeline-editor/timeline-ruler.tsx` |
| CREATE | `packages/features/episodes/src/components/timeline-editor/playhead.tsx` |
| CREATE | `packages/features/episodes/src/components/timeline-editor/track-layer.tsx` |
| CREATE | `packages/features/episodes/src/components/timeline-editor/clip-item.tsx` |
| CREATE | `packages/features/episodes/src/components/timeline-editor/waveform-display.tsx` |
| CREATE | `packages/features/episodes/src/components/timeline-editor/index.ts` |
| MODIFY | `packages/features/episodes/src/components/index.ts` |
| MODIFY | `packages/features/episodes/package.json` |

---

## Acceptance Criteria

- [x] Timeline displays all tracks with clips
- [x] Playhead scrubs with mouse and keyboard
- [x] Clips can be dragged to reposition
- [x] Clips can be resized from edges
- [x] Snap-to-grid works for alignment (10px threshold, frame-based)
- [x] Zoom in/out changes time scale (10-500 px/sec)
- [x] Space bar toggles play/pause
- [x] Undo/redo works for all operations
- [x] Selection highlights clips visually
- [x] Multi-select with Shift+Click
- [x] Video preview syncs with playhead during playback and scrubbing

---

## Test Plan

### Unit Tests
- [ ] Test timeline reducer for all action types
- [ ] Test snap-to-grid calculation
- [ ] Test clip overlap detection

### Integration Tests
- [ ] Test drag-and-drop with mouse events
- [ ] Test keyboard navigation
- [ ] Test undo/redo stack

### E2E Tests
- [ ] Test full editing workflow

---

## Performance Considerations

- Virtualize clips outside viewport
- Throttle playhead updates during drag
- Debounce save operations
- Use Web Workers for waveform rendering

---

## Open Questions

- [ ] Should we support multiple clip selection? **Yes**
- [ ] Should we add markers/bookmarks? (post-MVP)
