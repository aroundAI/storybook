# FILM-410: Shot Grid Component

**Phase**: 4
**Priority**: P0
**Effort**: L (5-6 days)
**Dependencies**: FILM-409 (visual-studio)
**Blocks**: None

---

## Context

The Shot Grid displays all shots for an episode in a responsive grid layout with drag-and-drop reordering, selection management, status overlays, and video/thumbnail previews. It must handle rendering hundreds of shots efficiently, support keyboard navigation, and provide visual feedback for shot status (queued, generating, completed, failed).

---

## Requirements

### Functional Requirements

1. **Grid Display**
   - Responsive grid (1-6 columns based on viewport)
   - Show shot thumbnail or video preview
   - Display shot metadata (sequence number, duration, prompt)
   - Status badge (queued/generating/completed/failed)

2. **Selection Management**
   - Click to select single shot
   - Cmd/Ctrl+Click for multi-select
   - Shift+Click for range select
   - Visual highlight for selected shots

3. **Drag-and-Drop Reordering**
   - Drag shots to reorder
   - Update sequence numbers on drop
   - Smooth animations during drag
   - Visual drop indicator

4. **Status Overlays**
   - Progress bar for generating shots
   - Error icon for failed shots
   - Play button for completed shots
   - Generate button for shots without video

---

## Interface

### Component Props

```typescript
interface ShotGridProps {
  shots: Shot[];
  selectedShotIds: string[];
  onSelectionChange: (shotIds: string[]) => void;
  onReorder?: (shotId: string, newSequence: number) => void;
}

interface Shot {
  id: string;
  sequence_number: number;
  prompt: string;
  duration: number;
  aspect_ratio: string;
  status: 'pending' | 'queued' | 'generating' | 'completed' | 'failed';
  video_url: string | null;
  thumbnail_url: string | null;
}
```

### Component Implementation

```typescript
'use client';

import { useState } from 'react';
import { DndContext, closestCenter, DragOverlay } from '@dnd-kit/core';
import { SortableContext, rectSortingStrategy } from '@dnd-kit/sortable';
import { ShotCard } from './ShotCard';

export function ShotGrid({
  shots,
  selectedShotIds,
  onSelectionChange,
  onReorder,
}: ShotGridProps) {
  const [activeId, setActiveId] = useState<string | null>(null);

  const handleShotClick = (shotId: string, event: React.MouseEvent) => {
    if (event.metaKey || event.ctrlKey) {
      // Multi-select: toggle shot
      if (selectedShotIds.includes(shotId)) {
        onSelectionChange(selectedShotIds.filter((id) => id !== shotId));
      } else {
        onSelectionChange([...selectedShotIds, shotId]);
      }
    } else if (event.shiftKey && selectedShotIds.length > 0) {
      // Range select
      const lastSelectedId = selectedShotIds[selectedShotIds.length - 1];
      const lastIndex = shots.findIndex((s) => s.id === lastSelectedId);
      const currentIndex = shots.findIndex((s) => s.id === shotId);

      const start = Math.min(lastIndex, currentIndex);
      const end = Math.max(lastIndex, currentIndex);
      const rangeIds = shots.slice(start, end + 1).map((s) => s.id);

      onSelectionChange(rangeIds);
    } else {
      // Single select
      onSelectionChange([shotId]);
    }
  };

  const handleDragStart = (event: any) => {
    setActiveId(event.active.id);
  };

  const handleDragEnd = (event: any) => {
    const { active, over } = event;

    if (over && active.id !== over.id && onReorder) {
      const oldIndex = shots.findIndex((s) => s.id === active.id);
      const newIndex = shots.findIndex((s) => s.id === over.id);

      // Update sequence number
      onReorder(active.id, shots[newIndex].sequence_number);
    }

    setActiveId(null);
  };

  return (
    <DndContext
      collisionDetection={closestCenter}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <SortableContext items={shots.map((s) => s.id)} strategy={rectSortingStrategy}>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
          {shots.map((shot) => (
            <ShotCard
              key={shot.id}
              shot={shot}
              isSelected={selectedShotIds.includes(shot.id)}
              onClick={(e) => handleShotClick(shot.id, e)}
            />
          ))}
        </div>
      </SortableContext>

      <DragOverlay>
        {activeId ? (
          <ShotCard
            shot={shots.find((s) => s.id === activeId)!}
            isSelected={false}
            onClick={() => {}}
            isDragging
          />
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

// Shot Card Component
interface ShotCardProps {
  shot: Shot;
  isSelected: boolean;
  onClick: (event: React.MouseEvent) => void;
  isDragging?: boolean;
}

function ShotCard({ shot, isSelected, onClick, isDragging }: ShotCardProps) {
  const statusColors = {
    pending: 'bg-gray-500',
    queued: 'bg-blue-500',
    generating: 'bg-yellow-500',
    completed: 'bg-green-500',
    failed: 'bg-red-500',
  };

  return (
    <div
      onClick={onClick}
      className={`
        relative cursor-pointer rounded-lg border-2 bg-white p-2 transition-all
        ${isSelected ? 'border-blue-500 shadow-lg' : 'border-gray-200'}
        ${isDragging ? 'opacity-50' : 'hover:shadow-md'}
      `}
    >
      {/* Thumbnail/Video Preview */}
      <div className="aspect-video bg-gray-100">
        {shot.video_url ? (
          <video
            src={shot.video_url}
            className="h-full w-full object-cover"
            controls
          />
        ) : shot.thumbnail_url ? (
          <img
            src={shot.thumbnail_url}
            alt={`Shot ${shot.sequence_number}`}
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="flex h-full items-center justify-center text-gray-400">
            No preview
          </div>
        )}
      </div>

      {/* Shot Info */}
      <div className="mt-2">
        <div className="flex items-center justify-between">
          <span className="text-sm font-semibold">
            Shot #{shot.sequence_number}
          </span>
          <span
            className={`rounded px-2 py-1 text-xs text-white ${statusColors[shot.status]}`}
          >
            {shot.status}
          </span>
        </div>
        <p className="mt-1 line-clamp-2 text-xs text-gray-600">
          {shot.prompt}
        </p>
        <div className="mt-1 text-xs text-gray-500">
          {shot.duration}s · {shot.aspect_ratio}
        </div>
      </div>

      {/* Generating Progress */}
      {shot.status === 'generating' && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/50">
          <div className="text-center text-white">
            <div className="animate-spin">⏳</div>
            <div className="mt-2 text-sm">Generating...</div>
          </div>
        </div>
      )}

      {/* Failed Overlay */}
      {shot.status === 'failed' && (
        <div className="absolute inset-0 flex items-center justify-center bg-red-500/20">
          <div className="text-center">
            <div className="text-2xl">❌</div>
            <div className="mt-2 text-sm text-red-700">Failed</div>
          </div>
        </div>
      )}
    </div>
  );
}
```

---

## Implementation Details

### File Structure

```
packages/features/video-generation/src/
├── components/
│   ├── ShotGrid.tsx                    # Grid component (CREATE THIS)
│   ├── ShotCard.tsx                    # Card component (CREATE THIS)
│   └── __tests__/
│       └── ShotGrid.test.tsx
```

### Drag-and-Drop with @dnd-kit

Using `@dnd-kit` for accessible, performant drag-and-drop:

```bash
pnpm add @dnd-kit/core @dnd-kit/sortable
```

Features:
- Keyboard navigation
- Screen reader support
- Touch support
- Smooth animations

### Selection State Management

```typescript
// Single select: Replace selection
onSelectionChange([shotId]);

// Multi-select: Toggle selection
if (selectedShotIds.includes(shotId)) {
  onSelectionChange(selectedShotIds.filter((id) => id !== shotId));
} else {
  onSelectionChange([...selectedShotIds, shotId]);
}

// Range select: Select all between
const rangeIds = shots.slice(startIndex, endIndex + 1).map((s) => s.id);
onSelectionChange(rangeIds);
```

---

## File Changes

### New Files

1. **packages/features/video-generation/src/components/ShotGrid.tsx**
2. **packages/features/video-generation/src/components/ShotCard.tsx**
3. **packages/features/video-generation/src/components/__tests__/ShotGrid.test.tsx**

### Modified Files

1. **packages/features/video-generation/src/components/index.ts** - Export components

---

## Acceptance Criteria

- [ ] Grid displays all shots
- [ ] Grid is responsive (1-6 columns)
- [ ] Shot selection works (single, multi, range)
- [ ] Drag-and-drop reordering works
- [ ] Status overlays display correctly
- [ ] Video/thumbnail previews work
- [ ] Keyboard navigation supported
- [ ] Component is accessible (ARIA)

---

## Test Plan

### Unit Tests

```typescript
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ShotGrid } from '../ShotGrid';

describe('ShotGrid', () => {
  const mockShots = [
    { id: '1', sequence_number: 1, status: 'completed', /* ... */ },
    { id: '2', sequence_number: 2, status: 'generating', /* ... */ },
    { id: '3', sequence_number: 3, status: 'pending', /* ... */ },
  ];

  it('should render all shots', () => {
    render(
      <ShotGrid
        shots={mockShots}
        selectedShotIds={[]}
        onSelectionChange={() => {}}
      />
    );

    expect(screen.getByText('Shot #1')).toBeInTheDocument();
    expect(screen.getByText('Shot #2')).toBeInTheDocument();
  });

  it('should handle single selection', () => {
    const onSelectionChange = vi.fn();

    render(
      <ShotGrid
        shots={mockShots}
        selectedShotIds={[]}
        onSelectionChange={onSelectionChange}
      />
    );

    fireEvent.click(screen.getByText('Shot #1'));
    expect(onSelectionChange).toHaveBeenCalledWith(['1']);
  });

  it('should handle multi-selection', () => {
    const onSelectionChange = vi.fn();

    render(
      <ShotGrid
        shots={mockShots}
        selectedShotIds={['1']}
        onSelectionChange={onSelectionChange}
      />
    );

    fireEvent.click(screen.getByText('Shot #2'), { metaKey: true });
    expect(onSelectionChange).toHaveBeenCalledWith(['1', '2']);
  });
});
```

---

## Accessibility

- Keyboard navigation (Tab, Arrow keys)
- Screen reader announcements for status changes
- ARIA labels for all interactive elements
- Focus visible styles
- Drag-and-drop keyboard alternative

---

## Performance Considerations

- Virtualize grid for >100 shots (react-window)
- Lazy load video thumbnails
- Debounce drag operations
- Optimize re-renders with React.memo

```typescript
import { FixedSizeGrid } from 'react-window';

// For large grids
<FixedSizeGrid
  columnCount={columns}
  columnWidth={200}
  height={600}
  rowCount={Math.ceil(shots.length / columns)}
  rowHeight={250}
  width={1200}
>
  {({ columnIndex, rowIndex, style }) => (
    <div style={style}>
      <ShotCard shot={shots[rowIndex * columns + columnIndex]} />
    </div>
  )}
</FixedSizeGrid>
```

---

## Future Enhancements

1. **Bulk Actions** - Delete, regenerate selected
2. **Filters** - Filter by status, duration
3. **Sort** - Sort by various criteria
4. **View Modes** - List view, detail view
5. **Inline Editing** - Edit prompt inline

---

## References

- **@dnd-kit Documentation**: https://docs.dndkit.com/
- **FILM-409**: Visual Studio
- **Constitution**: Section 2.3 (Component Pattern)
- **Constitution**: Section 8 (Accessibility)
