'use client';

import { useTransition } from 'react';

import { useRouter } from 'next/navigation';

import {
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from '@dnd-kit/core';

import { moveEpisodeToSeasonAction } from '@kit/episodes/server';
import { refusalMessage, unwrap } from '@kit/next/action-result';
import { toast } from '@kit/ui/sonner';
import { cn } from '@kit/ui/utils';

/**
 * FILM-2203: episodes drag between seasons and Unsorted. The drop calls the
 * same action as the row's Move to season menu, the keyboard alternative.
 */
const UNSORTED = 'unsorted';

interface DragData {
  version: number;
  seasonId: string | null;
}

export function SeasonDragProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [, startMove] = useTransition();
  const sensors = useSensors(
    // A click on the handle is not a drag
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor),
  );

  function onDragEnd(event: DragEndEvent) {
    const data = event.active.data.current as DragData | undefined;
    const target = event.over?.id;

    if (!data || target === undefined) return;

    const seasonId = target === UNSORTED ? null : String(target);
    if (seasonId === data.seasonId) return;

    startMove(async () => {
      try {
        await unwrap(
          moveEpisodeToSeasonAction({
            episodeId: String(event.active.id),
            version: data.version,
            seasonId,
          }),
        );
        toast.success(seasonId ? 'Episode moved' : 'Episode moved to Unsorted');
        router.refresh();
      } catch (error) {
        toast.error(refusalMessage(error, 'Failed to move the episode'));
      }
    });
  }

  return (
    <DndContext sensors={sensors} onDragEnd={onDragEnd}>
      {children}
    </DndContext>
  );
}

/** A season (or Unsorted, seasonId null) an episode can be dropped on. */
export function DroppableSeason({
  seasonId,
  children,
}: {
  seasonId: string | null;
  children: React.ReactNode;
}) {
  const { isOver, setNodeRef } = useDroppable({ id: seasonId ?? UNSORTED });

  return (
    <div
      ref={setNodeRef}
      data-test={`drop-${seasonId ?? UNSORTED}`}
      className={cn(
        'rounded-xl transition-colors',
        isOver && 'bg-indigo-500/[0.06] ring-2 ring-indigo-500/40',
      )}
    >
      {children}
    </div>
  );
}

/**
 * Makes an episode draggable by a handle. Outside a SeasonDragProvider
 * (the flat list, with no seasons) it does nothing.
 */
export function useEpisodeDrag(episode: {
  id: string;
  version: number;
  seasonId: string | null;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({
      id: episode.id,
      data: {
        version: episode.version,
        seasonId: episode.seasonId,
      } satisfies DragData,
    });

  return {
    handleProps: { ref: setNodeRef, ...attributes, ...listeners },
    style: transform
      ? {
          transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`,
          zIndex: 50,
        }
      : undefined,
    isDragging,
  };
}
