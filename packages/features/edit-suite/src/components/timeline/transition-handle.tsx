'use client';

/**
 * TransitionHandle — clickable widget between adjacent clips on a track.
 *
 * Renders a small icon in the gap/overlap zone between two clips.
 * Click opens the TransitionPicker to set/change the transition type and duration.
 */

import { useState, useMemo, type Dispatch } from 'react';

import type { EditClip, EditTransition } from '../../lib/types';
import type { TransitionType } from '../../lib/schemas';
import type { EditAction } from '../../state/types';
import { TransitionPicker } from './transition-picker';

// ──────────────────────────────────────────
// Constants
// ──────────────────────────────────────────

const HANDLE_WIDTH_PX = 24;

const TRANSITION_ICONS: Record<TransitionType, string> = {
    cut: '✂',
    crossfade: '✕',
    fade_black: '◼',
    fade_white: '◻',
    dissolve: '◈',
    wipe_left: '◀',
    wipe_right: '▶',
};

// ──────────────────────────────────────────
// Component
// ──────────────────────────────────────────

interface TransitionHandleProps {
    /** The clip on the left */
    fromClip: EditClip;
    /** The clip on the right */
    toClip: EditClip;
    /** Existing transition (if any) */
    transition: EditTransition | null;
    /** Current zoom level (px per second) */
    zoom: number;
    dispatch: Dispatch<EditAction>;
}

export function TransitionHandle({
    fromClip,
    toClip,
    transition,
    zoom,
    dispatch,
}: TransitionHandleProps) {
    const [isPickerOpen, setIsPickerOpen] = useState(false);

    // Position the handle at the junction of the two clips
    const { leftPx, visible } = useMemo(() => {
        // Calculate the meeting point
        const fromEndPx = (fromClip.endMs / 1000) * zoom;
        const toStartPx = (toClip.startMs / 1000) * zoom;

        // Position at the midpoint of the overlap/gap
        const centerPx = (fromEndPx + toStartPx) / 2;
        const left = centerPx - HANDLE_WIDTH_PX / 2;

        // Only show if clips are close enough (within 2 seconds)
        const gapMs = toClip.startMs - fromClip.endMs;
        const show = gapMs <= 2000 && gapMs >= -5000; // Allow overlaps up to 5s

        return { leftPx: left, visible: show };
    }, [fromClip.endMs, toClip.startMs, zoom]);

    if (!visible) return null;

    const currentType = transition?.type ?? 'cut';

    const handleApply = (type: TransitionType, durationMs: number) => {
        if (transition) {
            if (type === 'cut') {
                // Remove transition
                dispatch({
                    type: 'REMOVE_TRANSITION',
                    payload: { transitionId: transition.id },
                });
            } else {
                // Update existing
                dispatch({
                    type: 'UPDATE_TRANSITION',
                    payload: {
                        transitionId: transition.id,
                        changes: { type, durationMs },
                    },
                });
            }
        } else if (type !== 'cut') {
            // Create new transition
            dispatch({
                type: 'ADD_TRANSITION',
                payload: {
                    transition: {
                        id: crypto.randomUUID(),
                        fromClipId: fromClip.id,
                        toClipId: toClip.id,
                        type,
                        durationMs,
                        params: {},
                        createdAt: new Date().toISOString(),
                    },
                },
            });
        }
        setIsPickerOpen(false);
    };

    return (
        <div
            className="absolute top-0 z-20 flex h-full items-center justify-center"
            style={{ left: `${leftPx}px`, width: `${HANDLE_WIDTH_PX}px` }}
        >
            {/* Handle button */}
            <button
                className={`flex h-5 w-5 items-center justify-center rounded-full text-[9px] transition-all ${currentType !== 'cut'
                        ? 'bg-violet-500/80 text-white shadow-lg shadow-violet-500/30'
                        : 'bg-zinc-700/60 text-zinc-400 opacity-0 hover:opacity-100'
                    } group-hover:opacity-100 hover:scale-110`}
                onClick={() => setIsPickerOpen(!isPickerOpen)}
                title={`Transition: ${currentType}`}
            >
                {TRANSITION_ICONS[currentType]}
            </button>

            {/* Picker dropdown */}
            {isPickerOpen && (
                <div className="absolute top-full z-30 mt-1">
                    <TransitionPicker
                        currentType={currentType}
                        currentDurationMs={transition?.durationMs ?? 500}
                        onApply={handleApply}
                        onClose={() => setIsPickerOpen(false)}
                    />
                </div>
            )}
        </div>
    );
}
