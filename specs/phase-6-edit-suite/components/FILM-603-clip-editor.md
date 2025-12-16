# FILM-603: Clip Editor

## Metadata
- **Phase:** 6 - Edit Suite
- **Priority:** P1 (Post-MVP)
- **Effort:** L (1-3 days)
- **Status:** ✅ Done
- **Dependencies:** FILM-601 (Timeline Editor) ✅, FILM-602 (Track Layer) ⚠️
- **Blocks:** None

> **Note:** FILM-601 Timeline Editor is complete. Clip Editor can now be implemented.

---

## Context

The Clip Editor is a modal/panel that opens when double-clicking a clip on the timeline. It allows detailed editing of individual clips including trimming, speed adjustment, and audio settings.

---

## Specification

### Requirements

1. **Video Clip Editor**: Trim in/out points, speed adjustment, preview
2. **Audio Clip Editor**: Trim, volume, fade in/out, pitch
3. **Metadata Editing**: Rename clips, add notes
4. **Preview**: Play clip in isolation with loop option
5. **Apply/Cancel**: Changes require explicit save

### Component Interface

```typescript
interface ClipEditorProps {
  clip: Clip;
  track: Track;
  isOpen: boolean;
  onClose: () => void;
  onSave: (updatedClip: Clip) => void;
}

interface ClipEditorState {
  sourceStart: number;      // In-point in source
  sourceEnd: number;        // Out-point in source
  speed: number;            // 0.5 - 2.0
  volume: number;           // 0 - 1.5
  fadeInDuration: number;   // seconds
  fadeOutDuration: number;  // seconds
  pitch: number;            // -12 to +12 semitones
  name: string;
  notes: string;
}
```

### Visual Design

```
┌─────────────────────────────────────────────────────────────────────────┐
│ Edit Clip: "Scene 1 - Opening"                                    [X]  │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │                                                                  │   │
│  │                     Video Preview                                │   │
│  │                                                                  │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │ ▌========[====SELECTED RANGE====]========▐                      │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│     0:00                                                      2:30     │
│                                                                         │
│  ┌────────────────────┐  ┌────────────────────┐                       │
│  │ Speed              │  │ Volume             │                       │
│  │ ────●──────        │  │ ──────────●───     │                       │
│  │      1.0x          │  │        100%        │                       │
│  └────────────────────┘  └────────────────────┘                       │
│                                                                         │
│  ┌────────────────────┐  ┌────────────────────┐                       │
│  │ Fade In            │  │ Fade Out           │                       │
│  │ ────●──────        │  │ ────●──────        │                       │
│  │      0.5s          │  │      0.5s          │                       │
│  └────────────────────┘  └────────────────────┘                       │
│                                                                         │
│  Name: [Scene 1 - Opening                                        ]     │
│  Notes: [                                                        ]     │
│                                                                         │
├─────────────────────────────────────────────────────────────────────────┤
│                                           [Cancel]  [Apply Changes]    │
└─────────────────────────────────────────────────────────────────────────┘
```

### Implementation

```typescript
// packages/features/episodes/src/components/timeline-editor/clip-editor.tsx

'use client';

import { useState, useRef, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@kit/ui/dialog';
import { Button } from '@kit/ui/button';
import { Input } from '@kit/ui/input';
import { Textarea } from '@kit/ui/textarea';
import { Slider } from '@kit/ui/slider';
import { Label } from '@kit/ui/label';
import { Play, Pause, RotateCcw } from 'lucide-react';

export function ClipEditor({
  clip,
  track,
  isOpen,
  onClose,
  onSave,
}: ClipEditorProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [state, setState] = useState<ClipEditorState>({
    sourceStart: clip.sourceStart ?? 0,
    sourceEnd: clip.sourceEnd ?? clip.duration,
    speed: 1,
    volume: track.type !== 'video' ? 1 : undefined,
    fadeInDuration: 0,
    fadeOutDuration: 0,
    pitch: 0,
    name: clip.name,
    notes: clip.notes ?? '',
  });

  // Derived values
  const sourceDuration = clip.originalDuration ?? clip.duration;
  const selectedDuration = state.sourceEnd - state.sourceStart;
  const outputDuration = selectedDuration / state.speed;

  // Preview playback
  useEffect(() => {
    if (!videoRef.current) return;

    if (isPlaying) {
      videoRef.current.currentTime = state.sourceStart;
      videoRef.current.playbackRate = state.speed;
      videoRef.current.play();
    } else {
      videoRef.current.pause();
    }
  }, [isPlaying, state.sourceStart, state.speed]);

  // Loop within selected range
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const handleTimeUpdate = () => {
      if (video.currentTime >= state.sourceEnd) {
        video.currentTime = state.sourceStart;
      }
    };

    video.addEventListener('timeupdate', handleTimeUpdate);
    return () => video.removeEventListener('timeupdate', handleTimeUpdate);
  }, [state.sourceStart, state.sourceEnd]);

  const handleSave = () => {
    onSave({
      ...clip,
      name: state.name,
      notes: state.notes,
      sourceStart: state.sourceStart,
      sourceEnd: state.sourceEnd,
      duration: outputDuration,
      metadata: {
        ...clip.metadata,
        speed: state.speed,
        volume: state.volume,
        fadeIn: state.fadeInDuration,
        fadeOut: state.fadeOutDuration,
        pitch: state.pitch,
      },
    });
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Edit Clip: {clip.name}</DialogTitle>
        </DialogHeader>

        <div className="space-y-6">
          {/* Video Preview */}
          {track.type === 'video' && clip.assetUrl && (
            <div className="relative aspect-video bg-black rounded-lg overflow-hidden">
              <video
                ref={videoRef}
                src={clip.assetUrl}
                className="w-full h-full object-contain"
                muted={track.type === 'video'}
              />
              <div className="absolute bottom-2 left-2 flex gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => setIsPlaying(!isPlaying)}
                >
                  {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    if (videoRef.current) {
                      videoRef.current.currentTime = state.sourceStart;
                    }
                  }}
                >
                  <RotateCcw className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}

          {/* Range Selector */}
          <div className="space-y-2">
            <Label>Trim Range</Label>
            <div className="relative h-8 bg-muted rounded">
              {/* Full duration bar */}
              <div className="absolute inset-0" />
              {/* Selected range */}
              <div
                className="absolute top-0 bottom-0 bg-primary/50 rounded"
                style={{
                  left: `${(state.sourceStart / sourceDuration) * 100}%`,
                  right: `${100 - (state.sourceEnd / sourceDuration) * 100}%`,
                }}
              />
              {/* Handles */}
              <Slider
                value={[state.sourceStart, state.sourceEnd]}
                min={0}
                max={sourceDuration}
                step={1/30}
                onValueChange={([start, end]) =>
                  setState(s => ({ ...s, sourceStart: start, sourceEnd: end }))
                }
                className="absolute inset-0"
              />
            </div>
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>{formatTime(state.sourceStart)}</span>
              <span>Duration: {formatTime(selectedDuration)}</span>
              <span>{formatTime(state.sourceEnd)}</span>
            </div>
          </div>

          {/* Speed Control */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Speed</Label>
              <Slider
                value={[state.speed * 100]}
                min={50}
                max={200}
                step={5}
                onValueChange={([v]) => setState(s => ({ ...s, speed: v / 100 }))}
              />
              <div className="text-sm text-muted-foreground text-center">
                {state.speed.toFixed(2)}x
              </div>
            </div>

            {/* Volume Control (for audio tracks) */}
            {track.type !== 'video' && (
              <div className="space-y-2">
                <Label>Volume</Label>
                <Slider
                  value={[(state.volume ?? 1) * 100]}
                  min={0}
                  max={150}
                  step={5}
                  onValueChange={([v]) => setState(s => ({ ...s, volume: v / 100 }))}
                />
                <div className="text-sm text-muted-foreground text-center">
                  {Math.round((state.volume ?? 1) * 100)}%
                </div>
              </div>
            )}
          </div>

          {/* Fade Controls */}
          {track.type !== 'video' && (
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Fade In</Label>
                <Slider
                  value={[state.fadeInDuration * 10]}
                  min={0}
                  max={30}
                  step={1}
                  onValueChange={([v]) => setState(s => ({ ...s, fadeInDuration: v / 10 }))}
                />
                <div className="text-sm text-muted-foreground text-center">
                  {state.fadeInDuration.toFixed(1)}s
                </div>
              </div>
              <div className="space-y-2">
                <Label>Fade Out</Label>
                <Slider
                  value={[state.fadeOutDuration * 10]}
                  min={0}
                  max={30}
                  step={1}
                  onValueChange={([v]) => setState(s => ({ ...s, fadeOutDuration: v / 10 }))}
                />
                <div className="text-sm text-muted-foreground text-center">
                  {state.fadeOutDuration.toFixed(1)}s
                </div>
              </div>
            </div>
          )}

          {/* Metadata */}
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="clip-name">Name</Label>
              <Input
                id="clip-name"
                value={state.name}
                onChange={(e) => setState(s => ({ ...s, name: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="clip-notes">Notes</Label>
              <Textarea
                id="clip-notes"
                value={state.notes}
                onChange={(e) => setState(s => ({ ...s, notes: e.target.value }))}
                rows={2}
              />
            </div>
          </div>

          {/* Output Duration Info */}
          <div className="text-sm text-muted-foreground">
            Output duration: {formatTime(outputDuration)}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleSave}>
            Apply Changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
| CREATE | `packages/features/episodes/src/components/timeline-editor/clip-editor.tsx` |
| CREATE | `packages/features/episodes/src/components/timeline-editor/range-slider.tsx` |

---

## Acceptance Criteria

- [x] Opens on double-click of clip
- [x] Shows video preview for video clips
- [x] Preview loops within selected range
- [x] Trim handles adjust in/out points
- [x] Speed slider changes playback rate
- [x] Volume slider works for audio clips
- [x] Fade in/out sliders work
- [x] Name and notes can be edited
- [x] Cancel closes without saving
- [x] Apply saves changes and closes
- [x] Output duration updates in real-time

---

## Test Plan

### Unit Tests
- [ ] Test duration calculation with speed changes
- [ ] Test range validation (end > start)
- [ ] Test state initialization from clip

### Integration Tests
- [ ] Test preview playback controls
- [ ] Test save/cancel behavior

---

## Accessibility

- Dialog has proper focus management
- All sliders have labels
- Preview has playback controls
- Keyboard navigation works throughout

---

## Open Questions

- [ ] Should we support color grading? (post-MVP)
- [ ] Should we support audio filters? (post-MVP)
