'use client';

import { useEffect, useState } from 'react';

import { Check, Cloud, CloudOff, HelpCircle, Keyboard, Loader2 } from 'lucide-react';

import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from '@kit/ui/tooltip';
import { cn } from '@kit/ui/utils';

type SaveState = 'saved' | 'saving' | 'offline' | 'error';

interface StatusBarProps {
    /** Current save state */
    saveState?: SaveState;
    /** Seconds since last save (for "Saved Xs ago") */
    lastSavedSecondsAgo?: number;
    /** Render progress percentage (0-100) */
    renderProgress?: number | null;
    /** Is rendering in progress */
    isRendering?: boolean;
    /** Callback when help is clicked */
    onHelpClick?: () => void;
    /** Callback when shortcuts is clicked */
    onShortcutsClick?: () => void;
}

/**
 * StatusBar - Bottom status bar for Editing Studio
 * 
 * Shows:
 * - Save state (Saved / Saving / Offline)
 * - Render progress
 * - Help and Keyboard shortcuts buttons
 */
export function StatusBar({
    saveState = 'saved',
    lastSavedSecondsAgo = 0,
    renderProgress = null,
    isRendering = false,
    onHelpClick,
    onShortcutsClick,
}: StatusBarProps) {
    const [displayTime, setDisplayTime] = useState(lastSavedSecondsAgo);

    // Increment time display every second when saved
    useEffect(() => {
        if (saveState !== 'saved') return;

        const interval = setInterval(() => {
            setDisplayTime((t) => t + 1);
        }, 1000);

        return () => clearInterval(interval);
    }, [saveState]);

    // Reset timer when saveState changes
    useEffect(() => {
        setDisplayTime(lastSavedSecondsAgo);
    }, [lastSavedSecondsAgo, saveState]);

    const formatTimeAgo = (seconds: number): string => {
        if (seconds < 5) return 'just now';
        if (seconds < 60) return `${seconds}s ago`;
        const mins = Math.floor(seconds / 60);
        return mins === 1 ? '1 min ago' : `${mins} mins ago`;
    };

    return (
        <TooltipProvider>
            <div className="flex h-7 items-center justify-between border-t border-gray-200 bg-gray-50 px-3 text-xs dark:border-gray-700 dark:bg-gray-800/50">
                {/* Left side: Save state and render progress */}
                <div className="flex items-center gap-4">
                    {/* Save state */}
                    <div className="flex items-center gap-1.5">
                        {saveState === 'saved' && (
                            <>
                                <Check className="h-3.5 w-3.5 text-emerald-500" />
                                <span className="text-gray-500 dark:text-gray-400">
                                    Saved {formatTimeAgo(displayTime)}
                                </span>
                            </>
                        )}
                        {saveState === 'saving' && (
                            <>
                                <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-500" />
                                <span className="text-gray-500 dark:text-gray-400">Saving...</span>
                            </>
                        )}
                        {saveState === 'offline' && (
                            <>
                                <CloudOff className="h-3.5 w-3.5 text-amber-500" />
                                <span className="text-amber-600 dark:text-amber-400">Offline</span>
                            </>
                        )}
                        {saveState === 'error' && (
                            <>
                                <Cloud className="h-3.5 w-3.5 text-red-500" />
                                <span className="text-red-600 dark:text-red-400">Save failed</span>
                            </>
                        )}
                    </div>

                    {/* Render progress */}
                    {isRendering && renderProgress !== null && (
                        <div className="flex items-center gap-2">
                            <div className="h-1.5 w-24 overflow-hidden rounded-full bg-gray-200 dark:bg-gray-600">
                                <div
                                    className="h-full bg-blue-500 transition-all duration-300"
                                    style={{ width: `${renderProgress}%` }}
                                />
                            </div>
                            <span className="text-gray-500 dark:text-gray-400">
                                Rendering {Math.round(renderProgress)}%
                            </span>
                        </div>
                    )}
                </div>

                {/* Right side: Help and Shortcuts */}
                <div className="flex items-center gap-1">
                    {/* Help */}
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <button
                                onClick={onHelpClick}
                                className="flex items-center gap-1 rounded px-2 py-1 text-gray-500 hover:bg-gray-200 dark:text-gray-400 dark:hover:bg-gray-700"
                            >
                                <HelpCircle className="h-3.5 w-3.5" />
                                <span>Help</span>
                            </button>
                        </TooltipTrigger>
                        <TooltipContent side="top">
                            <span>Open help (F1)</span>
                        </TooltipContent>
                    </Tooltip>

                    {/* Keyboard shortcuts */}
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <button
                                onClick={onShortcutsClick}
                                className="flex items-center gap-1 rounded px-2 py-1 text-gray-500 hover:bg-gray-200 dark:text-gray-400 dark:hover:bg-gray-700"
                            >
                                <Keyboard className="h-3.5 w-3.5" />
                                <span className="hidden sm:inline">Shortcuts</span>
                            </button>
                        </TooltipTrigger>
                        <TooltipContent side="top">
                            <span>Keyboard shortcuts (?)</span>
                        </TooltipContent>
                    </Tooltip>
                </div>
            </div>
        </TooltipProvider>
    );
}
