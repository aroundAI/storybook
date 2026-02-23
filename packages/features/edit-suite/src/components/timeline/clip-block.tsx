'use client';

/**
 * ClipBlock — interactive clip rendered on the timeline.
 *
 * Positioned absolutely within the clip lane based on startMs/endMs × zoom.
 * Supports:
 * - Click to select, shift+click for multi-select
 * - Drag to move horizontally (with snap-to-edges, snap-to-playhead)
 * - Edge drag to trim (left = adjust start, right = adjust end)
 * - Alt+Drag to duplicate
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import type { Dispatch } from 'react';

import type { EditClip } from '../../lib/types';
import type { EditAction } from '../../state/types';
import { useEditSuite } from '../edit-suite-provider';
import { AddClipCommand, MoveClipCommand, TrimClipCommand } from '../../state/edit-commands';

// ──────────────────────────────────────────
// Constants
// ──────────────────────────────────────────

const EDGE_HIT_ZONE_PX = 8;      // Width of trim edge handles
const MIN_CLIP_DURATION_MS = 100; // Minimum clip duration
const SNAP_THRESHOLD_PX = 10;    // Distance for snap engagement

// ──────────────────────────────────────────
// Types
// ──────────────────────────────────────────

type DragMode = 'none' | 'move' | 'trim-left' | 'trim-right';

interface ClipBlockProps {
    clip: EditClip;
    zoom: number; // px per second
    isSelected: boolean;
    colorClass: string;
    dispatch: Dispatch<EditAction>;
    /** All clips for snap targets */
    allClips?: EditClip[];
    /** Current playhead ms for snap-to-playhead */
    playheadMs?: number;
}

// ──────────────────────────────────────────
// Component
// ──────────────────────────────────────────

export function ClipBlock({
    clip,
    zoom,
    isSelected,
    colorClass,
    dispatch,
    allClips = [],
    playheadMs = 0,
}: ClipBlockProps) {
    const { executeCommand, recordCommand } = useEditSuite();
    const blockRef = useRef<HTMLDivElement>(null);
    const [dragMode, setDragMode] = useState<DragMode>('none');
    const [snapLineX, setSnapLineX] = useState<number | null>(null);

    // Track latest clip state via ref for stale-closure-safe access in mouseup
    const clipRef = useRef(clip);
    useEffect(() => {
        clipRef.current = clip;
    }, [clip]);

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

    // ── Click / select ──

    const handleClick = useCallback((e: React.MouseEvent) => {
        e.stopPropagation();

        if (e.shiftKey) {
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
    }, [clip.id, dispatch]);

    // ── Determine drag mode from mouse position ──

    const getDragMode = useCallback((e: React.MouseEvent): DragMode => {
        const rect = blockRef.current?.getBoundingClientRect();
        if (!rect) return 'move';

        const localX = e.clientX - rect.left;

        if (localX <= EDGE_HIT_ZONE_PX) return 'trim-left';
        if (localX >= rect.width - EDGE_HIT_ZONE_PX) return 'trim-right';

        return 'move';
    }, []);

    // ── Snap logic ──

    const findSnapTarget = useCallback((ms: number, excludeClipId: string): { snappedMs: number; snapPx: number | null } => {
        const msPerPx = 1000 / zoom;
        const thresholdMs = SNAP_THRESHOLD_PX * msPerPx;

        // Snap targets: other clip edges + playhead
        const targets: number[] = [playheadMs];
        for (const c of allClips) {
            if (c.id === excludeClipId) continue;
            targets.push(c.startMs, c.endMs);
        }

        let bestTarget = ms;
        let bestDist = Infinity;

        for (const target of targets) {
            const dist = Math.abs(ms - target);
            if (dist < thresholdMs && dist < bestDist) {
                bestDist = dist;
                bestTarget = target;
            }
        }

        const snapped = bestDist < thresholdMs;
        return {
            snappedMs: snapped ? bestTarget : ms,
            snapPx: snapped ? (bestTarget / 1000) * zoom : null,
        };
    }, [zoom, playheadMs, allClips]);

    // ── Mouse down — start drag ──

    const handleMouseDown = useCallback((e: React.MouseEvent) => {
        if (e.button !== 0) return; // Left click only
        e.stopPropagation();
        e.preventDefault();

        const mode = getDragMode(e);
        setDragMode(mode);

        // Select the clip if not already selected
        if (!isSelected) {
            dispatch({
                type: 'SELECT_CLIP',
                payload: { clipId: clip.id, addToSelection: e.shiftKey },
            });
        }

        const startX = e.clientX;
        const origStartMs = clip.startMs;
        const origEndMs = clip.endMs;
        const origInPointMs = clip.inPointMs;
        const origOutPointMs = clip.outPointMs;
        const isAltDuplicate = e.altKey;

        // Create a duplicate if Alt is held
        let duplicateId: string | null = null;
        if (isAltDuplicate && mode === 'move') {
            duplicateId = crypto.randomUUID();
            const dupClip: EditClip = {
                ...clip,
                id: duplicateId,
            };
            executeCommand(new AddClipCommand(dupClip));
        }

        const handleMouseMove = (moveE: MouseEvent) => {
            const deltaX = moveE.clientX - startX;
            const deltaMs = (deltaX / zoom) * 1000;

            if (mode === 'move') {
                const rawStartMs = origStartMs + deltaMs;
                const rawEndMs = origEndMs + deltaMs;

                // Snap start edge
                const { snappedMs: snappedStart, snapPx } = findSnapTarget(rawStartMs, clip.id);
                const offset = snappedStart - rawStartMs;
                const newStartMs = Math.max(0, snappedStart);
                const newEndMs = rawEndMs + offset;

                setSnapLineX(snapPx);

                const targetId = isAltDuplicate && duplicateId ? duplicateId : clip.id;
                dispatch({
                    type: 'MOVE_CLIP',
                    payload: { clipId: targetId, startMs: newStartMs, endMs: newEndMs },
                });
            } else if (mode === 'trim-left') {
                const rawStartMs = origStartMs + deltaMs;
                const { snappedMs: snappedStart, snapPx } = findSnapTarget(rawStartMs, clip.id);
                const newStartMs = Math.max(0, Math.min(snappedStart, origEndMs - MIN_CLIP_DURATION_MS));
                const trimDelta = newStartMs - origStartMs;

                setSnapLineX(snapPx);

                dispatch({
                    type: 'UPDATE_CLIP',
                    payload: {
                        clipId: clip.id,
                        changes: {
                            startMs: newStartMs,
                            inPointMs: origInPointMs + trimDelta,
                        },
                    },
                });
            } else if (mode === 'trim-right') {
                const rawEndMs = origEndMs + deltaMs;
                const { snappedMs: snappedEnd, snapPx } = findSnapTarget(rawEndMs, clip.id);
                const newEndMs = Math.max(origStartMs + MIN_CLIP_DURATION_MS, snappedEnd);
                const trimDelta = newEndMs - origEndMs;

                setSnapLineX(snapPx);

                dispatch({
                    type: 'UPDATE_CLIP',
                    payload: {
                        clipId: clip.id,
                        changes: {
                            endMs: newEndMs,
                            outPointMs: origOutPointMs + trimDelta,
                        },
                    },
                });
            }
        };

        const handleMouseUp = () => {
            setDragMode('none');
            setSnapLineX(null);

            window.removeEventListener('mousemove', handleMouseMove);
            window.removeEventListener('mouseup', handleMouseUp);

            // Use ref for latest clip state (avoids stale closure)
            const currentClip = clipRef.current;

            // Record undo command (state was already applied via dispatches during drag)
            if (mode === 'move' && !isAltDuplicate) {
                if (currentClip.startMs !== origStartMs || currentClip.endMs !== origEndMs) {
                    recordCommand(new MoveClipCommand(
                        currentClip.id,
                        origStartMs,
                        origEndMs,
                        currentClip.startMs,
                        currentClip.endMs,
                        currentClip.trackId,
                        currentClip.trackId,
                    ));
                }
            }
            if (mode === 'trim-left' || mode === 'trim-right') {
                if (currentClip.startMs !== origStartMs || currentClip.endMs !== origEndMs) {
                    recordCommand(new TrimClipCommand(
                        currentClip.id,
                        { startMs: origStartMs, endMs: origEndMs, inPointMs: origInPointMs, outPointMs: origOutPointMs },
                        { startMs: currentClip.startMs, endMs: currentClip.endMs, inPointMs: currentClip.inPointMs, outPointMs: currentClip.outPointMs },
                    ));
                }
            }
        };

        window.addEventListener('mousemove', handleMouseMove);
        window.addEventListener('mouseup', handleMouseUp);
    }, [clip, zoom, isSelected, dispatch, getDragMode, findSnapTarget, executeCommand, recordCommand]);

    // ── Cursor style ──

    const getCursor = useCallback((e: React.MouseEvent): string => {
        const mode = getDragMode(e);
        if (mode === 'trim-left' || mode === 'trim-right') return 'col-resize';
        return 'grab';
    }, [getDragMode]);

    const [cursor, setCursor] = useState('grab');

    const handleMouseMoveLocal = useCallback((e: React.MouseEvent) => {
        if (dragMode !== 'none') return;
        setCursor(getCursor(e));
    }, [dragMode, getCursor]);

    return (
        <>
            <div
                ref={blockRef}
                className={`absolute top-1 flex items-center overflow-hidden rounded-[3px] border text-[10px] text-white/90 transition-shadow ${colorClass} ${isSelected
                    ? 'border-violet-400 shadow-[0_0_0_1px_rgba(139,92,246,0.5)] z-10'
                    : 'border-white/10 hover:border-white/25'
                    } ${dragMode !== 'none' ? 'opacity-90' : ''}`}
                style={{
                    left: `${leftPx}px`,
                    width: `${widthPx}px`,
                    height: 'calc(100% - 8px)',
                    cursor: dragMode !== 'none' ? (dragMode === 'move' ? 'grabbing' : 'col-resize') : cursor,
                }}
                onClick={handleClick}
                onMouseDown={handleMouseDown}
                onMouseMove={handleMouseMoveLocal}
                role="option"
                aria-selected={isSelected}
                tabIndex={0}
            >
                {/* Left trim handle indicator */}
                <div className="absolute left-0 top-0 h-full w-1 bg-white/0 transition-colors hover:bg-white/30" />

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

                {/* Right trim handle indicator */}
                <div className="absolute right-0 top-0 h-full w-1 bg-white/0 transition-colors hover:bg-white/30" />
            </div>

            {/* Snap indicator line */}
            {snapLineX !== null && (
                <div
                    className="pointer-events-none absolute top-0 z-20 h-full w-px bg-cyan-400/60"
                    style={{ left: `${snapLineX}px` }}
                />
            )}
        </>
    );
}
