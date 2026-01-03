'use client';

import { useCallback, useMemo, useState } from 'react';

import Image from 'next/image';

import {
    closestCenter,
    DndContext,
    type DragEndEvent,
    KeyboardSensor,
    PointerSensor,
    useSensor,
    useSensors,
} from '@dnd-kit/core';
import {
    arrayMove,
    horizontalListSortingStrategy,
    SortableContext,
    useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Film, GripVertical, Play, Volume2, VolumeX } from 'lucide-react';

import type { Shot } from '@kit/episodes/types';
import { cn } from '@kit/ui/utils';

interface VideoTrackProps {
    shots: Shot[];
    currentShotIndex: number;
    pixelsPerSecond: number;
    leftPadding?: number;
    onShotClick: (index: number) => void;
    onShotsReorder?: (newOrder: Shot[]) => void;
    isMuted?: boolean;
    onMuteToggle?: () => void;
}

interface TimelineShot extends Shot {
    startTime: number;
    endTime: number;
}

// Separate sortable clip component
function SortableVideoClip({
    shot,
    index,
    leftPx,
    widthPx,
    isActive,
    onShotClick,
}: {
    shot: TimelineShot;
    index: number;
    leftPx: number;
    widthPx: number;
    isActive: boolean;
    onShotClick: (index: number) => void;
}) {
    const {
        attributes,
        listeners,
        setNodeRef,
        transform,
        transition,
        isDragging,
    } = useSortable({ id: shot.id });

    const style = {
        transform: CSS.Transform.toString(transform),
        transition,
        left: `${leftPx}px`,
        width: `${widthPx}px`,
        zIndex: isDragging ? 50 : isActive ? 20 : 10,
    };

    return (
        <div
            ref={setNodeRef}
            style={style}
            className={cn(
                'group absolute top-1 h-[72px] overflow-hidden rounded-md border transition-all',
                isDragging && 'opacity-70 shadow-xl ring-2 ring-blue-500',
                isActive
                    ? 'border-indigo-500 shadow-lg ring-2 ring-indigo-500/30'
                    : 'border-gray-300 bg-gray-200 hover:border-indigo-400 hover:shadow-md dark:border-gray-600 dark:bg-gray-700',
            )}
            {...attributes}
        >
            <div className="relative h-full w-full flex">
                {/* Drag handle */}
                <div
                    {...listeners}
                    className="absolute left-0 top-0 bottom-0 w-6 flex items-center justify-center bg-black/20 cursor-grab z-20 hover:bg-black/40"
                >
                    <GripVertical className="h-3.5 w-3.5 text-white" />
                </div>

                {/* Thumbnail */}
                <div className="flex-1 relative" onClick={() => onShotClick(index)}>
                    {shot.thumbnailUrl ? (
                        <Image
                            src={shot.thumbnailUrl}
                            alt={`Shot ${shot.shotNumber}`}
                            fill
                            className="object-cover"
                        />
                    ) : (
                        <div className="flex h-full items-center justify-center bg-gray-200 dark:bg-gray-700">
                            <Film className="h-4 w-4 text-gray-400" />
                        </div>
                    )}

                    {/* Shot number badge */}
                    <div className="absolute top-0.5 left-6 rounded bg-black/70 px-1.5 py-0.5 text-[9px] font-semibold text-white">
                        {shot.sceneNumber}.{shot.shotNumber}
                    </div>

                    {/* Duration badge */}
                    <div className="absolute right-0.5 bottom-0.5 rounded bg-black/70 px-1.5 py-0.5 text-[9px] text-white">
                        {shot.duration || 5}s
                    </div>

                    {/* Active play indicator */}
                    {isActive && (
                        <div className="absolute inset-0 flex items-center justify-center bg-indigo-600/20">
                            <div className="flex h-5 w-5 items-center justify-center rounded-full bg-white shadow">
                                <Play className="ml-0.5 h-2.5 w-2.5 text-indigo-600" />
                            </div>
                        </div>
                    )}
                </div>

                {/* Right resize handle (visual only for now) */}
                <div className="absolute right-0 top-0 bottom-0 w-2 cursor-ew-resize bg-transparent hover:bg-white/30 z-20" />
            </div>
        </div>
    );
}

export function VideoTrack({
    shots,
    currentShotIndex,
    pixelsPerSecond,
    leftPadding = 120,
    onShotClick,
    onShotsReorder,
    isMuted = false,
    onMuteToggle,
}: VideoTrackProps) {
    const sensors = useSensors(
        useSensor(PointerSensor, {
            activationConstraint: {
                distance: 5, // 5px movement before drag starts
            },
        }),
        useSensor(KeyboardSensor)
    );

    const timelineShots: TimelineShot[] = useMemo(() => {
        let cumulativeTime = 0;
        return shots.map((shot) => {
            const startTime = cumulativeTime;
            const duration = shot.duration || 5;
            const endTime = startTime + duration;
            cumulativeTime = endTime;
            return { ...shot, startTime, endTime };
        });
    }, [shots]);

    const shotIds = useMemo(() => shots.map(s => s.id), [shots]);

    const handleDragEnd = useCallback((event: DragEndEvent) => {
        const { active, over } = event;
        if (!over || active.id === over.id) return;

        const oldIndex = shots.findIndex(s => s.id === active.id);
        const newIndex = shots.findIndex(s => s.id === over.id);

        if (oldIndex !== -1 && newIndex !== -1) {
            const newOrder = arrayMove(shots, oldIndex, newIndex);
            onShotsReorder?.(newOrder);
        }
    }, [shots, onShotsReorder]);

    if (shots.length === 0) {
        return (
            <div className="flex h-20 items-center">
                {/* Track label */}
                <div
                    className="flex h-full shrink-0 items-center border-r border-gray-200 bg-gray-50 px-3 dark:border-gray-700 dark:bg-gray-800/50"
                    style={{ width: `${leftPadding}px` }}
                >
                    <div className="flex items-center gap-2">
                        <div className="flex h-6 w-6 items-center justify-center rounded bg-indigo-100 dark:bg-indigo-900/50">
                            <Film className="h-3.5 w-3.5 text-indigo-600 dark:text-indigo-400" />
                        </div>
                        <span className="text-xs font-medium text-gray-600 dark:text-gray-300">
                            Video
                        </span>
                    </div>
                </div>
                {/* Empty state */}
                <div className="flex flex-1 items-center justify-center text-gray-400">
                    <span className="text-xs">No shots available</span>
                </div>
            </div>
        );
    }

    return (
        <div className="flex h-20">
            {/* Track label - fixed left */}
            <div
                data-track-label
                className="z-10 flex h-full shrink-0 flex-col justify-center border-r border-gray-200 bg-gray-50 px-3 dark:border-gray-700 dark:bg-gray-800/50"
                style={{ width: `${leftPadding}px` }}
            >
                <div className="flex items-center gap-2">
                    <div className="flex h-6 w-6 items-center justify-center rounded bg-indigo-100 dark:bg-indigo-900/50">
                        <Film className="h-3.5 w-3.5 text-indigo-600 dark:text-indigo-400" />
                    </div>
                    <div className="flex-1">
                        <p className="text-xs font-medium text-gray-700 dark:text-gray-200">
                            Video
                        </p>
                        <p className="text-[10px] text-gray-400">{shots.length} shots</p>
                    </div>
                    {/* Mute toggle */}
                    {onMuteToggle && (
                        <button
                            onClick={onMuteToggle}
                            className={cn(
                                'rounded p-1 transition-colors',
                                isMuted
                                    ? 'bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400'
                                    : 'hover:bg-gray-200 text-gray-500 dark:hover:bg-gray-600'
                            )}
                            title={isMuted ? 'Unmute video audio' : 'Mute video audio'}
                        >
                            {isMuted ? (
                                <VolumeX className="h-3.5 w-3.5" />
                            ) : (
                                <Volume2 className="h-3.5 w-3.5" />
                            )}
                        </button>
                    )}
                </div>
            </div>

            {/* Shots container with DnD */}
            <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={handleDragEnd}
            >
                <SortableContext items={shotIds} strategy={horizontalListSortingStrategy}>
                    <div className="relative flex-1">
                        {timelineShots.map((shot, index) => {
                            const leftPx = shot.startTime * pixelsPerSecond;
                            const widthPx = Math.max(
                                (shot.endTime - shot.startTime) * pixelsPerSecond - 4,
                                80,
                            );
                            const isActive = currentShotIndex === index;

                            return (
                                <SortableVideoClip
                                    key={shot.id}
                                    shot={shot}
                                    index={index}
                                    leftPx={leftPx}
                                    widthPx={widthPx}
                                    isActive={isActive}
                                    onShotClick={onShotClick}
                                />
                            );
                        })}
                    </div>
                </SortableContext>
            </DndContext>
        </div>
    );
}
