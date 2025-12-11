# FILM-606: Transitions Library

## Metadata
- **Phase:** 6 - Edit Suite
- **Priority:** P1 (Post-MVP Enhancement)
- **Effort:** M (4-8 hours)
- **Status:** ✅ DONE
- **Dependencies:** FILM-601 (Timeline Editor), FILM-604 (Auto-Stitch)
- **Blocks:** None

---

## Context

Transitions smooth the visual flow between shots in an episode. A transitions library provides pre-built effects (fade, dissolve, wipe, zoom) that can be applied between clips on the timeline. This enhances production value without requiring manual video editing skills.

---

## Specification

### Requirements

1. **Transition Presets**: Pre-built transitions (fade, dissolve, wipe, zoom, etc.)
2. **Duration Control**: Adjustable transition duration (0.25s - 2s)
3. **Preview**: Real-time preview of transition effect
4. **Drag-and-Drop**: Apply transitions by dragging to clip boundaries
5. **Auto-Apply**: Option to automatically add transitions between all clips
6. **Custom Transitions**: Support for custom transition definitions

### Transition Types

```typescript
// packages/features/film-studio/src/lib/transitions.ts

export const TRANSITION_PRESETS = {
  fade: {
    id: 'fade',
    name: 'Fade',
    description: 'Gradually fade between clips',
    defaultDuration: 0.5,
    category: 'basic',
    ffmpegFilter: (duration: number) => `xfade=transition=fade:duration=${duration}`,
  },
  dissolve: {
    id: 'dissolve',
    name: 'Dissolve',
    description: 'Cross-dissolve between clips',
    defaultDuration: 0.5,
    category: 'basic',
    ffmpegFilter: (duration: number) => `xfade=transition=dissolve:duration=${duration}`,
  },
  wipeLeft: {
    id: 'wipeLeft',
    name: 'Wipe Left',
    description: 'New clip wipes in from right',
    defaultDuration: 0.5,
    category: 'wipe',
    ffmpegFilter: (duration: number) => `xfade=transition=wipeleft:duration=${duration}`,
  },
  wipeRight: {
    id: 'wipeRight',
    name: 'Wipe Right',
    description: 'New clip wipes in from left',
    defaultDuration: 0.5,
    category: 'wipe',
    ffmpegFilter: (duration: number) => `xfade=transition=wiperight:duration=${duration}`,
  },
  wipeUp: {
    id: 'wipeUp',
    name: 'Wipe Up',
    description: 'New clip wipes in from bottom',
    defaultDuration: 0.5,
    category: 'wipe',
    ffmpegFilter: (duration: number) => `xfade=transition=wipeup:duration=${duration}`,
  },
  wipeDown: {
    id: 'wipeDown',
    name: 'Wipe Down',
    description: 'New clip wipes in from top',
    defaultDuration: 0.5,
    category: 'wipe',
    ffmpegFilter: (duration: number) => `xfade=transition=wipedown:duration=${duration}`,
  },
  zoomIn: {
    id: 'zoomIn',
    name: 'Zoom In',
    description: 'Zoom into next clip',
    defaultDuration: 0.5,
    category: 'zoom',
    ffmpegFilter: (duration: number) => `xfade=transition=zoomin:duration=${duration}`,
  },
  slideLeft: {
    id: 'slideLeft',
    name: 'Slide Left',
    description: 'New clip slides in from right',
    defaultDuration: 0.5,
    category: 'slide',
    ffmpegFilter: (duration: number) => `xfade=transition=slideleft:duration=${duration}`,
  },
  circleOpen: {
    id: 'circleOpen',
    name: 'Circle Open',
    description: 'Circle reveals next clip',
    defaultDuration: 0.75,
    category: 'shape',
    ffmpegFilter: (duration: number) => `xfade=transition=circleopen:duration=${duration}`,
  },
  radial: {
    id: 'radial',
    name: 'Radial',
    description: 'Radial wipe transition',
    defaultDuration: 0.75,
    category: 'shape',
    ffmpegFilter: (duration: number) => `xfade=transition=radial:duration=${duration}`,
  },
} as const;

export type TransitionType = keyof typeof TRANSITION_PRESETS;

export interface TransitionInstance {
  id: string;
  type: TransitionType;
  duration: number;
  betweenClips: [string, string]; // [clipId1, clipId2]
}
```

### Transitions Panel Component

```typescript
// packages/features/film-studio/src/components/transitions-panel.tsx

'use client';

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@kit/ui/card';
import { Button } from '@kit/ui/button';
import { Slider } from '@kit/ui/slider';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@kit/ui/tabs';
import { Badge } from '@kit/ui/badge';
import { Shuffle, Play, Check } from 'lucide-react';
import { TRANSITION_PRESETS, TransitionType } from '../lib/transitions';

interface TransitionsPanelProps {
  selectedTransition: TransitionType | null;
  onSelectTransition: (type: TransitionType) => void;
  onApplyTransition: (type: TransitionType, duration: number) => void;
  onAutoApplyAll: (type: TransitionType, duration: number) => void;
}

export function TransitionsPanel({
  selectedTransition,
  onSelectTransition,
  onApplyTransition,
  onAutoApplyAll,
}: TransitionsPanelProps) {
  const [duration, setDuration] = useState(0.5);
  const [previewPlaying, setPreviewPlaying] = useState(false);

  const categories = ['basic', 'wipe', 'slide', 'zoom', 'shape'];

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">Transitions</CardTitle>
          <Button
            variant="outline"
            size="sm"
            onClick={() => selectedTransition && onAutoApplyAll(selectedTransition, duration)}
            disabled={!selectedTransition}
          >
            <Shuffle className="h-4 w-4 mr-1" />
            Apply to All
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Duration Slider */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-sm font-medium">Duration</label>
            <span className="text-sm text-muted-foreground">{duration}s</span>
          </div>
          <Slider
            value={[duration]}
            onValueChange={([value]) => setDuration(value)}
            min={0.25}
            max={2}
            step={0.25}
          />
        </div>

        {/* Transition Categories */}
        <Tabs defaultValue="basic" className="w-full">
          <TabsList className="grid grid-cols-5 w-full">
            {categories.map((category) => (
              <TabsTrigger key={category} value={category} className="text-xs">
                {category.charAt(0).toUpperCase() + category.slice(1)}
              </TabsTrigger>
            ))}
          </TabsList>

          {categories.map((category) => (
            <TabsContent key={category} value={category} className="mt-2">
              <div className="grid grid-cols-2 gap-2">
                {Object.values(TRANSITION_PRESETS)
                  .filter((t) => t.category === category)
                  .map((transition) => (
                    <TransitionCard
                      key={transition.id}
                      transition={transition}
                      isSelected={selectedTransition === transition.id}
                      onSelect={() => onSelectTransition(transition.id as TransitionType)}
                      onPreview={() => {
                        setPreviewPlaying(true);
                        setTimeout(() => setPreviewPlaying(false), duration * 1000);
                      }}
                    />
                  ))}
              </div>
            </TabsContent>
          ))}
        </Tabs>

        {/* Apply Button */}
        {selectedTransition && (
          <Button
            className="w-full"
            onClick={() => onApplyTransition(selectedTransition, duration)}
          >
            Apply Transition
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

function TransitionCard({ transition, isSelected, onSelect, onPreview }) {
  return (
    <button
      onClick={onSelect}
      className={`p-3 rounded-lg border text-left transition-colors ${
        isSelected
          ? 'border-primary bg-primary/10'
          : 'border-border hover:border-primary/50'
      }`}
    >
      <div className="flex items-center justify-between mb-1">
        <span className="font-medium text-sm">{transition.name}</span>
        {isSelected && <Check className="h-4 w-4 text-primary" />}
      </div>
      <p className="text-xs text-muted-foreground line-clamp-1">
        {transition.description}
      </p>
      <div className="flex items-center justify-between mt-2">
        <Badge variant="outline" className="text-xs">
          {transition.defaultDuration}s
        </Badge>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 w-6 p-0"
          onClick={(e) => {
            e.stopPropagation();
            onPreview();
          }}
        >
          <Play className="h-3 w-3" />
        </Button>
      </div>
    </button>
  );
}
```

### Timeline Integration

```typescript
// packages/features/film-studio/src/components/transition-handle.tsx

'use client';

import { useDrop } from 'react-dnd';
import { Badge } from '@kit/ui/badge';
import { TransitionInstance, TRANSITION_PRESETS } from '../lib/transitions';

interface TransitionHandleProps {
  clipId: string;
  nextClipId: string;
  transition?: TransitionInstance;
  onDrop: (transitionType: string) => void;
  onClick: () => void;
}

export function TransitionHandle({
  clipId,
  nextClipId,
  transition,
  onDrop,
  onClick,
}: TransitionHandleProps) {
  const [{ isOver, canDrop }, drop] = useDrop({
    accept: 'TRANSITION',
    drop: (item: { type: string }) => onDrop(item.type),
    collect: (monitor) => ({
      isOver: monitor.isOver(),
      canDrop: monitor.canDrop(),
    }),
  });

  return (
    <div
      ref={drop}
      onClick={onClick}
      className={`absolute -right-4 top-1/2 -translate-y-1/2 z-10 w-8 h-8 rounded-full
        flex items-center justify-center cursor-pointer transition-all
        ${isOver && canDrop ? 'bg-primary scale-125' : 'bg-muted hover:bg-muted/80'}
        ${transition ? 'ring-2 ring-primary' : ''}`}
    >
      {transition ? (
        <Badge variant="secondary" className="text-[10px] px-1">
          {TRANSITION_PRESETS[transition.type].name.substring(0, 1)}
        </Badge>
      ) : (
        <span className="text-xs text-muted-foreground">+</span>
      )}
    </div>
  );
}
```

### Server Actions

```typescript
// packages/features/film-studio/src/server/transition-actions.ts

'use server';

import { enhanceAction } from '@kit/next/actions';
import { getSupabaseServerClient } from '@kit/supabase/server-client';
import { z } from 'zod';
import { TRANSITION_PRESETS, TransitionType } from '../lib/transitions';

export const applyTransitionAction = enhanceAction(
  async ({ episodeId, clipId1, clipId2, transitionType, duration }, user) => {
    const client = getSupabaseServerClient();

    // Get episode timeline data
    const { data: episode } = await client
      .from('episodes')
      .select('metadata')
      .eq('id', episodeId)
      .single();

    const timeline = episode.metadata?.timeline || { transitions: [] };

    // Add or update transition
    const existingIndex = timeline.transitions.findIndex(
      (t: any) => t.betweenClips[0] === clipId1 && t.betweenClips[1] === clipId2
    );

    const newTransition = {
      id: `trans_${clipId1}_${clipId2}`,
      type: transitionType,
      duration,
      betweenClips: [clipId1, clipId2],
    };

    if (existingIndex >= 0) {
      timeline.transitions[existingIndex] = newTransition;
    } else {
      timeline.transitions.push(newTransition);
    }

    // Save to episode metadata
    await client
      .from('episodes')
      .update({
        metadata: { ...episode.metadata, timeline },
        updated_at: new Date().toISOString(),
      })
      .eq('id', episodeId);

    return { transition: newTransition };
  },
  {
    schema: z.object({
      episodeId: z.string().uuid(),
      clipId1: z.string().uuid(),
      clipId2: z.string().uuid(),
      transitionType: z.string(),
      duration: z.number().min(0.25).max(2),
    }),
    auth: true,
  }
);

export const autoApplyTransitionsAction = enhanceAction(
  async ({ episodeId, transitionType, duration }, user) => {
    const client = getSupabaseServerClient();

    // Get all shots in order
    const { data: shots } = await client
      .from('shots')
      .select('id')
      .eq('episode_id', episodeId)
      .order('sequence_number');

    if (!shots || shots.length < 2) {
      throw new Error('Need at least 2 clips to apply transitions');
    }

    // Create transitions between all adjacent clips
    const transitions = [];
    for (let i = 0; i < shots.length - 1; i++) {
      transitions.push({
        id: `trans_${shots[i].id}_${shots[i + 1].id}`,
        type: transitionType,
        duration,
        betweenClips: [shots[i].id, shots[i + 1].id],
      });
    }

    // Get episode and update timeline
    const { data: episode } = await client
      .from('episodes')
      .select('metadata')
      .eq('id', episodeId)
      .single();

    await client
      .from('episodes')
      .update({
        metadata: { ...episode.metadata, timeline: { transitions } },
        updated_at: new Date().toISOString(),
      })
      .eq('id', episodeId);

    return { transitionCount: transitions.length };
  },
  {
    schema: z.object({
      episodeId: z.string().uuid(),
      transitionType: z.string(),
      duration: z.number().min(0.25).max(2),
    }),
    auth: true,
  }
);
```

### File Changes

| Action | Path |
|--------|------|
| CREATE | `packages/features/film-studio/src/lib/transitions.ts` |
| CREATE | `packages/features/film-studio/src/components/transitions-panel.tsx` |
| CREATE | `packages/features/film-studio/src/components/transition-handle.tsx` |
| CREATE | `packages/features/film-studio/src/server/transition-actions.ts` |
| MODIFY | `packages/features/film-studio/src/components/timeline-editor.tsx` |

---

## Acceptance Criteria

- [ ] 10+ transition presets available (fade, dissolve, wipes, zoom, etc.)
- [ ] Duration adjustable from 0.25s to 2s
- [ ] Transitions organized by category
- [ ] Preview transition effect before applying
- [ ] Drag-and-drop transitions to clip boundaries
- [ ] Apply transition to all clips with one click
- [ ] Visual indicator on timeline shows applied transitions
- [ ] Transitions rendered correctly in final export

---

## Test Plan

### Unit Tests
- [ ] Test FFmpeg filter generation for each transition type
- [ ] Test transition duration validation
- [ ] Test transition data serialization

### Integration Tests
- [ ] Test applying single transition
- [ ] Test auto-apply to all clips
- [ ] Test rendering with transitions

---

## Error Handling

| Error | User Experience |
|-------|-----------------|
| Single clip only | Disable transitions, show tooltip |
| Invalid duration | Clamp to valid range |
| Render failed | Show error, suggest simplifying transitions |
