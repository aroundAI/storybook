'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { Clock, Scissors, RotateCcw, Check } from 'lucide-react';

import type { Shot } from '@kit/episodes/types';
import { Button } from '@kit/ui/button';
import { cn } from '@kit/ui/utils';

interface ClipInspectorProps {
    shot: Shot;
    onTrimChange: (inPoint: number, outPoint: number) => void;
    onSave: () => void;
    isSaving?: boolean;
}

/**
 * Format seconds to MM:SS.mmm (with milliseconds)
 */
function formatTimecode(seconds: number): string {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    const ms = Math.round((seconds % 1) * 1000);
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}.${ms.toString().padStart(3, '0')}`;
}

/**
 * Parse timecode string to seconds
 */
function parseTimecode(timecode: string): number | null {
    const match = timecode.match(/^(\d+):(\d+)(?:\.(\d+))?$/);
    if (!match) return null;
    const [, mins, secs, ms = '0'] = match;
    return parseInt(mins!) * 60 + parseInt(secs!) + parseInt(ms.padEnd(3, '0')) / 1000;
}

/**
 * ClipInspector - Frame-accurate trimming UI for video clips
 * 
 * Features:
 * - Visual waveform/thumbnail scrubber
 * - In/Out point sliders with frame-accurate control
 * - Duration display (calculated from in/out)
 * - "Reset to Full" button
 * - "Fit to Shot Duration" button
 */
export function ClipInspector({
    shot,
    onTrimChange,
    onSave,
    isSaving = false,
}: ClipInspectorProps) {
    const videoRef = useRef<HTMLVideoElement>(null);

    // Source video duration (detected from video element)
    const [sourceDuration, setSourceDuration] = useState<number>(shot.sourceDuration ?? 0);

    // Current trim points
    const [inPoint, setInPoint] = useState<number>(shot.trimInPoint ?? 0);
    const [outPoint, setOutPoint] = useState<number>(shot.trimOutPoint ?? (shot.sourceDuration ?? shot.duration ?? 5));

    // Effective duration based on trim
    const effectiveDuration = outPoint - inPoint;

    // Shot's expected duration
    const expectedDuration = shot.duration ?? 5;

    // Whether clip is longer than shot duration (auto-clip candidate)
    const isOverlong = effectiveDuration > expectedDuration;

    // Handle video metadata load to get actual duration
    const handleLoadedMetadata = useCallback(() => {
        if (videoRef.current) {
            const duration = videoRef.current.duration;
            setSourceDuration(duration);

            // If no trim points set, default out-point to video duration
            if (shot.trimOutPoint === null || shot.trimOutPoint === undefined) {
                setOutPoint(duration);
            }
        }
    }, [shot.trimOutPoint]);

    // Update parent when trim points change
    useEffect(() => {
        onTrimChange(inPoint, outPoint);
    }, [inPoint, outPoint, onTrimChange]);

    // Seek video preview to current position
    const seekToTime = useCallback((time: number) => {
        if (videoRef.current) {
            videoRef.current.currentTime = time;
        }
    }, []);

    // Handle in-point slider change
    const handleInPointChange = useCallback((value: number) => {
        const newInPoint = Math.min(value, outPoint - 0.033); // At least 1 frame
        setInPoint(newInPoint);
        seekToTime(newInPoint);
    }, [outPoint, seekToTime]);

    // Handle out-point slider change
    const handleOutPointChange = useCallback((value: number) => {
        const newOutPoint = Math.max(value, inPoint + 0.033); // At least 1 frame
        setOutPoint(newOutPoint);
        seekToTime(newOutPoint);
    }, [inPoint, seekToTime]);

    // Reset to full video
    const handleReset = useCallback(() => {
        setInPoint(0);
        setOutPoint(sourceDuration);
        seekToTime(0);
    }, [sourceDuration, seekToTime]);

    // Fit to shot duration (auto-clip first N seconds)
    const handleFitToShot = useCallback(() => {
        setInPoint(0);
        setOutPoint(Math.min(expectedDuration, sourceDuration));
        seekToTime(0);
    }, [expectedDuration, sourceDuration, seekToTime]);

    if (!shot.videoUrl) {
        return (
            <div className="p-4 text-center text-gray-500 dark:text-gray-400">
                No video to trim
            </div>
        );
    }

    return (
        <div className="flex flex-col gap-4 p-4 bg-gray-50 dark:bg-gray-800/50 rounded-lg border border-gray-200 dark:border-gray-700">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <Scissors className="h-4 w-4 text-gray-500" />
                    <h3 className="font-medium text-gray-900 dark:text-white">
                        Clip Trimming
                    </h3>
                </div>
                <div className="flex items-center gap-2">
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={handleReset}
                        title="Reset to full video"
                    >
                        <RotateCcw className="h-3.5 w-3.5 mr-1" />
                        Reset
                    </Button>
                    {isOverlong && (
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={handleFitToShot}
                            className="text-orange-600 border-orange-300 hover:bg-orange-50"
                            title={`Trim to first ${expectedDuration}s to match shot duration`}
                        >
                            Fit to Shot ({expectedDuration}s)
                        </Button>
                    )}
                </div>
            </div>

            {/* Video Preview (small) */}
            <div className="relative aspect-video w-full max-w-[280px] mx-auto bg-black rounded-lg overflow-hidden">
                <video
                    ref={videoRef}
                    src={shot.videoUrl}
                    className="w-full h-full object-contain"
                    muted
                    onLoadedMetadata={handleLoadedMetadata}
                />
            </div>

            {/* Timeline Scrubber with In/Out handles */}
            <div className="relative h-12 bg-gray-200 dark:bg-gray-700 rounded-lg">
                {/* Full video background */}
                <div className="absolute inset-0 rounded-lg overflow-hidden">
                    <div className="h-full bg-gray-300 dark:bg-gray-600" />
                </div>

                {/* Selected region */}
                <div
                    className="absolute top-0 bottom-0 bg-blue-500/30 border-l-2 border-r-2 border-blue-500"
                    style={{
                        left: `${(inPoint / sourceDuration) * 100}%`,
                        width: `${((outPoint - inPoint) / sourceDuration) * 100}%`,
                    }}
                />

                {/* In-point slider */}
                <input
                    type="range"
                    min={0}
                    max={sourceDuration}
                    step={0.033} // ~30fps precision
                    value={inPoint}
                    onChange={(e) => handleInPointChange(parseFloat(e.target.value))}
                    className="absolute top-0 left-0 w-full h-full opacity-0 cursor-ew-resize"
                    style={{ zIndex: 10 }}
                />

                {/* In/Out point handles */}
                <div
                    className="absolute top-0 bottom-0 w-1 bg-green-500 cursor-ew-resize"
                    style={{ left: `${(inPoint / sourceDuration) * 100}%` }}
                    title="In Point"
                />
                <div
                    className="absolute top-0 bottom-0 w-1 bg-red-500 cursor-ew-resize"
                    style={{ left: `${(outPoint / sourceDuration) * 100}%` }}
                    title="Out Point"
                />
            </div>

            {/* Timecode Display */}
            <div className="grid grid-cols-3 gap-4 text-sm">
                <div className="text-center">
                    <div className="text-gray-500 dark:text-gray-400 text-xs mb-1">In Point</div>
                    <div className="font-mono text-green-600 dark:text-green-400">
                        {formatTimecode(inPoint)}
                    </div>
                </div>
                <div className="text-center">
                    <div className="text-gray-500 dark:text-gray-400 text-xs mb-1">Duration</div>
                    <div className={cn(
                        "font-mono",
                        isOverlong ? "text-orange-600 dark:text-orange-400" : "text-gray-900 dark:text-white"
                    )}>
                        {formatTimecode(effectiveDuration)}
                        {isOverlong && (
                            <span className="ml-1 text-xs">(expected: {expectedDuration}s)</span>
                        )}
                    </div>
                </div>
                <div className="text-center">
                    <div className="text-gray-500 dark:text-gray-400 text-xs mb-1">Out Point</div>
                    <div className="font-mono text-red-600 dark:text-red-400">
                        {formatTimecode(outPoint)}
                    </div>
                </div>
            </div>

            {/* Source Info */}
            <div className="flex items-center justify-between text-xs text-gray-500 dark:text-gray-400">
                <div className="flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    Source: {formatTimecode(sourceDuration)}
                </div>
                <div>
                    Shot duration: {expectedDuration}s
                </div>
            </div>

            {/* Save Button */}
            <Button
                onClick={onSave}
                disabled={isSaving}
                className="w-full"
            >
                {isSaving ? 'Saving...' : (
                    <>
                        <Check className="h-4 w-4 mr-2" />
                        Save Trim Points
                    </>
                )}
            </Button>
        </div>
    );
}
