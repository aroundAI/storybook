'use client';

import { useMemo } from 'react';

import Image from 'next/image';

import { Film, Play } from 'lucide-react';

import type { Shot } from '@kit/episodes/types';
import { cn } from '@kit/ui/utils';

interface VideoTrackProps {
    shots: Shot[];
    currentShotIndex: number;
    pixelsPerSecond: number;
    leftPadding?: number;
    onShotClick: (index: number) => void;
}

interface TimelineShot extends Shot {
    startTime: number;
    endTime: number;
}

export function VideoTrack({
    shots,
    currentShotIndex,
    pixelsPerSecond,
    leftPadding = 120,
    onShotClick,
}: VideoTrackProps) {
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

    if (shots.length === 0) {
        return (
            <div className="flex h-16 items-center">
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
        <div className="flex h-16">
            {/* Track label - fixed left */}
            <div
                className="z-10 flex h-full shrink-0 items-center border-r border-gray-200 bg-gray-50 px-3 dark:border-gray-700 dark:bg-gray-800/50"
                style={{ width: `${leftPadding}px` }}
            >
                <div className="flex items-center gap-2">
                    <div className="flex h-6 w-6 items-center justify-center rounded bg-indigo-100 dark:bg-indigo-900/50">
                        <Film className="h-3.5 w-3.5 text-indigo-600 dark:text-indigo-400" />
                    </div>
                    <div>
                        <p className="text-xs font-medium text-gray-700 dark:text-gray-200">
                            Video
                        </p>
                        <p className="text-[10px] text-gray-400">{shots.length} shots</p>
                    </div>
                </div>
            </div>

            {/* Shots container */}
            <div className="relative flex-1">
                {timelineShots.map((shot, index) => {
                    const leftPx = shot.startTime * pixelsPerSecond;
                    const widthPx = Math.max(
                        (shot.endTime - shot.startTime) * pixelsPerSecond - 4,
                        80,
                    );
                    const isActive = currentShotIndex === index;

                    return (
                        <button
                            key={shot.id}
                            onClick={() => onShotClick(index)}
                            className={cn(
                                'absolute top-1 h-14 overflow-hidden rounded-md border transition-all hover:shadow-md',
                                isActive
                                    ? 'z-10 border-indigo-500 shadow-lg ring-2 ring-indigo-500/30'
                                    : 'border-gray-300 bg-gray-200 hover:border-indigo-400 dark:border-gray-600 dark:bg-gray-700',
                            )}
                            style={{ left: `${leftPx}px`, width: `${widthPx}px` }}
                        >
                            <div className="relative h-full w-full">
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
                                <div className="absolute top-0.5 left-0.5 rounded bg-black/70 px-1.5 py-0.5 text-[9px] font-semibold text-white">
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
                        </button>
                    );
                })}
            </div>
        </div>
    );
}
