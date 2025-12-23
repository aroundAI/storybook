'use client';

import { forwardRef, useCallback, useImperativeHandle, useRef } from 'react';

import { Film, Maximize2, Play } from 'lucide-react';

import type { Shot } from '@kit/episodes/types';
import { cn } from '@kit/ui/utils';

interface VideoPreviewProps {
    shot: Shot | null;
    isPlaying: boolean;
    isMuted: boolean;
    onPlayPause: () => void;
    onEnded: () => void;
    onTimeUpdate: (currentTime: number) => void;
    className?: string;
}

export interface VideoPreviewHandle {
    play: () => void;
    pause: () => void;
    seek: (time: number) => void;
    getCurrentTime: () => number;
}

export const VideoPreview = forwardRef<VideoPreviewHandle, VideoPreviewProps>(
    function VideoPreview(
        {
            shot,
            isPlaying,
            isMuted,
            onPlayPause,
            onEnded,
            onTimeUpdate,
            className,
        },
        ref,
    ) {
        const videoRef = useRef<HTMLVideoElement>(null);

        useImperativeHandle(ref, () => ({
            play: () => videoRef.current?.play(),
            pause: () => videoRef.current?.pause(),
            seek: (time: number) => {
                if (videoRef.current) {
                    videoRef.current.currentTime = time;
                }
            },
            getCurrentTime: () => videoRef.current?.currentTime ?? 0,
        }));

        const handleTimeUpdate = useCallback(() => {
            if (videoRef.current) {
                onTimeUpdate(videoRef.current.currentTime);
            }
        }, [onTimeUpdate]);

        const handleFullscreen = useCallback(() => {
            videoRef.current?.requestFullscreen?.();
        }, []);

        if (!shot?.videoUrl) {
            return (
                <div
                    className={cn(
                        'flex items-center justify-center rounded-xl bg-gray-100 dark:bg-gray-800',
                        className,
                    )}
                >
                    <div className="text-center">
                        <Film className="mx-auto h-12 w-12 text-gray-300 dark:text-gray-600" />
                        <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
                            No video available
                        </p>
                    </div>
                </div>
            );
        }

        return (
            <div
                className={cn(
                    'relative flex items-center justify-center overflow-hidden rounded-xl bg-gray-900',
                    className,
                )}
            >
                {/* Video element - constrained within container */}
                <video
                    ref={videoRef}
                    src={shot.videoUrl}
                    poster={shot.thumbnailUrl ?? undefined}
                    className="max-h-full max-w-full object-contain"
                    autoPlay={isPlaying}
                    muted={isMuted}
                    onEnded={onEnded}
                    onTimeUpdate={handleTimeUpdate}
                />

                {/* Shot Info Overlay */}
                <div className="absolute top-3 left-3 rounded-md bg-black/70 px-2 py-1 text-xs font-medium text-white">
                    Shot {shot.sceneNumber}.{shot.shotNumber}
                </div>

                {/* Fullscreen Button */}
                <button
                    onClick={handleFullscreen}
                    className="absolute top-3 right-3 rounded-md bg-black/70 p-1.5 text-white transition-colors hover:bg-black/90"
                >
                    <Maximize2 className="h-4 w-4" />
                </button>

                {/* Center Play Button (when paused) */}
                {!isPlaying && (
                    <button
                        onClick={onPlayPause}
                        className="absolute inset-0 flex items-center justify-center"
                    >
                        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-white/90 shadow-lg transition-transform hover:scale-110">
                            <Play className="ml-1 h-6 w-6 text-gray-900" />
                        </div>
                    </button>
                )}
            </div>
        );
    },
);
