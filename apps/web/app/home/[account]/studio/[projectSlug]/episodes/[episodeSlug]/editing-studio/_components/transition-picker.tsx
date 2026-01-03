'use client';

import { useState, useCallback } from 'react';

import {
    ArrowDown,
    ArrowLeft,
    ArrowRight,
    ArrowUp,
    Blend,
    CircleDot,
    Layers,
    Scissors,
    X,
} from 'lucide-react';

import { Button } from '@kit/ui/button';
import { cn } from '@kit/ui/utils';

import type { TransitionType, TransitionParameters } from '@kit/episodes/lib';
import { TRANSITION_PRESETS, getTransitionPreset } from '@kit/episodes/lib';

interface TransitionPickerProps {
    currentType: TransitionType;
    currentDuration: number;
    currentParameters?: TransitionParameters;
    onSelect: (type: TransitionType, duration: number, parameters?: TransitionParameters) => void;
    onClose: () => void;
}

const ICON_MAP: Record<string, React.ElementType> = {
    Scissors,
    CircleDot,
    Blend,
    Layers,
    ArrowLeft,
    ArrowRight,
    ArrowUp,
    ArrowDown,
};

/**
 * TransitionPicker - UI for selecting transition type and duration
 * 
 * Shows grid of transition presets with:
 * - Visual icons for each type
 * - Duration slider
 * - Color picker (for fade)
 */
export function TransitionPicker({
    currentType,
    currentDuration,
    currentParameters = {},
    onSelect,
    onClose,
}: TransitionPickerProps) {
    const [selectedType, setSelectedType] = useState<TransitionType>(currentType);
    const [duration, setDuration] = useState(currentDuration);
    const [fadeColor, setFadeColor] = useState(currentParameters?.fadeColor ?? '#000000');

    const selectedPreset = getTransitionPreset(selectedType);

    const handleTypeSelect = useCallback((type: TransitionType) => {
        setSelectedType(type);
        const preset = getTransitionPreset(type);
        if (preset) {
            setDuration(preset.defaultDuration);
        }
    }, []);

    const handleApply = useCallback(() => {
        const parameters: TransitionParameters = {};
        if (selectedPreset?.supportsColor) {
            parameters.fadeColor = fadeColor;
        }
        onSelect(selectedType, duration, parameters);
    }, [selectedType, duration, fadeColor, selectedPreset, onSelect]);

    return (
        <div className="w-80 rounded-lg border border-gray-200 bg-white p-4 shadow-lg dark:border-gray-700 dark:bg-gray-800">
            {/* Header */}
            <div className="mb-4 flex items-center justify-between">
                <h3 className="text-sm font-semibold text-gray-900 dark:text-white">
                    Select Transition
                </h3>
                <button
                    onClick={onClose}
                    className="rounded-md p-1 hover:bg-gray-100 dark:hover:bg-gray-700"
                >
                    <X className="h-4 w-4 text-gray-500" />
                </button>
            </div>

            {/* Transition Grid */}
            <div className="mb-4 grid grid-cols-4 gap-2">
                {TRANSITION_PRESETS.map((preset) => {
                    const Icon = ICON_MAP[preset.icon] ?? Scissors;
                    const isSelected = selectedType === preset.type;

                    return (
                        <button
                            key={preset.type}
                            onClick={() => handleTypeSelect(preset.type)}
                            className={cn(
                                'flex flex-col items-center gap-1 rounded-lg border p-2 transition-all',
                                isSelected
                                    ? 'border-blue-500 bg-blue-50 dark:border-blue-400 dark:bg-blue-900/30'
                                    : 'border-gray-200 hover:border-gray-300 dark:border-gray-600 dark:hover:border-gray-500',
                            )}
                            title={preset.description}
                        >
                            <Icon
                                className={cn(
                                    'h-5 w-5',
                                    isSelected
                                        ? 'text-blue-600 dark:text-blue-400'
                                        : 'text-gray-500 dark:text-gray-400',
                                )}
                            />
                            <span
                                className={cn(
                                    'text-[10px] font-medium',
                                    isSelected
                                        ? 'text-blue-700 dark:text-blue-300'
                                        : 'text-gray-600 dark:text-gray-400',
                                )}
                            >
                                {preset.name}
                            </span>
                        </button>
                    );
                })}
            </div>

            {/* Duration Slider (only for non-cut transitions) */}
            {selectedPreset && selectedPreset.type !== 'cut' && (
                <div className="mb-4">
                    <div className="mb-1 flex items-center justify-between">
                        <span className="text-xs font-medium text-gray-700 dark:text-gray-300">
                            Duration
                        </span>
                        <span className="text-xs text-gray-500">
                            {duration.toFixed(2)}s
                        </span>
                    </div>
                    <input
                        type="range"
                        min={selectedPreset.minDuration}
                        max={selectedPreset.maxDuration}
                        step={0.05}
                        value={duration}
                        onChange={(e) => setDuration(parseFloat(e.target.value))}
                        className="w-full"
                    />
                    <div className="mt-1 flex justify-between text-[10px] text-gray-400">
                        <span>{selectedPreset.minDuration}s</span>
                        <span>{selectedPreset.maxDuration}s</span>
                    </div>
                </div>
            )}

            {/* Fade Color (only for fade transition) */}
            {selectedPreset?.supportsColor && (
                <div className="mb-4">
                    <div className="mb-1 flex items-center justify-between">
                        <span className="text-xs font-medium text-gray-700 dark:text-gray-300">
                            Fade Color
                        </span>
                    </div>
                    <div className="flex items-center gap-2">
                        <input
                            type="color"
                            value={fadeColor}
                            onChange={(e) => setFadeColor(e.target.value)}
                            className="h-8 w-12 cursor-pointer rounded border border-gray-300"
                        />
                        <span className="text-xs text-gray-500">{fadeColor}</span>
                    </div>
                </div>
            )}

            {/* Description */}
            {selectedPreset && (
                <p className="mb-4 text-xs text-gray-500 dark:text-gray-400">
                    {selectedPreset.description}
                </p>
            )}

            {/* Actions */}
            <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={onClose} className="flex-1">
                    Cancel
                </Button>
                <Button size="sm" onClick={handleApply} className="flex-1">
                    Apply
                </Button>
            </div>
        </div>
    );
}
