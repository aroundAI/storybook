'use client';

import { useCallback, useState } from 'react';

import {
  DndContext,
  type DragEndEvent,
  DragOverlay,
  type DragStartEvent,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  SortableContext,
  rectSortingStrategy,
  sortableKeyboardCoordinates,
} from '@dnd-kit/sortable';
import { Grid3X3 } from 'lucide-react';

import { cn } from '@kit/ui/utils';

import { ShotCard } from './shot-card';
import type { ShotGridProps } from './types';
import { useShotSelection } from './use-shot-selection';

export function ShotGrid({
  shots,
  selectedShotIds,
  onSelectionChange,
  onReorder,
  onShotPreview,
  onGenerateShot,
  onRetryShot,
  enableReorder = true,
  className,
}: ShotGridProps) {
  const [activeId, setActiveId] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const { handleShotClick, handleClearSelection } = useShotSelection({
    shots,
    selectedShotIds,
    onSelectionChange,
  });

  const handleDragStart = useCallback((event: DragStartEvent) => {
    setActiveId(String(event.active.id));
  }, []);

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;

      if (over && active.id !== over.id && onReorder) {
        const overShot = shots.find((s) => s.id === String(over.id));

        if (overShot) {
          onReorder(String(active.id), overShot.sequenceNumber);
        }
      }

      setActiveId(null);
    },
    [shots, onReorder],
  );

  const handleDragCancel = useCallback(() => {
    setActiveId(null);
  }, []);

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (event.key === 'Escape') {
        handleClearSelection();
      }
    },
    [handleClearSelection],
  );

  const activeShot = activeId
    ? shots.find((s) => s.id === activeId)
    : undefined;

  if (shots.length === 0) {
    return (
      <div
        className={cn(
          'flex flex-col items-center justify-center py-12',
          className,
        )}
      >
        <Grid3X3 className="text-muted-foreground mb-4 h-12 w-12" />
        <p className="text-muted-foreground text-lg font-medium">
          No shots yet
        </p>
        <p className="text-muted-foreground mt-1 text-sm">
          Generate a shot list from the screenplay to get started.
        </p>
      </div>
    );
  }

  const gridContent = (
    <div
      role="grid"
      aria-label="Shot grid"
      aria-multiselectable="true"
      onKeyDown={handleKeyDown}
      tabIndex={0}
      className={cn(
        'grid gap-4',
        'grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6',
        'focus:outline-none',
        className,
      )}
      data-test="shot-grid"
    >
      {shots.map((shot) => (
        <ShotCard
          key={shot.id}
          shot={shot}
          isSelected={selectedShotIds.includes(shot.id)}
          onClick={(e) => handleShotClick(shot.id, e)}
          onDoubleClick={() => onShotPreview?.(shot.id)}
          onGenerateClick={() => onGenerateShot?.(shot.id)}
          onRetryClick={() => onRetryShot?.(shot.id)}
        />
      ))}
    </div>
  );

  if (!enableReorder) {
    return gridContent;
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
    >
      <SortableContext
        items={shots.map((s) => s.id)}
        strategy={rectSortingStrategy}
      >
        {gridContent}
      </SortableContext>

      <DragOverlay>
        {activeShot && (
          <ShotCard
            shot={activeShot}
            isSelected={false}
            isDragging
            onClick={() => {}}
          />
        )}
      </DragOverlay>
    </DndContext>
  );
}
