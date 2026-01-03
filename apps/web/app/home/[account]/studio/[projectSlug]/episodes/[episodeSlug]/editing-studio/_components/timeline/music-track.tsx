'use client';

import { Loader2, Music, Play, Volume2, VolumeX } from 'lucide-react';

import { cn } from '@kit/ui/utils';

interface MusicTrackData {
    id: string;
    name: string | null;
    fileUrl: string | null;
    durationSeconds: number | null;
    timelineStartSeconds: number;
    status: 'pending' | 'processing' | 'completed' | 'failed';
    metadata: {
        sceneNumber?: number;
    } | null;
}

interface MusicTrackProps {
    tracks: MusicTrackData[];
    pixelsPerSecond: number;
    leftPadding?: number;
    isLoading?: boolean;
    onPlayTrack?: (track: MusicTrackData) => void;
    isMuted?: boolean;
    onMuteToggle?: () => void;
}

export function MusicTrack({
    tracks,
    pixelsPerSecond,
    leftPadding = 120,
    isLoading = false,
    onPlayTrack,
    isMuted = false,
    onMuteToggle,
}: MusicTrackProps) {
    return (
        <div className="flex h-16 border-b border-gray-200 bg-purple-50/30 dark:border-gray-700 dark:bg-purple-900/10">\n            <div
            data-track-label
            className="z-10 flex h-full shrink-0 items-center border-r border-gray-200 bg-gray-50 px-3 dark:border-gray-700 dark:bg-gray-800/50"
            style={{ width: `${leftPadding}px` }}
        >
            <div className="flex items-center gap-2 w-full">
                <div className="flex h-5 w-5 items-center justify-center rounded bg-purple-100 dark:bg-purple-900/50">
                    <Music className="h-3 w-3 text-purple-600 dark:text-purple-400" />
                </div>
                <div className="flex-1">
                    <p className="text-[11px] font-medium text-gray-700 dark:text-gray-200">
                        Music
                    </p>
                    <p className="text-[9px] text-gray-400">{tracks.length} tracks</p>
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
                        title={isMuted ? 'Unmute music' : 'Mute music'}
                    >
                        {isMuted ? (
                            <VolumeX className="h-3 w-3" />
                        ) : (
                            <Volume2 className="h-3 w-3" />
                        )}
                    </button>
                )}
            </div>
        </div>

            {/* Music clips container */}
            <div className="relative flex-1 bg-purple-50/20 dark:bg-purple-900/10">
                {isLoading ? (
                    <div className="flex h-full items-center px-4">
                        <span className="text-[10px] text-gray-400">Loading...</span>
                    </div>
                ) : tracks.length === 0 ? (
                    <div className="flex h-full items-center px-4">
                        <Music className="mr-2 h-3 w-3 text-gray-300" />
                        <span className="text-[10px] text-gray-400">
                            No music - generate in Audio Studio
                        </span>
                    </div>
                ) : (
                    tracks.map((track) => {
                        const leftPx = track.timelineStartSeconds * pixelsPerSecond;
                        const widthPx = track.durationSeconds
                            ? Math.max(track.durationSeconds * pixelsPerSecond, 60)
                            : 60;

                        return (
                            <div
                                key={track.id}
                                className={cn(
                                    'absolute top-1 flex h-12 items-center gap-1 overflow-hidden rounded border px-1.5',
                                    track.status === 'completed'
                                        ? 'border-purple-300 bg-purple-100 dark:border-purple-700 dark:bg-purple-900/40'
                                        : track.status === 'processing'
                                            ? 'border-blue-300 bg-blue-100 dark:border-blue-700 dark:bg-blue-900/40'
                                            : 'border-gray-300 bg-gray-100 dark:border-gray-600 dark:bg-gray-800',
                                )}
                                style={{ left: `${leftPx}px`, width: `${widthPx}px` }}
                                title={track.name ?? 'Music'}
                            >
                                {track.status === 'processing' ? (
                                    <Loader2 className="h-3 w-3 shrink-0 animate-spin text-blue-500" />
                                ) : track.status === 'completed' && onPlayTrack ? (
                                    <button
                                        onClick={() => onPlayTrack(track)}
                                        className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-purple-500 text-white hover:bg-purple-600"
                                    >
                                        <Play className="h-2.5 w-2.5" />
                                    </button>
                                ) : (
                                    <Music className="h-3 w-3 shrink-0 text-gray-400" />
                                )}
                                <div className="min-w-0 flex-1">
                                    <p className="truncate text-[9px] font-medium text-gray-700 dark:text-gray-200">
                                        {track.name ?? 'Music'}
                                    </p>
                                    <p className="text-[8px] text-gray-500">
                                        {track.metadata?.sceneNumber
                                            ? `Scene ${track.metadata.sceneNumber}`
                                            : ''}
                                    </p>
                                </div>
                            </div>
                        );
                    })
                )}
            </div>
        </div>
    );
}
