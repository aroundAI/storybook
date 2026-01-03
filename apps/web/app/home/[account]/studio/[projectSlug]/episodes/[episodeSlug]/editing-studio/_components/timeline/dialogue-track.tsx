'use client';

import { useMemo } from 'react';

import { Mic, Volume2, VolumeX } from 'lucide-react';

import type { CharacterAsset, DialogueLine } from '@kit/audio-generation/lib';
import { cn } from '@kit/ui/utils';

interface DialogueTrackProps {
    dialogueLines: DialogueLine[];
    characters: CharacterAsset[];
    pixelsPerSecond: number;
    leftPadding?: number;
    isLoading?: boolean;
    isMuted?: boolean;
    onMuteToggle?: () => void;
}

// Character color palette
const CHARACTER_COLORS = [
    { bg: 'bg-orange-200', border: 'border-orange-400', text: 'text-orange-800' },
    { bg: 'bg-purple-200', border: 'border-purple-400', text: 'text-purple-800' },
    { bg: 'bg-green-200', border: 'border-green-400', text: 'text-green-800' },
    { bg: 'bg-blue-200', border: 'border-blue-400', text: 'text-blue-800' },
    { bg: 'bg-pink-200', border: 'border-pink-400', text: 'text-pink-800' },
    { bg: 'bg-cyan-200', border: 'border-cyan-400', text: 'text-cyan-800' },
];

const WORDS_PER_MINUTE = 150;
const SECONDS_PER_WORD = 60 / WORDS_PER_MINUTE;

function estimateDuration(text: string | null | undefined): number {
    if (!text) return 1;
    const wordCount = text.split(/\s+/).length;
    return Math.max(1, wordCount * SECONDS_PER_WORD);
}

export function DialogueTrack({
    dialogueLines,
    characters,
    pixelsPerSecond,
    leftPadding = 120,
    isLoading = false,
    isMuted = false,
    onMuteToggle,
}: DialogueTrackProps) {
    // Map character IDs to colors
    const characterColorMap = useMemo(() => {
        const map: Record<string, (typeof CHARACTER_COLORS)[0]> = {};
        characters.forEach((char, i) => {
            map[char.id] = CHARACTER_COLORS[i % CHARACTER_COLORS.length]!;
        });
        return map;
    }, [characters]);

    // Map character IDs to names
    const characterNameMap = useMemo(() => {
        const map: Record<string, string> = {};
        characters.forEach((char) => {
            map[char.id] = char.name;
        });
        return map;
    }, [characters]);

    // Position dialogue lines on timeline
    const positionedDialogues = useMemo(() => {
        if (!dialogueLines.length) return [];

        return dialogueLines.map((d) => {
            const startTime = d.timelineStartSeconds ?? 0;
            const duration =
                d.generationMetadata?.durationSeconds ??
                d.estimatedDurationSeconds ??
                estimateDuration(d.text);

            return {
                ...d,
                startTime,
                duration,
                characterName: characterNameMap[d.characterAssetId ?? ''] ?? 'Unknown',
            };
        });
    }, [dialogueLines, characterNameMap]);

    const getCharacterColor = (characterAssetId: string | null) => {
        return (
            characterColorMap[characterAssetId ?? ''] ?? {
                bg: 'bg-gray-200',
                border: 'border-gray-400',
                text: 'text-gray-800',
            }
        );
    };

    return (
        <div className="flex h-14 border-b border-gray-200 dark:border-gray-700">
            {/* Track label */}
            <div
                data-track-label
                className="z-10 flex h-full shrink-0 items-center border-r border-gray-200 bg-gray-50 px-3 dark:border-gray-700 dark:bg-gray-800/50"
                style={{ width: `${leftPadding}px` }}
            >
                <div className="flex items-center gap-2 w-full">
                    <div className="flex h-5 w-5 items-center justify-center rounded bg-green-100 dark:bg-green-900/50">
                        <Mic className="h-3 w-3 text-green-600 dark:text-green-400" />
                    </div>
                    <div className="flex-1">
                        <p className="text-[11px] font-medium text-gray-700 dark:text-gray-200">
                            Dialogue
                        </p>
                        <p className="text-[9px] text-gray-400">
                            {dialogueLines.length} lines
                        </p>
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
                            title={isMuted ? 'Unmute dialogue' : 'Mute dialogue'}
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

            {/* Dialogue clips container */}
            <div className="relative flex-1 bg-gray-50/30 dark:bg-gray-800/20">
                {isLoading ? (
                    <div className="flex h-full items-center px-4">
                        <span className="text-[10px] text-gray-400">Loading...</span>
                    </div>
                ) : dialogueLines.length === 0 ? (
                    <div className="flex h-full items-center px-4">
                        <Volume2 className="mr-2 h-3 w-3 text-gray-300" />
                        <span className="text-[10px] text-gray-400">
                            No dialogue lines - generate in Audio Studio
                        </span>
                    </div>
                ) : (
                    positionedDialogues.map((dialogue) => {
                        const colors = getCharacterColor(dialogue.characterAssetId);
                        const leftPx = dialogue.startTime * pixelsPerSecond;
                        const widthPx = Math.max(dialogue.duration * pixelsPerSecond, 40);

                        return (
                            <div
                                key={dialogue.id}
                                className={cn(
                                    'absolute top-1 h-12 overflow-hidden rounded border px-1.5 py-0.5',
                                    colors.bg,
                                    colors.border,
                                    dialogue.status === 'completed'
                                        ? 'opacity-100'
                                        : 'opacity-60',
                                )}
                                style={{ left: `${leftPx}px`, width: `${widthPx}px` }}
                                title={`${dialogue.characterName}: ${dialogue.text}`}
                            >
                                <p
                                    className={cn(
                                        'truncate text-[9px] font-medium',
                                        colors.text,
                                    )}
                                >
                                    {dialogue.characterName}
                                </p>
                                <p className="truncate text-[8px] text-gray-600">
                                    {dialogue.text}
                                </p>
                            </div>
                        );
                    })
                )}
            </div>
        </div>
    );
}
