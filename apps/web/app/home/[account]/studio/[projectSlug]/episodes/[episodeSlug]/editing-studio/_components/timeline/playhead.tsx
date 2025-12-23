'use client';

interface PlayheadProps {
    currentTime: number;
    pixelsPerSecond: number;
    leftPadding?: number;
}

export function Playhead({
    currentTime,
    pixelsPerSecond,
    leftPadding = 120,
}: PlayheadProps) {
    const leftPosition = leftPadding + currentTime * pixelsPerSecond;

    return (
        <div
            className="pointer-events-none absolute top-8 bottom-0 z-30 w-0.5 bg-red-500"
            style={{ left: `${leftPosition}px` }}
        >
            {/* Playhead handle */}
            <div className="absolute -top-2 left-1/2 -translate-x-1/2">
                <div className="h-0 w-0 border-x-4 border-t-6 border-x-transparent border-t-red-500" />
            </div>
        </div>
    );
}
