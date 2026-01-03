'use client';

import { Volume2, Zap } from 'lucide-react';

import { Skeleton } from '@kit/ui/skeleton';
import { cn } from '@kit/ui/utils';

interface SfxTrackData {
    id: string;
    name: string | null;
    fileUrl: string | null;
    durationSeconds: number | null;
    timelineStartSeconds: number;
    status: 'pending' | 'processing' | 'completed' | 'failed';
}

interface SfxTrackProps {
    tracks: SfxTrackData[];
    pixelsPerSecond: number;
    leftPadding: number;
    isLoading?: boolean;
    onPlayTrack?: (track: SfxTrackData) => void;
}

/**
 * SfxTrack - Timeline visualization for sound effects
 * Shows SFX clips at their timeline positions with waveform-style icons
 */
export function SfxTrack({
    tracks,
    pixelsPerSecond,
    leftPadding,
    isLoading = false,
    onPlayTrack,
}: SfxTrackProps) {
    if (isLoading) {
        return (
            <div className="flex h-12 items-center border-b border-gray-200 bg-orange-50/50 dark:border-gray-700 dark:bg-orange-900/10">
                <div
                    data-track-label
                    className="flex h-full w-[120px] shrink-0 items-center gap-2 border-r border-gray-200 bg-white px-3 dark:border-gray-700 dark:bg-gray-800"
                >
                    <Zap className="h-3.5 w-3.5 text-orange-500" />
                    <span className="text-xs font-medium text-gray-600 dark:text-gray-300">
                        SFX
                    </span>
                </div>
                <div className="flex-1 px-4">
                    <Skeleton className="h-6 w-32" />
                </div>
            </div>
        );
    }

    const completedTracks = tracks.filter(t => t.status === 'completed' && t.fileUrl);

    const handlePlayTrack = (track: SfxTrackData, e: React.MouseEvent) => {
        e.stopPropagation();
        if (track.fileUrl && onPlayTrack) {
            onPlayTrack(track);
        }
    };

    return (
        <div className="relative flex h-12 border-b border-gray-200 bg-orange-50/30 dark:border-gray-700 dark:bg-orange-900/5">
            {/* Track Label */}
            <div
                data-track-label
                className="flex h-full w-[120px] shrink-0 items-center gap-2 border-r border-gray-200 bg-white px-3 dark:border-gray-700 dark:bg-gray-800"
            >
                <Zap className="h-3.5 w-3.5 text-orange-500" />
                <span className="text-xs font-medium text-gray-600 dark:text-gray-300">
                    SFX
                </span>
                <span className="ml-auto text-[10px] text-gray-400">
                    {completedTracks.length}
                </span>
            </div>

            {/* Track Content */}
            <div className="relative flex-1" style={{ paddingLeft: leftPadding - 120 }}>
                {completedTracks.length === 0 ? (
                    <div className="flex h-full items-center px-4">
                        <span className="text-xs text-gray-400 dark:text-gray-500">
                            No SFX tracks
                        </span>
                    </div>
                ) : (
                    completedTracks.map((track) => {
                        const leftPx = track.timelineStartSeconds * pixelsPerSecond;
                        const widthPx = Math.max((track.durationSeconds ?? 1) * pixelsPerSecond, 40);

                        return (
                            <div
                                key={track.id}
                                className={cn(
                                    'absolute top-1 bottom-1 flex cursor-pointer items-center gap-1.5 rounded-md border px-2 transition-all hover:scale-[1.02]',
                                    'bg-orange-100 border-orange-300 dark:bg-orange-900/40 dark:border-orange-700',
                                )}
                                style={{
                                    left: `${leftPx}px`,
                                    width: `${widthPx}px`,
                                }}
                                onClick={(e) => handlePlayTrack(track, e)}
                                title={`Click to play: ${track.name ?? 'SFX'}`}
                            >
                                {/* Waveform icon */}
                                <div className="flex h-4 items-end gap-[1px]">
                                    <div className="w-0.5 h-1 bg-orange-500 rounded-full" />
                                    <div className="w-0.5 h-2 bg-orange-500 rounded-full" />
                                    <div className="w-0.5 h-3 bg-orange-500 rounded-full" />
                                    <div className="w-0.5 h-2 bg-orange-500 rounded-full" />
                                    <div className="w-0.5 h-1 bg-orange-500 rounded-full" />
                                </div>

                                {/* Name (if width allows) */}
                                {widthPx > 80 && (
                                    <span className="truncate text-[10px] font-medium text-orange-800 dark:text-orange-200">
                                        {track.name ?? 'SFX'}
                                    </span>
                                )}

                                {/* Play icon on hover */}
                                <Volume2 className="ml-auto h-3 w-3 text-orange-600 opacity-60" />
                            </div>
                        );
                    })
                )}
            </div>
        </div>
    );
}
