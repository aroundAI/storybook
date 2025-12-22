'use client';

import { useMemo } from 'react';

interface TimelineRulerProps {
    totalDuration: number;
    pixelsPerSecond: number;
    leftPadding?: number;
}

function formatTime(seconds: number): string {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
}

function getMarkerInterval(pps: number): number {
    if (pps >= 120) return 1;
    if (pps >= 60) return 5;
    if (pps >= 20) return 10;
    return 15;
}

export function TimelineRuler({
    totalDuration,
    pixelsPerSecond,
    leftPadding = 120,
}: TimelineRulerProps) {
    const { timeMarkers, timelineWidth } = useMemo(() => {
        const markerInterval = getMarkerInterval(pixelsPerSecond);
        const markers: number[] = [];
        for (let t = 0; t <= totalDuration; t += markerInterval) {
            markers.push(t);
        }
        const width = Math.max(totalDuration * pixelsPerSecond + leftPadding + 40, 800);
        return { timeMarkers: markers, timelineWidth: width };
    }, [totalDuration, pixelsPerSecond, leftPadding]);

    return (
        <div
            className="sticky top-0 z-10 flex h-8 items-end border-b border-gray-200 bg-gray-50 font-mono text-[10px] text-gray-400 select-none dark:border-gray-700 dark:bg-gray-900"
            style={{ width: `${timelineWidth}px`, minWidth: '100%' }}
        >
            <div
                className="relative h-full w-full pb-1"
                style={{ paddingLeft: leftPadding }}
            >
                {/* Time labels */}
                {timeMarkers.map((time) => (
                    <span
                        key={time}
                        className="absolute bottom-2 -translate-x-1/2"
                        style={{
                            left: `${leftPadding + time * pixelsPerSecond}px`,
                        }}
                    >
                        {formatTime(time)}
                    </span>
                ))}

                {/* Tick marks */}
                <div className="absolute bottom-0 left-0 h-1.5 w-full">
                    {timeMarkers.map((time) => (
                        <span
                            key={time}
                            className="absolute h-full w-px bg-gray-300 dark:bg-gray-600"
                            style={{
                                left: `${leftPadding + time * pixelsPerSecond}px`,
                            }}
                        />
                    ))}
                </div>
            </div>
        </div>
    );
}
