'use client';

import type { LucideIcon } from 'lucide-react';
import { Lock, Volume2, VolumeX } from 'lucide-react';

import { cn } from '@kit/ui/utils';
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from '@kit/ui/tooltip';

interface TrackHeaderProps {
    /** Track icon component */
    icon: LucideIcon;
    /** Track icon color class */
    iconColorClass: string;
    /** Track icon background class */
    iconBgClass: string;
    /** Track name */
    name: string;
    /** Number of items in track */
    count: number;
    /** Track width (should match TRACK_LEFT_PADDING) */
    width?: number;
    /** Track background color class */
    bgClass?: string;
    /** Is track muted */
    isMuted?: boolean;
    /** Is track locked */
    isLocked?: boolean;
    /** Mute toggle callback */
    onMuteToggle?: () => void;
    /** Lock toggle callback */
    onLockToggle?: () => void;
}

/**
 * TrackHeader - Shared component for timeline track headers
 * 
 * Features:
 * - Icon with color coding
 * - Track name and item count
 * - Mute toggle with keyboard hint
 * - Lock toggle (prevents editing)
 * 
 * Pro-style design matching DaVinci Resolve
 */
export function TrackHeader({
    icon: Icon,
    iconColorClass,
    iconBgClass,
    name,
    count,
    width = 120,
    bgClass = 'bg-gray-50 dark:bg-gray-800/50',
    isMuted = false,
    isLocked = false,
    onMuteToggle,
    onLockToggle,
}: TrackHeaderProps) {
    return (
        <TooltipProvider>
            <div
                data-track-label
                className={cn(
                    'z-10 flex h-full shrink-0 items-center border-r border-gray-200 px-2 dark:border-gray-700',
                    bgClass
                )}
                style={{ width: `${width}px` }}
            >
                {/* Icon */}
                <div className={cn('flex h-6 w-6 items-center justify-center rounded', iconBgClass)}>
                    <Icon className={cn('h-3.5 w-3.5', iconColorClass)} />
                </div>

                {/* Name and count */}
                <div className="ml-2 flex-1 min-w-0">
                    <p className="text-xs font-medium text-gray-700 dark:text-gray-200 truncate">
                        {name}
                    </p>
                    <p className="text-[9px] text-gray-400">
                        {count} {count === 1 ? 'clip' : 'clips'}
                    </p>
                </div>

                {/* Controls */}
                <div className="flex items-center gap-0.5">
                    {/* Mute toggle */}
                    {onMuteToggle && (
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <button
                                    onClick={onMuteToggle}
                                    className={cn(
                                        'rounded p-1 transition-colors',
                                        isMuted
                                            ? 'bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400'
                                            : 'hover:bg-gray-200 text-gray-400 dark:hover:bg-gray-600'
                                    )}
                                >
                                    {isMuted ? (
                                        <VolumeX className="h-3.5 w-3.5" />
                                    ) : (
                                        <Volume2 className="h-3.5 w-3.5" />
                                    )}
                                </button>
                            </TooltipTrigger>
                            <TooltipContent side="top">
                                <span>{isMuted ? 'Unmute' : 'Mute'} (M)</span>
                            </TooltipContent>
                        </Tooltip>
                    )}

                    {/* Lock toggle */}
                    {onLockToggle && (
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <button
                                    onClick={onLockToggle}
                                    className={cn(
                                        'rounded p-1 transition-colors',
                                        isLocked
                                            ? 'bg-amber-100 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400'
                                            : 'hover:bg-gray-200 text-gray-400 dark:hover:bg-gray-600'
                                    )}
                                >
                                    <Lock className="h-3.5 w-3.5" />
                                </button>
                            </TooltipTrigger>
                            <TooltipContent side="top">
                                <span>{isLocked ? 'Unlock' : 'Lock'} (L)</span>
                            </TooltipContent>
                        </Tooltip>
                    )}
                </div>
            </div>
        </TooltipProvider>
    );
}
