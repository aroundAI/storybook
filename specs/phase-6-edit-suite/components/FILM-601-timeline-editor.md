---
spec_id: FILM-601
status: 🟡 PARTIAL
audited: 2026-09-23
---

# FILM-601: Timeline Editor

## Metadata
- **Phase:** 6 - Edit Suite
- **Priority:** P1 (Post-MVP)
- **Effort:** XL (3-5 days)
- **Status:** 🟡 PARTIAL (audit 2026-09-23; was ✅ Complete)
- **Dependencies:** FILM-409 (Visual Studio), FILM-505 (Audio Studio), FILM-DS-03 (Interaction Patterns)
- **Blocks:** FILM-602 (Track Layer), FILM-603 (Clip Editor), FILM-604 (Auto-Stitch)

---

## Context

The Timeline Editor is the core component of the Edit Suite, allowing users to arrange video clips, dialogue, music, and sound effects on a multi-track timeline. This is a complex component requiring frame-accurate positioning, real-time preview, and intuitive drag-and-drop interactions.

---

## Specification

### Requirements

1. **Multi-track Timeline**: Support video, dialogue, music, SFX, and ambient tracks
2. **Playhead Scrubbing**: Frame-accurate seeking with keyboard and mouse (30fps default)
3. **Clip Manipulation**: Drag to move, resize from edges, snap to grid
4. **Zoom Control**: Zoom in/out with smooth transitions (10-500 px/sec)
5. **Real-time Preview**: Sync playback across all tracks with video preview pane
6. **Undo/Redo**: Full history for all editing operations (max 50 entries)
7. **Keyboard Shortcuts**: Professional editing shortcuts via `useTimelineKeyboard` hook

### Component Architecture

```
TimelineEditor
├── PreviewPlayer (video preview synced with playhead)
├── TimelineHeader
│   ├── PlaybackControls (play/pause, skip)
│   ├── TimecodeDisplay (MM:SS:FF format)
│   ├── ZoomControls (slider + buttons)
│   ├── SnapToggle
│   └── UndoRedo buttons
├── TrackLabels (mute/solo/lock toggles)
├── TimelineRuler
│   ├── TimeMarkers (zoom-responsive)
│   └── InPoint/OutPoint markers
├── TrackContainer
│   ├── TrackLayer (video)
│   ├── TrackLayer (dialogue)
│   ├── TrackLayer (music)
│   ├── TrackLayer (sfx)
│   └── TrackLayer (ambient)
│       └── ClipItem (with WaveformDisplay for audio)
├── Playhead (draggable)
└── TimelineFooter
    └── DurationDisplay
```

### Interface Definitions (Implemented)

```typescript
// packages/features/episodes/src/components/timeline-editor/types.ts

export type ClipType = 'video' | 'dialogue' | 'music' | 'sfx' | 'ambient';

export interface TimelineClip {
  id: string;
  trackType: ClipType;
  name: string;
  startFrame: number;        // Frame-based positioning (not seconds)
  durationFrames: number;    // Frame-based duration
  thumbnailUrl?: string;
  videoUrl?: string;
  waveformData?: number[];
  shotId?: string;
}

export interface TimelineTrack {
  id: string;
  type: ClipType;
  name: string;
  clips: TimelineClip[];
  isMuted: boolean;
  isSolo: boolean;
  isLocked: boolean;
  height: number;
}

export interface TimelineState {
  tracks: TimelineTrack[];
  playheadFrame: number;     // Frame-based (not seconds)
  isPlaying: boolean;
  totalFrames: number;
  fps: number;
  zoom: number;              // Pixels per second
  scrollX: number;
  scrollY: number;
  selectedClipIds: Set<string>;
  selectedTrackId: string | null;
  inPoint: number | null;    // Frame number
  outPoint: number | null;   // Frame number
  history: TimelineHistoryEntry[];
  historyIndex: number;      // -1 when no history
  snapEnabled: boolean;
  isDragging: boolean;
  draggedClipId: string | null;
  resizeEdge: 'left' | 'right' | null;
}

export interface TimelineData {
  tracks: TimelineTrack[];
  totalFrames: number;
  fps: number;
  inPoint: number | null;
  outPoint: number | null;
  version: number;
}

// 21 action types implemented
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
  | { type: 'MOVE_CLIP'; clipId: string; newStartFrame: number; newTrackId?: string }
  | { type: 'RESIZE_CLIP'; clipId: string; newStartFrame: number; newDurationFrames: number }
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

export const ZOOM_LEVELS = {
  MIN: 10,
  MAX: 500,
  DEFAULT: 50,
  STEPS: [10, 25, 50, 100, 200, 500],
} as const;

export const DEFAULT_TRACKS: Omit<TimelineTrack, 'id' | 'clips'>[] = [
  { type: 'video', name: 'Video', isMuted: false, isSolo: false, isLocked: false, height: 80 },
  { type: 'dialogue', name: 'Dialogue', isMuted: false, isSolo: false, isLocked: false, height: 60 },
  { type: 'music', name: 'Music', isMuted: false, isSolo: false, isLocked: false, height: 60 },
  { type: 'sfx', name: 'SFX', isMuted: false, isSolo: false, isLocked: false, height: 60 },
  { type: 'ambient', name: 'Ambient', isMuted: false, isSolo: false, isLocked: false, height: 60 },
];
```

### File Changes (Implemented)

| Action | Path | LOC |
|--------|------|-----|
| CREATE | `packages/features/episodes/src/components/timeline-editor/types.ts` | ~280 |
| CREATE | `packages/features/episodes/src/components/timeline-editor/timeline-reducer.ts` | ~435 |
| CREATE | `packages/features/episodes/src/components/timeline-editor/timeline-context.tsx` | ~55 |
| CREATE | `packages/features/episodes/src/components/timeline-editor/timeline-editor.tsx` | ~325 |
| CREATE | `packages/features/episodes/src/components/timeline-editor/preview-player.tsx` | ~185 |
| CREATE | `packages/features/episodes/src/components/timeline-editor/timeline-header.tsx` | ~210 |
| CREATE | `packages/features/episodes/src/components/timeline-editor/timeline-ruler.tsx` | ~175 |
| CREATE | `packages/features/episodes/src/components/timeline-editor/playhead.tsx` | ~130 |
| CREATE | `packages/features/episodes/src/components/timeline-editor/track-layer.tsx` | ~75 |
| CREATE | `packages/features/episodes/src/components/timeline-editor/clip-item.tsx` | ~340 |
| CREATE | `packages/features/episodes/src/components/timeline-editor/waveform-display.tsx` | ~90 |
| CREATE | `packages/features/episodes/src/components/timeline-editor/index.ts` | ~25 |
| MODIFY | `packages/features/episodes/src/components/index.ts` | +10 |
| MODIFY | `packages/features/episodes/package.json` | +1 (added @kit/film-studio dependency) |

**Total:** ~2,335 lines of code

---

## Implementation Details

### Key Technical Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Time units | Frame-based (not seconds) | More accurate for video editing at 30fps |
| State management | useReducer + Context | Complex state with undo/redo history |
| Keyboard shortcuts | `useTimelineKeyboard` from @kit/film-studio | Reuse existing hook with full shortcut support |
| Drag/resize | Custom with refs for stale closure prevention | Smooth dragging with latest state values |
| Video sync | Track seeking state to prevent race conditions | Queue seeks during active seek operations |
| Waveform rendering | Canvas API | Better performance for dense audio data |
| Design tokens | `timelineTrackTokens` from @kit/film-studio | Consistent track colors across components |
| Snapping | `snapToGrid` from @kit/film-studio | 10px threshold, frame-based snapping |

### Dependencies Used

From `@kit/film-studio`:
- `useTimelineKeyboard` hook - keyboard shortcuts
- `timelineTrackTokens` - track colors (video: blue, dialogue: green, music: purple, sfx: amber, ambient: slate)
- `SNAP_THRESHOLD_PX` constant (10px)
- `snapToGrid` utility function
- `TrackType` type

From `@kit/ui`:
- Button, Card, Slider, ScrollArea components
- `cn` utility for className merging

### Bug Fixes Applied

1. **Type export error** - Fixed ZOOM_LEVELS and DEFAULT_TRACKS being incorrectly exported as types
2. **History management** - Fixed initial state in undo stack causing first undo to revert to empty state
3. **Stale closure** - Added refs to access latest values in document event handlers during drag
4. **Race condition** - Track seeking state to prevent video stuttering during fast scrubbing
5. **Memory leak** - Added useEffect cleanup for document event listeners on component unmount
6. **useEffect justification** - Added comments explaining why each useEffect is necessary

---

## Acceptance Criteria

- [x] Timeline displays all 5 track types with clips — *audit:* `packages/features/edit-suite/src/components/timeline/timeline.tsx:258`, per-type colours `packages/features/edit-suite/src/components/timeline/track-row.tsx:30` (phase 14 edit suite; the FILM-601 components went in 5f44d0e1)
- [x] Playhead scrubs with mouse and keyboard — *audit:* `packages/features/edit-suite/src/components/timeline/playhead.tsx:55` (drag), `packages/features/edit-suite/src/components/edit-suite-provider.tsx:431` (arrow keys step a frame)
- [x] Clips can be dragged to reposition — *audit:* `packages/features/edit-suite/src/components/timeline/clip-block.tsx:248`
- [x] Clips can be resized from edges — *audit:* `packages/features/edit-suite/src/components/timeline/clip-block.tsx:273` (left edge), line 297 (right edge)
- [ ] Snap-to-grid works for alignment (10px threshold, frame-based) — *audit: no longer true* — snaps only to clip edges and playhead, no frame grid, ignores the Snap toggle (`packages/features/edit-suite/src/components/timeline/clip-block.tsx:172`); old grid went in 5f44d0e1
- [x] Zoom in/out changes time scale (10-500 px/sec) — *audit:* `packages/features/edit-suite/src/state/edit-reducer.ts:50`
- [x] Space bar toggles play/pause — *audit:* `packages/features/edit-suite/src/components/edit-suite-provider.tsx:423`
- [ ] Undo/redo works for all operations (history starts empty, max 50 entries) — *audit: no longer true* — keyframe, transition, drop, I/O, speed and track edits bypass `UndoManager` (e.g. `packages/features/edit-suite/src/components/timeline/track-row.tsx:234`); stack is 100; old reducer went in 5f44d0e1
- [x] Selection highlights clips visually (ring-2 ring-white) — *audit:* violet border and glow instead of `ring-white`, `packages/features/edit-suite/src/components/timeline/clip-block.tsx:420`
- [x] Multi-select with Shift+Click — *audit:* `packages/features/edit-suite/src/components/timeline/clip-block.tsx:141`
- [ ] Video preview syncs with playhead during playback and scrubbing — *audit: unverified* — runtime sync; needs a playback run, and no edit-suite test exists
- [ ] Track mute/solo/lock toggles functional — *audit: no longer true* — mute/solo reach audio gain (`packages/features/edit-suite/src/lib/audio-engine.ts:140`); lock only blocks drops (`packages/features/edit-suite/src/components/timeline/track-row.tsx:210`), clips stay editable
- [ ] ~~In/out point markers for loop playback~~ — *audit: retired* — the phase 14 edit suite uses I/O to trim the selected clip (`packages/features/edit-suite/src/components/edit-suite-provider.tsx:451`); no loop playback
- [x] Timecode display in MM:SS:FF format — *audit:* `packages/features/edit-suite/src/components/preview/preview-panel.tsx:29`

---

## Test Plan

### Unit Tests
- [ ] Test timeline reducer for all 21 action types — *audit: not met* — no test found (the edit suite has none)
- [ ] Test snap-to-grid calculation with frame-based snapping — *audit: not met* — no test found
- [ ] Test history management (push, undo, redo, max size) — *audit: not met* — no test found
- [ ] Test formatTimecode helper function — *audit: not met* — no test found

### Integration Tests
- [ ] Test drag-and-drop with mouse events and stale closure prevention — *audit: not met* — no test found
- [ ] Test keyboard navigation via useTimelineKeyboard — *audit: not met* — no test found; the hook went in 5f44d0e1 and edit-suite shortcuts are untested
- [ ] Test undo/redo stack with correct history indexing — *audit: not met* — no test found
- [ ] Test video sync with seek state tracking — *audit: not met* — no test found

### E2E Tests
- [ ] Test full editing workflow — *audit: not met* — no test found

---

## Performance Considerations

- [x] Use requestAnimationFrame for playback (not setInterval) — *audit:* `packages/features/edit-suite/src/lib/playback-engine.ts:247`
- [x] Canvas-based waveform rendering for performance — *audit:* `packages/features/edit-suite/src/components/timeline/waveform.tsx:114`
- [x] Refs for latest values to avoid stale closures — *audit:* `packages/features/edit-suite/src/components/timeline/clip-block.tsx:106`
- [x] Seek state tracking to prevent overlapping video seeks — *audit:* re-seeks only past a 50 ms tolerance, `packages/features/edit-suite/src/components/preview/preview-canvas.tsx:175`
- [x] Virtualize clips outside viewport (future optimization) — *audit:* `packages/features/edit-suite/src/hooks/use-visible-clips.ts:35`, used at `packages/features/edit-suite/src/components/timeline/timeline.tsx:71`
- [x] Debounce save operations (future optimization) — *audit:* 2 s debounce, `packages/features/edit-suite/src/components/edit-suite-provider.tsx:343`

---

## Open Questions

- [x] Should we support multiple clip selection? **Yes - implemented with Shift+Click**
- [x] Should we include video preview? **Yes - PreviewPlayer component added**
- [ ] Should we add markers/bookmarks? (post-MVP)
- [ ] Should we add clip splitting? (post-MVP)

---

## Related PRs

- PR #79: Initial implementation
- Commit ff533c9: feat(episodes): implement timeline editor component (FILM-601)
- Commit 8a5b533: fix(episodes): address code review issues for timeline editor

## Remaining (audit 2026-09-23)

| Criterion | Why it is open | Closed by |
|---|---|---|
| Snap-to-grid (frame-based) | Snapping targets only clip edges and the playhead, never a frame grid, and ignores the Snap toggle (`packages/features/edit-suite/src/components/timeline/clip-block.tsx:172`); PHASE-14 §3.5 claims both | unassigned |
| Undo/redo for all operations | Keyframe, transition, media-bin drop, I/O trim, speed and track edits dispatch directly and bypass `UndoManager` (e.g. `packages/features/edit-suite/src/components/inspector/keyframe-editor.tsx:170`) | unassigned |
| Track lock | Lock blocks only asset drops (`packages/features/edit-suite/src/components/timeline/track-row.tsx:210`); `ClipBlock` is never told, so clips on a locked track move, trim and delete | unassigned |
