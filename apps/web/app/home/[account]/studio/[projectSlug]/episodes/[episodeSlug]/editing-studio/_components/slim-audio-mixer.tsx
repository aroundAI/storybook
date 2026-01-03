'use client';

import { useState } from 'react';

import { Volume2 } from 'lucide-react';

import type { CharacterAsset, DialogueLine } from '@kit/audio-generation/lib';
import { cn } from '@kit/ui/utils';

interface SlimAudioMixerProps {
    dialogueVolume: number;
    musicVolume: number;
    sfxVolume: number;
    onDialogueVolumeChange: (v: number) => void;
    onMusicVolumeChange: (v: number) => void;
    onSfxVolumeChange: (v: number) => void;
    className?: string;
}

/**
 * Slim horizontal audio mixer - fits in a single row
 */
export function SlimAudioMixer({
    dialogueVolume,
    musicVolume,
    sfxVolume,
    onDialogueVolumeChange,
    onMusicVolumeChange,
    onSfxVolumeChange,
    className,
}: SlimAudioMixerProps) {
    return (
        <div className={cn(
            'flex items-center gap-6 px-4 py-2 bg-gray-100/50 dark:bg-gray-800/50 border-t border-gray-200 dark:border-gray-700',
            className
        )}>
            <div className="flex items-center gap-1.5 text-gray-500 dark:text-gray-400">
                <Volume2 className="h-3.5 w-3.5" />
                <span className="text-xs font-medium">Mixer</span>
            </div>

            {/* Dialogue */}
            <div className="flex items-center gap-2">
                <span className="text-[10px] font-medium text-green-600 dark:text-green-400 w-12">Dialogue</span>
                <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.05}
                    value={dialogueVolume}
                    onChange={(e) => onDialogueVolumeChange(parseFloat(e.target.value))}
                    className="w-20 h-1 bg-green-200 rounded-full appearance-none cursor-pointer dark:bg-green-800 accent-green-500"
                />
                <span className="text-[10px] text-gray-500 w-6">{Math.round(dialogueVolume * 100)}%</span>
            </div>

            {/* Music */}
            <div className="flex items-center gap-2">
                <span className="text-[10px] font-medium text-purple-600 dark:text-purple-400 w-12">Music</span>
                <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.05}
                    value={musicVolume}
                    onChange={(e) => onMusicVolumeChange(parseFloat(e.target.value))}
                    className="w-20 h-1 bg-purple-200 rounded-full appearance-none cursor-pointer dark:bg-purple-800 accent-purple-500"
                />
                <span className="text-[10px] text-gray-500 w-6">{Math.round(musicVolume * 100)}%</span>
            </div>

            {/* SFX */}
            <div className="flex items-center gap-2">
                <span className="text-[10px] font-medium text-orange-600 dark:text-orange-400 w-12">SFX</span>
                <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.05}
                    value={sfxVolume}
                    onChange={(e) => onSfxVolumeChange(parseFloat(e.target.value))}
                    className="w-20 h-1 bg-orange-200 rounded-full appearance-none cursor-pointer dark:bg-orange-800 accent-orange-500"
                />
                <span className="text-[10px] text-gray-500 w-6">{Math.round(sfxVolume * 100)}%</span>
            </div>
        </div>
    );
}
