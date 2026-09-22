---
spec_id: FILM-602
status: 🟡 PARTIAL
audited: 2026-09-23
---

# FILM-602: Track Layer

## Metadata
- **Phase:** 6 - Edit Suite
- **Priority:** P1 (Post-MVP)
- **Effort:** L (1-3 days)
- **Status:** 🟡 PARTIAL (audit 2026-09-23; was ✅ DONE (implemented with FILM-601))
- **Dependencies:** FILM-601 (Timeline Editor) ✅, FILM-DS-02 (Design Tokens)
- **Blocks:** FILM-604 (Auto-Stitch)

> **Note:** Core TrackLayer and ClipItem components were implemented as part of FILM-601.
> Files: `packages/features/episodes/src/components/timeline-editor/track-layer.tsx`, `clip-item.tsx`

---

## Context

Each track in the timeline represents a layer of content (video, dialogue, music, etc.). The Track Layer component handles clip rendering, selection, and manipulation within a single track.

---

## Specification

### Requirements

1. **Track Header**: Label, mute/solo/lock controls, volume slider
2. **Clip Rendering**: Display clips with thumbnails/waveforms
3. **Selection**: Single and multi-select clips
4. **Drag & Drop**: Move clips, receive dropped assets
5. **Visual Feedback**: Hover, selected, dragging states

### Component Interface

```typescript
interface TrackLayerProps {
  track: Track;
  zoom: number;                    // Pixels per second
  selectedClipIds: Set<string>;
  isPlaying: boolean;
  currentTime: number;
  onClipSelect: (clipId: string, additive?: boolean) => void;
  onClipMove: (clipId: string, newStartTime: number) => void;
  onClipResize: (clipId: string, edge: 'left' | 'right', delta: number) => void;
  onClipDelete: (clipId: string) => void;
  onClipDoubleClick: (clipId: string) => void;
  onTrackMuteToggle: () => void;
  onTrackLockToggle: () => void;
  onVolumeChange: (volume: number) => void;
}
```

### Visual Design

```
┌─────────────┬──────────────────────────────────────────────────────────────┐
│ Track Header│  Clips Area                                                   │
│             │                                                              │
│ [Video] 🔊🔒│ ┌────────┐    ┌──────────────────┐     ┌───────┐           │
│             │ │ Clip 1 │    │    Clip 2        │     │Clip 3 │           │
│  ────────   │ │ [thumb]│    │   [thumbnail]    │     │[thumb]│           │
│  Volume     │ └────────┘    └──────────────────┘     └───────┘           │
│             │                                                              │
└─────────────┴──────────────────────────────────────────────────────────────┘
```

### Implementation

```typescript
// packages/features/episodes/src/components/timeline-editor/track-layer.tsx

'use client';

import { useCallback, useRef, useState } from 'react';
import { useDrag, useDrop } from 'react-dnd';
import { Volume2, VolumeX, Lock, Unlock } from 'lucide-react';
import { Button } from '@kit/ui/button';
import { Slider } from '@kit/ui/slider';
import { timelineTrackTokens } from '@kit/film-studio/design-tokens';
import { ClipItem } from './clip-item';

export function TrackLayer({
  track,
  zoom,
  selectedClipIds,
  onClipSelect,
  onClipMove,
  onClipResize,
  onClipDoubleClick,
  onTrackMuteToggle,
  onTrackLockToggle,
  onVolumeChange,
}: TrackLayerProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const tokens = timelineTrackTokens[track.type];

  // Drop zone for new assets
  const [{ isOver, canDrop }, dropRef] = useDrop({
    accept: ['asset', 'shot'],
    canDrop: (item) => !track.isLocked,
    drop: (item: { id: string; type: string }, monitor) => {
      const offset = monitor.getClientOffset();
      if (offset && trackRef.current) {
        const rect = trackRef.current.getBoundingClientRect();
        const x = offset.x - rect.left;
        const time = x / zoom;
        // Handle asset drop at calculated time
        onAssetDrop?.(item.id, time);
      }
    },
    collect: (monitor) => ({
      isOver: monitor.isOver(),
      canDrop: monitor.canDrop(),
    }),
  });

  return (
    <div
      className={`flex border-b ${track.isLocked ? 'opacity-60' : ''}`}
      role="list"
      aria-label={`${track.name} track`}
    >
      {/* Track Header */}
      <div className="w-48 flex-shrink-0 p-2 border-r bg-muted/50 flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <span className={`text-sm font-medium ${tokens.text}`}>
            {track.name}
          </span>
          <div className="flex gap-1">
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={onTrackMuteToggle}
              aria-label={track.isMuted ? 'Unmute track' : 'Mute track'}
            >
              {track.isMuted ? (
                <VolumeX className="h-3 w-3" />
              ) : (
                <Volume2 className="h-3 w-3" />
              )}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={onTrackLockToggle}
              aria-label={track.isLocked ? 'Unlock track' : 'Lock track'}
            >
              {track.isLocked ? (
                <Lock className="h-3 w-3" />
              ) : (
                <Unlock className="h-3 w-3" />
              )}
            </Button>
          </div>
        </div>

        {/* Volume slider */}
        {track.type !== 'video' && (
          <Slider
            value={[track.volume * 100]}
            max={100}
            step={1}
            onValueChange={([v]) => onVolumeChange(v / 100)}
            disabled={track.isLocked || track.isMuted}
            aria-label="Track volume"
          />
        )}
      </div>

      {/* Clips Area */}
      <div
        ref={(el) => {
          trackRef.current = el;
          dropRef(el);
        }}
        className={`flex-1 relative h-20 ${
          isOver && canDrop ? 'bg-primary/10' : ''
        }`}
      >
        {track.clips.map((clip) => (
          <ClipItem
            key={clip.id}
            clip={clip}
            trackType={track.type}
            zoom={zoom}
            isSelected={selectedClipIds.has(clip.id)}
            isLocked={track.isLocked}
            onSelect={(additive) => onClipSelect(clip.id, additive)}
            onMove={(newTime) => onClipMove(clip.id, newTime)}
            onResize={(edge, delta) => onClipResize(clip.id, edge, delta)}
            onDoubleClick={() => onClipDoubleClick(clip.id)}
          />
        ))}
      </div>
    </div>
  );
}
```

### Clip Item Component

```typescript
// packages/features/episodes/src/components/timeline-editor/clip-item.tsx

'use client';

import { useRef, useState } from 'react';
import { useDrag } from 'react-dnd';
import { timelineTrackTokens } from '@kit/film-studio/design-tokens';

interface ClipItemProps {
  clip: Clip;
  trackType: TrackType;
  zoom: number;
  isSelected: boolean;
  isLocked: boolean;
  onSelect: (additive: boolean) => void;
  onMove: (newTime: number) => void;
  onResize: (edge: 'left' | 'right', delta: number) => void;
  onDoubleClick: () => void;
}

export function ClipItem({
  clip,
  trackType,
  zoom,
  isSelected,
  isLocked,
  onSelect,
  onMove,
  onResize,
  onDoubleClick,
}: ClipItemProps) {
  const clipRef = useRef<HTMLDivElement>(null);
  const [resizing, setResizing] = useState<'left' | 'right' | null>(null);
  const tokens = timelineTrackTokens[trackType];

  // Calculate position and width
  const left = clip.startTime * zoom;
  const width = clip.duration * zoom;

  // Drag for moving
  const [{ isDragging }, dragRef] = useDrag({
    type: 'clip',
    item: { id: clip.id, originalTime: clip.startTime },
    canDrag: !isLocked,
    collect: (monitor) => ({
      isDragging: monitor.isDragging(),
    }),
    end: (item, monitor) => {
      if (monitor.didDrop()) {
        const delta = monitor.getDifferenceFromInitialOffset();
        if (delta) {
          const newTime = item.originalTime + delta.x / zoom;
          onMove(Math.max(0, newTime));
        }
      }
    },
  });

  // Handle resize drag
  const handleResizeStart = (edge: 'left' | 'right', e: React.MouseEvent) => {
    e.stopPropagation();
    if (isLocked) return;

    setResizing(edge);
    const startX = e.clientX;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const delta = (moveEvent.clientX - startX) / zoom;
      onResize(edge, delta);
    };

    const handleMouseUp = () => {
      setResizing(null);
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  };

  return (
    <div
      ref={(el) => {
        clipRef.current = el;
        dragRef(el);
      }}
      className={`absolute top-1 bottom-1 rounded ${tokens.bg} ${tokens.border} border
        ${isSelected ? 'ring-2 ring-white ring-offset-1' : ''}
        ${isDragging ? 'opacity-50 z-50' : ''}
        ${isLocked ? 'cursor-not-allowed' : 'cursor-grab active:cursor-grabbing'}
      `}
      style={{
        left: `${left}px`,
        width: `${width}px`,
        minWidth: '20px',
      }}
      onClick={(e) => onSelect(e.shiftKey)}
      onDoubleClick={onDoubleClick}
      role="listitem"
      aria-label={`${clip.name}, starts at ${formatTime(clip.startTime)}, duration ${formatTime(clip.duration)}`}
      aria-selected={isSelected}
      tabIndex={0}
    >
      {/* Content based on track type */}
      {trackType === 'video' && clip.thumbnailUrl && (
        <img
          src={clip.thumbnailUrl}
          alt=""
          className="h-full w-full object-cover rounded"
        />
      )}

      {['dialogue', 'music', 'sfx', 'ambient'].includes(trackType) && clip.waveformData && (
        <WaveformDisplay data={clip.waveformData} />
      )}

      {/* Clip name */}
      <div className="absolute inset-x-0 bottom-0 px-1 py-0.5 bg-black/50 text-xs text-white truncate">
        {clip.name}
      </div>

      {/* Resize handles */}
      {!isLocked && (
        <>
          <div
            className="absolute left-0 top-0 bottom-0 w-2 cursor-ew-resize hover:bg-white/30"
            onMouseDown={(e) => handleResizeStart('left', e)}
            aria-label="Resize clip start"
          />
          <div
            className="absolute right-0 top-0 bottom-0 w-2 cursor-ew-resize hover:bg-white/30"
            onMouseDown={(e) => handleResizeStart('right', e)}
            aria-label="Resize clip end"
          />
        </>
      )}
    </div>
  );
}

function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  const frames = Math.floor((seconds % 1) * 30);
  return `${mins}:${secs.toString().padStart(2, '0')}:${frames.toString().padStart(2, '0')}`;
}
```

### File Changes

| Action | Path |
|--------|------|
| CREATE | `packages/features/episodes/src/components/timeline-editor/track-layer.tsx` |
| CREATE | `packages/features/episodes/src/components/timeline-editor/clip-item.tsx` |
| CREATE | `packages/features/episodes/src/components/timeline-editor/waveform-display.tsx` |

---

## Acceptance Criteria

- [x] Track header displays name and controls — *audit:* `packages/features/edit-suite/src/components/timeline/track-row.tsx:88` (phase 14 edit suite; the FILM-602 `track-layer.tsx` went in 5f44d0e1)
- [ ] Mute/solo/lock buttons work — *audit: not met* — mute/solo reach audio gain (`packages/features/edit-suite/src/lib/audio-engine.ts:140`); lock refuses only asset drops (`packages/features/edit-suite/src/components/timeline/track-row.tsx:210`)
- [x] Volume slider adjusts track volume — *audit:* `packages/features/edit-suite/src/components/timeline/track-row.tsx:130` → track gain `packages/features/edit-suite/src/lib/audio-engine.ts:137`
- [x] Clips render at correct position/width — *audit:* `packages/features/edit-suite/src/components/timeline/clip-block.tsx:111`
- [x] Clips show thumbnail or waveform — *audit:* `packages/features/edit-suite/src/components/timeline/clip-block.tsx:449` (thumbnails), line 460 (waveform)
- [x] Click selects clip — *audit:* `packages/features/edit-suite/src/components/timeline/clip-block.tsx:137`
- [x] Shift+Click adds to selection — *audit:* `packages/features/edit-suite/src/components/timeline/clip-block.tsx:141`
- [ ] ~~Double-click opens clip editor~~ — *audit: retired* — phase 14 replaced the clip editor with an Inspector panel shown on selection (`packages/features/edit-suite/src/components/inspector/inspector-panel.tsx:35`), still placeholders (see PHASE-14)
- [x] Drag moves clip horizontally — *audit:* `packages/features/edit-suite/src/components/timeline/clip-block.tsx:248`
- [x] Resize handles adjust clip edges — *audit:* `packages/features/edit-suite/src/components/timeline/clip-block.tsx:273` (left), line 297 (right)
- [ ] Locked tracks prevent editing — *audit: not met* — `ClipBlock` gets no lock state (`packages/features/edit-suite/src/components/timeline/track-row.tsx:303`), so locked clips still move, trim and delete
- [x] Drop zone accepts assets — *audit:* `packages/features/edit-suite/src/components/timeline/track-row.tsx:217` (drop → `ADD_CLIP`, line 234)

---

## Test Plan

### Unit Tests
- [ ] Test clip positioning calculations — *audit: not met* — no test found (the edit suite has none)
- [ ] Test mute/lock state changes — *audit: not met* — no test found (the edit suite has none)
- [ ] Test volume range validation — *audit: not met* — no test found (the edit suite has none)

### Integration Tests
- [ ] Test drag-and-drop interactions — *audit: not met* — no test found (the edit suite has none)
- [ ] Test resize handle dragging — *audit: not met* — no test found (the edit suite has none)
- [ ] Test asset drop handling — *audit: not met* — no test found (the edit suite has none)

---

## Accessibility

- Track has `role="list"` with clips as `role="listitem"`
- Clips are keyboard focusable
- Screen reader announces clip name, position, duration
- Resize handles have descriptive labels

---

## Open Questions

- [ ] Should we support clip splitting? (post-MVP)
- [ ] Should we show gain/envelope automation? (post-MVP)

## Remaining (audit 2026-09-23)

| Criterion | Why it is open | Closed by |
|---|---|---|
| Mute/solo/lock buttons work; locked tracks prevent editing | Lock refuses only asset drops (`packages/features/edit-suite/src/components/timeline/track-row.tsx:210`); `ClipBlock` never receives the lock state, so clips on a locked track still move, trim and delete | unassigned |
