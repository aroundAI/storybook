'use client';

import { useMemo } from 'react';

import { Minus, Plus } from 'lucide-react';

import type { CharacterAsset, DialogueLine } from '@kit/audio-generation/lib';
import type { Shot } from '@kit/episodes/types';
import { Button } from '@kit/ui/button';

import { DialogueTrack } from './dialogue-track';
import { MusicTrack } from './music-track';
import { Playhead } from './playhead';
import { TimelineRuler } from './timeline-ruler';
import { VideoTrack } from './video-track';

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

interface TimelinePanelProps {
    shots: Shot[];
    currentShotIndex: number;
    currentTime: number;
    totalDuration: number;
    pixelsPerSecond: number;
    onShotClick: (index: number) => void;
    onZoomIn: () => void;
    onZoomOut: () => void;
    onTimelineClick?: (time: number) => void;
    // Audio data
    dialogueLines?: DialogueLine[];
    characters?: CharacterAsset[];
    musicTracks?: MusicTrackData[];
    isAudioLoading?: boolean;
}

const TRACK_LEFT_PADDING = 120;

export function TimelinePanel({
    shots,
    currentShotIndex,
    currentTime,
    totalDuration,
    pixelsPerSecond,
    onShotClick,
    onZoomIn,
    onZoomOut,
    onTimelineClick,
    dialogueLines = [],
    characters = [],
    musicTracks = [],
    isAudioLoading = false,
}: TimelinePanelProps) {
    const timelineWidth = useMemo(() => {
        return Math.max(
            totalDuration * pixelsPerSecond + TRACK_LEFT_PADDING + 100,
            1000,
        );
    }, [totalDuration, pixelsPerSecond]);

    const handleTimelineClick = (e: React.MouseEvent<HTMLDivElement>) => {
        if (!onTimelineClick) return;
        const target = e.target as HTMLElement;
        if (target.closest('[data-track-label]')) return;

        const rect = e.currentTarget.getBoundingClientRect();
        const x = e.clientX - rect.left - TRACK_LEFT_PADDING;
        if (x < 0) return;
        const time = Math.max(0, x / pixelsPerSecond);
        onTimelineClick(time);
    };

    const handlePlayMusicTrack = (track: MusicTrackData) => {
        if (track.fileUrl) {
            const audio = new Audio(track.fileUrl);
            audio.play();
        }
    };

    return (
        <div className="flex h-full flex-col bg-white dark:bg-gray-900">
            {/* Timeline Header */}
            <div className="flex shrink-0 items-center justify-between border-b border-gray-200 bg-gray-50/80 px-4 py-2 backdrop-blur-sm dark:border-gray-700 dark:bg-gray-800/80">
                <div className="flex items-center gap-4">
                    <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-200">
                        Timeline
                    </h3>
                    <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-500 dark:bg-gray-700 dark:text-gray-400">
                        {shots.length} shots • {formatTime(totalDuration)}
                    </span>
                </div>

                {/* Zoom Controls */}
                <div className="flex items-center gap-1 rounded-lg border border-gray-200 bg-white p-1 dark:border-gray-600 dark:bg-gray-800">
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={onZoomOut}
                        className="h-6 w-6 p-0"
                        title="Zoom out"
                    >
                        <Minus className="h-3 w-3" />
                    </Button>
                    <span className="w-12 text-center text-[10px] text-gray-500 dark:text-gray-400">
                        {pixelsPerSecond}px/s
                    </span>
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={onZoomIn}
                        className="h-6 w-6 p-0"
                        title="Zoom in"
                    >
                        <Plus className="h-3 w-3" />
                    </Button>
                </div>
            </div>

            {/* Scrollable Timeline Area */}
            <div className="relative flex-1 overflow-auto">
                <div
                    className="relative min-h-full"
                    style={{ width: `${timelineWidth}px` }}
                    onClick={handleTimelineClick}
                >
                    {/* Time Ruler */}
                    <TimelineRuler
                        totalDuration={totalDuration}
                        pixelsPerSecond={pixelsPerSecond}
                        leftPadding={TRACK_LEFT_PADDING}
                    />

                    {/* Playhead - spans all tracks */}
                    <Playhead
                        currentTime={currentTime}
                        pixelsPerSecond={pixelsPerSecond}
                        leftPadding={TRACK_LEFT_PADDING}
                    />

                    {/* Tracks */}
                    <div className="relative">
                        {/* Video Track */}
                        <div className="border-b border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-900">
                            <VideoTrack
                                shots={shots}
                                currentShotIndex={currentShotIndex}
                                pixelsPerSecond={pixelsPerSecond}
                                leftPadding={TRACK_LEFT_PADDING}
                                onShotClick={onShotClick}
                            />
                        </div>

                        {/* Dialogue Track */}
                        <DialogueTrack
                            dialogueLines={dialogueLines}
                            characters={characters}
                            pixelsPerSecond={pixelsPerSecond}
                            leftPadding={TRACK_LEFT_PADDING}
                            isLoading={isAudioLoading}
                        />

                        {/* Music Track */}
                        <MusicTrack
                            tracks={musicTracks}
                            pixelsPerSecond={pixelsPerSecond}
                            leftPadding={TRACK_LEFT_PADDING}
                            isLoading={isAudioLoading}
                            onPlayTrack={handlePlayMusicTrack}
                        />
                    </div>
                </div>
            </div>
        </div>
    );
}

function formatTime(seconds: number): string {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
}
