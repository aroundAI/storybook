# FILM-311: Shot List Editor Component

**Phase**: 3
**Priority**: P0
**Effort**: L (5-7 days)
**Dependencies**: FILM-307 (shot-list-generation)
**Blocks**: Phase 4 (Video Generation)

---

## Context

The Shot List Editor displays and manages the generated shot list, providing an editable table of shots with drag-and-drop reordering, inline editing capabilities, and video generation triggers. This is the final step before video generation begins in Phase 4.

---

## Requirements

### Functional Requirements

1. **Shot List Display**
   - Table with columns: Sequence, Scene, Shot Type, Duration, Prompt, Camera, Status
   - Thumbnail preview when video generated
   - Color-coded status badges (pending, generating, completed, failed)
   - Responsive table (cards on mobile)

2. **Drag-and-Drop Reordering**
   - Drag handle on each row
   - Visual feedback during drag
   - Auto-save new order on drop
   - Update sequence numbers

3. **Inline Editing**
   - Click to edit prompt, description, duration
   - Save changes with debounce
   - Validation feedback
   - Undo/redo capability

4. **Actions**
   - "Generate All Videos" bulk action
   - "Generate Selected" for multiple shots
   - Individual "Generate" button per shot
   - Delete shot confirmation
   - Duplicate shot

5. **Filters**
   - Filter by status
   - Filter by scene
   - Search by prompt/description
   - Sort by any column

---

## Interface

```typescript
'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Button } from '@kit/ui/button';
import { Input } from '@kit/ui/input';
import { Badge } from '@kit/ui/badge';
import { toast } from '@kit/ui/sonner';
import { GripVertical, Play, Trash2, Copy } from 'lucide-react';
import { reorderShotsAction, updateShotAction } from '../lib/server/mutations/shot-actions';

interface ShotListEditorProps {
  episodeId: string;
  shots: Shot[];
}

interface Shot {
  id: string;
  sequenceNumber: number;
  sceneNumber: number;
  shotNumber: number;
  description: string;
  prompt: string;
  durationSeconds: number;
  status: 'pending' | 'generating' | 'completed' | 'failed';
  cameraDirection: string | null;
  videoUrl: string | null;
  thumbnailUrl: string | null;
}

export function ShotListEditor({ episodeId, shots: initialShots }: ShotListEditorProps) {
  const [shots, setShots] = useState(initialShots);
  const [selectedShots, setSelectedShots] = useState<string[]>([]);
  const [filter, setFilter] = useState<string>('');
  const queryClient = useQueryClient();

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const reorderMutation = useMutation({
    mutationFn: (shotIds: string[]) =>
      reorderShotsAction({ episodeId, shotIds }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['shots', episodeId] });
      toast.success('Shots reordered successfully');
    },
  });

  const handleDragEnd = (event: any) => {
    const { active, over } = event;

    if (active.id !== over.id) {
      const oldIndex = shots.findIndex((s) => s.id === active.id);
      const newIndex = shots.findIndex((s) => s.id === over.id);

      const newOrder = arrayMove(shots, oldIndex, newIndex);
      setShots(newOrder);

      // Save to server
      reorderMutation.mutate(newOrder.map((s) => s.id));
    }
  };

  const filteredShots = shots.filter((shot) =>
    shot.prompt.toLowerCase().includes(filter.toLowerCase()) ||
    shot.description.toLowerCase().includes(filter.toLowerCase())
  );

  return (
    <div className="space-y-4">
      {/* Header Actions */}
      <div className="flex justify-between items-center">
        <Input
          placeholder="Search shots..."
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="max-w-xs"
        />

        <div className="flex gap-2">
          <Button
            variant="outline"
            disabled={selectedShots.length === 0}
          >
            Generate Selected ({selectedShots.length})
          </Button>
          <Button>
            <Play className="w-4 h-4 mr-2" />
            Generate All Videos
          </Button>
        </div>
      </div>

      {/* Shot List Table */}
      <div className="border rounded-lg">
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext
            items={filteredShots.map((s) => s.id)}
            strategy={verticalListSortingStrategy}
          >
            <div className="divide-y">
              {filteredShots.map((shot) => (
                <ShotRow
                  key={shot.id}
                  shot={shot}
                  episodeId={episodeId}
                  isSelected={selectedShots.includes(shot.id)}
                  onSelect={(selected) => {
                    setSelectedShots(
                      selected
                        ? [...selectedShots, shot.id]
                        : selectedShots.filter((id) => id !== shot.id)
                    );
                  }}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      </div>

      {/* Summary */}
      <div className="flex justify-between text-sm text-muted-foreground">
        <span>{shots.length} shots total</span>
        <span>
          Estimated duration:{' '}
          {Math.round(shots.reduce((sum, s) => sum + s.durationSeconds, 0))}s
        </span>
      </div>
    </div>
  );
}

function ShotRow({ shot, episodeId, isSelected, onSelect }: {
  shot: Shot;
  episodeId: string;
  isSelected: boolean;
  onSelect: (selected: boolean) => void;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const queryClient = useQueryClient();

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
  } = useSortable({ id: shot.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const updateMutation = useMutation({
    mutationFn: (updates: Partial<Shot>) =>
      updateShotAction({ shotId: shot.id, ...updates }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['shots', episodeId] });
      toast.success('Shot updated');
      setIsEditing(false);
    },
  });

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="flex items-center gap-4 p-4 hover:bg-muted/50"
    >
      {/* Drag Handle */}
      <div {...attributes} {...listeners} className="cursor-grab">
        <GripVertical className="w-5 h-5 text-muted-foreground" />
      </div>

      {/* Checkbox */}
      <input
        type="checkbox"
        checked={isSelected}
        onChange={(e) => onSelect(e.target.checked)}
      />

      {/* Shot Info */}
      <div className="flex-1 grid grid-cols-6 gap-4 items-center">
        <div className="font-mono text-sm">
          {shot.sequenceNumber}
        </div>

        <div className="text-sm">
          Scene {shot.sceneNumber}
        </div>

        <Badge variant="outline">{shot.status}</Badge>

        <div className="text-sm">{shot.durationSeconds}s</div>

        {isEditing ? (
          <Input
            value={shot.prompt}
            onChange={(e) =>
              updateMutation.mutate({ prompt: e.target.value })
            }
            className="col-span-2"
          />
        ) : (
          <div
            className="text-sm truncate col-span-2 cursor-pointer"
            onClick={() => setIsEditing(true)}
          >
            {shot.prompt}
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="flex gap-2">
        <Button size="sm" variant="outline">
          <Copy className="w-4 h-4" />
        </Button>
        <Button size="sm" variant="outline">
          <Trash2 className="w-4 h-4" />
        </Button>
        <Button size="sm" disabled={shot.status === 'generating'}>
          <Play className="w-4 h-4" />
        </Button>
      </div>
    </div>
  );
}
```

---

## File Changes

### New Files

1. **packages/features/episodes/src/components/ShotListEditor.tsx** (CREATE THIS)
2. **packages/features/episodes/src/components/ShotRow.tsx** (CREATE THIS)

---

## Implementation Status

**Status**: COMPLETED
**Completed Date**: 2025-12-08
**PR**: feat/film-308-story-studio

### Files Created
- `packages/features/episodes/src/components/shot-list-editor/shot-list-editor.tsx`
- `packages/features/episodes/src/components/shot-list-editor/shot-row.tsx`

---

## Acceptance Criteria

- [x] Displays shots in sortable table
- [x] Drag-and-drop reordering works
- [x] Inline editing saves changes
- [x] Status badges color-coded
- [x] Bulk actions work (select multiple)
- [x] Search/filter functionality works
- [x] Generate buttons trigger video generation
- [x] Responsive on mobile

---

## References

- **FILM-307**: Shot list generation
- **FILM-303**: Shot CRUD actions
- **@dnd-kit**: Drag and drop library
