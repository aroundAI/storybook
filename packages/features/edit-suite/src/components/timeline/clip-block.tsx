'use client';

/**
 * ClipBlock — individual clip rendered on the timeline.
 *
 * Positioned absolutely within the clip lane based on startMs/endMs × zoom.
 * Click to select, shift+click for multi-select.
 * Shows clip name and duration.
 */

import type { EditClip } from '../../lib/types';
import type { EditAction } from '../../state/types';
import type { Dispatch } from 'react';

interface ClipBlockProps {
    clip: EditClip;
    zoom: number; // px per second
    isSelected: boolean;
    colorClass: string;
    dispatch: Dispatch<EditAction>;
}

export function ClipBlock({ clip, zoom, isSelected, colorClass, dispatch }: ClipBlockProps) {
    const leftPx = (clip.startMs / 1000) * zoom;
    const widthPx = Math.max(4, ((clip.endMs - clip.startMs) / 1000) * zoom);

    // Derive a display name from the clip's source
    const name = clip.sourceShotId
        ? 'Shot'
        : clip.sourceDialogueId
            ? 'Dialogue'
            : clip.sourceDubbedDialogueId
                ? 'Dubbed'
                : clip.sourceAudioTrackId
                    ? 'Audio'
                    : 'Clip';

    const durationMs = clip.endMs - clip.startMs;
    const durationLabel = durationMs >= 1000
        ? `${(durationMs / 1000).toFixed(1)}s`
        : `${durationMs}ms`;

    const handleClick = (e: React.MouseEvent) => {
        if (e.shiftKey) {
            // Multi-select: toggle this clip in selection
            dispatch({
                type: 'SELECT_CLIP',
                payload: { clipId: clip.id, addToSelection: true },
            });
        } else {
            dispatch({
                type: 'SELECT_CLIP',
                payload: { clipId: clip.id, addToSelection: false },
            });
        }
    };

    return (
        <div
            className={`absolute top-1 flex cursor-pointer items-center overflow-hidden rounded-[3px] border text-[10px] text-white/90 transition-shadow ${colorClass} ${isSelected
                    ? 'border-violet-400 shadow-[0_0_0_1px_rgba(139,92,246,0.5)] z-10'
                    : 'border-white/10 hover:border-white/25'
                }`}
            style={{
                left: `${leftPx}px`,
                width: `${widthPx}px`,
                height: 'calc(100% - 8px)',
            }}
            onClick={handleClick}
            role="option"
            aria-selected={isSelected}
            tabIndex={0}
        >
            {/* Clip content (only show if wide enough) */}
            {widthPx > 40 && (
                <span className="truncate px-1.5 py-0.5 font-medium">
                    {name}
                </span>
            )}
            {widthPx > 80 && (
                <span className="ml-auto flex-shrink-0 px-1 text-[9px] text-white/50">
                    {durationLabel}
                </span>
            )}
        </div>
    );
}
