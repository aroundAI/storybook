'use client';

import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef } from 'react';

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
    getEffectiveDuration: () => number;
}

/**
 * Get effective in-point for video (where playback starts)
 * Defaults to 0 if not set
 */
function getInPoint(shot: Shot): number {
    return shot.trimInPoint ?? 0;
}

/**
 * Get effective out-point for video (where playback ends)
 * Defaults to shot.duration if not set
 */
function getOutPoint(shot: Shot): number {
    return shot.trimOutPoint ?? shot.sourceDuration ?? shot.duration ?? 5;
}

/**
 * Get effective duration based on trim points
 */
function getEffectiveDuration(shot: Shot): number {
    return getOutPoint(shot) - getInPoint(shot);
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
        const hasInitializedRef = useRef(false);

        // Get trim points
        const inPoint = shot ? getInPoint(shot) : 0;
        const outPoint = shot ? getOutPoint(shot) : 0;

        // Initialize video position when shot changes
        useEffect(() => {
            if (videoRef.current && shot?.videoUrl) {
                hasInitializedRef.current = false;
            }
        }, [shot?.id, shot?.videoUrl]);

        // Handle video loaded - seek to in-point
        const handleLoadedMetadata = useCallback(() => {
            if (videoRef.current && !hasInitializedRef.current) {
                videoRef.current.currentTime = inPoint;
                hasInitializedRef.current = true;
            }
        }, [inPoint]);

        useImperativeHandle(ref, () => ({
            play: () => videoRef.current?.play(),
            pause: () => videoRef.current?.pause(),
            seek: (time: number) => {
                if (videoRef.current) {
                    // Clamp seek within trim bounds
                    const clampedTime = Math.min(Math.max(time + inPoint, inPoint), outPoint);
                    videoRef.current.currentTime = clampedTime;
                }
            },
            getCurrentTime: () => {
                if (!videoRef.current) return 0;
                // Return time relative to in-point
                return Math.max(0, videoRef.current.currentTime - inPoint);
            },
            getEffectiveDuration: () => shot ? getEffectiveDuration(shot) : 0,
        }), [inPoint, outPoint, shot]);

        const handleTimeUpdate = useCallback(() => {
            if (!videoRef.current) return;

            const currentTime = videoRef.current.currentTime;

            // Check if we've reached the out-point
            if (currentTime >= outPoint) {
                videoRef.current.pause();
                videoRef.current.currentTime = outPoint;
                onEnded();
                return;
            }

            // Report time relative to in-point
            onTimeUpdate(currentTime - inPoint);
        }, [inPoint, outPoint, onTimeUpdate, onEnded]);

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
                {/* 
                  Video element - VIDEO AUDIO IS ALWAYS MUTED
                  Audio comes from synced dialogue/music/sfx tracks instead.
                  The isMuted prop controls overall audio (affects audio mixer).
                */}
                <video
                    ref={videoRef}
                    src={shot.videoUrl}
                    poster={shot.thumbnailUrl ?? undefined}
                    className="max-h-full max-w-full object-contain"
                    autoPlay={isPlaying}
                    muted // Always mute video audio - we use mixed audio tracks instead
                    onEnded={onEnded}
                    onTimeUpdate={handleTimeUpdate}
                    onLoadedMetadata={handleLoadedMetadata}
                />

                {/* Shot Info Overlay */}
                <div className="absolute top-3 left-3 rounded-md bg-black/70 px-2 py-1 text-xs font-medium text-white">
                    Shot {shot.sceneNumber}.{shot.shotNumber}
                </div>

                {/* Trim Info (if trimmed) */}
                {(shot.trimInPoint !== null || shot.trimOutPoint !== null) && (
                    <div className="absolute top-3 left-24 rounded-md bg-orange-500/80 px-2 py-1 text-xs font-medium text-white">
                        Trimmed
                    </div>
                )}

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
