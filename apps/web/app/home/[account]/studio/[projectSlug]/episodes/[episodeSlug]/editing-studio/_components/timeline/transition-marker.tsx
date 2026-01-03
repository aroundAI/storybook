'use client';

import { useState } from 'react';

import { Diamond, Scissors } from 'lucide-react';

import { cn } from '@kit/ui/utils';

import type { TransitionType, TransitionParameters } from '@kit/episodes/lib';
import { getTransitionPreset } from '@kit/episodes/lib';

interface TransitionMarkerProps {
    transitionType: TransitionType;
    durationSeconds: number;
    parameters?: TransitionParameters;
    pixelsPerSecond: number;
    position: number; // Timeline position in seconds (between shots)
    leftPadding: number;
    isSelected?: boolean;
    onClick?: () => void;
    onDoubleClick?: () => void;
}

/**
 * TransitionMarker - Visual marker for transitions between shots on timeline
 * 
 * Features:
 * - Diamond icon indicating transition point
 * - Color-coded by transition type
 * - Shows duration on hover
 * - Click to select, double-click to edit
 */
export function TransitionMarker({
    transitionType,
    durationSeconds,
    pixelsPerSecond,
    position,
    leftPadding,
    isSelected = false,
    onClick,
    onDoubleClick,
}: TransitionMarkerProps) {
    const [isHovered, setIsHovered] = useState(false);

    const preset = getTransitionPreset(transitionType);
    const leftPx = position * pixelsPerSecond + leftPadding;

    // Width represents the transition duration visually
    const widthPx = Math.max(durationSeconds * pixelsPerSecond, 16);

    // Color scheme by transition type
    const getColorClasses = () => {
        switch (transitionType) {
            case 'cut':
                return 'bg-gray-400/50 border-gray-500';
            case 'fade':
                return 'bg-purple-400/50 border-purple-500';
            case 'dissolve':
            case 'crossfade':
                return 'bg-blue-400/50 border-blue-500';
            case 'wipe_left':
            case 'wipe_right':
            case 'wipe_up':
            case 'wipe_down':
                return 'bg-green-400/50 border-green-500';
            default:
                return 'bg-gray-400/50 border-gray-500';
        }
    };

    // For cut transitions, just show a thin line
    if (transitionType === 'cut') {
        return (
            <div
                className={cn(
                    'absolute top-1/2 -translate-y-1/2 cursor-pointer transition-all',
                    isSelected && 'ring-2 ring-blue-400 ring-offset-1',
                )}
                style={{ left: `${leftPx - 6}px` }}
                onClick={onClick}
                onDoubleClick={onDoubleClick}
                onMouseEnter={() => setIsHovered(true)}
                onMouseLeave={() => setIsHovered(false)}
                title={`${preset?.name ?? 'Cut'} transition`}
            >
                <div className="flex h-6 w-3 items-center justify-center rounded border border-gray-400 bg-gray-200 dark:border-gray-500 dark:bg-gray-600">
                    <Scissors className="h-2. w-2.5 text-gray-600 dark:text-gray-300" />
                </div>
            </div>
        );
    }

    return (
        <div
            className={cn(
                'absolute top-1/2 -translate-y-1/2 cursor-pointer transition-all',
                isSelected && 'ring-2 ring-blue-400 ring-offset-1',
            )}
            style={{
                left: `${leftPx - widthPx / 2}px`,
                width: `${widthPx}px`,
            }}
            onClick={onClick}
            onDoubleClick={onDoubleClick}
            onMouseEnter={() => setIsHovered(true)}
            onMouseLeave={() => setIsHovered(false)}
        >
            {/* Transition bar */}
            <div
                className={cn(
                    'relative flex h-6 items-center justify-center rounded border transition-all',
                    getColorClasses(),
                    isHovered && 'scale-110 shadow-md',
                )}
            >
                {/* Diamond icon */}
                <Diamond className="h-3 w-3 text-white" />

                {/* Duration label on hover */}
                {(isHovered || isSelected) && (
                    <div className="absolute -top-6 left-1/2 -translate-x-1/2 whitespace-nowrap rounded bg-black/80 px-1.5 py-0.5 text-[10px] text-white">
                        {preset?.name} • {durationSeconds.toFixed(2)}s
                    </div>
                )}
            </div>
        </div>
    );
}
