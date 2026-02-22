'use client';

/**
 * Playhead — red vertical line with triangle indicator.
 *
 * Positioned based on `playheadMs` × zoom.
 * Draggable for scrubbing — mouse down on handle, move, mouse up.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import type { Dispatch } from 'react';
import type { EditAction } from '../../state/types';

const PLAYHEAD_COLOR = '#ef4444'; // red-500

interface PlayheadProps {
    playheadMs: number;
    zoom: number; // px per second
    containerRef: React.RefObject<HTMLDivElement | null>;
    dispatch: Dispatch<EditAction>;
}

export function Playhead({ playheadMs, zoom, containerRef, dispatch }: PlayheadProps) {
    const [isDragging, setIsDragging] = useState(false);
    const dragStartRef = useRef<{ startX: number; startMs: number } | null>(null);

    const leftPx = (playheadMs / 1000) * zoom;

    const handleMouseDown = useCallback((e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragging(true);
        dragStartRef.current = { startX: e.clientX, startMs: playheadMs };
    }, [playheadMs]);

    useEffect(() => {
        if (!isDragging) return;

        const handleMouseMove = (e: MouseEvent) => {
            if (!containerRef.current || !dragStartRef.current) return;
            const deltaX = e.clientX - dragStartRef.current.startX;
            const deltaMs = (deltaX / zoom) * 1000;
            const newMs = Math.max(0, Math.round(dragStartRef.current.startMs + deltaMs));
            dispatch({ type: 'SET_PLAYHEAD', payload: { ms: newMs } });
        };

        const handleMouseUp = () => {
            setIsDragging(false);
            dragStartRef.current = null;
        };

        window.addEventListener('mousemove', handleMouseMove);
        window.addEventListener('mouseup', handleMouseUp);

        return () => {
            window.removeEventListener('mousemove', handleMouseMove);
            window.removeEventListener('mouseup', handleMouseUp);
        };
    }, [isDragging, zoom, containerRef, dispatch]);

    return (
        <div
            className="pointer-events-none absolute top-0 z-20"
            style={{ left: `${leftPx}px`, height: '100%' }}
        >
            {/* Triangle handle (pointer-events enabled) */}
            <div
                className="pointer-events-auto absolute -left-[5px] top-0 cursor-col-resize"
                onMouseDown={handleMouseDown}
            >
                {/* Triangle using CSS borders */}
                <div
                    style={{
                        width: 0,
                        height: 0,
                        borderLeft: '5px solid transparent',
                        borderRight: '5px solid transparent',
                        borderTop: `8px solid ${PLAYHEAD_COLOR}`,
                    }}
                />
            </div>

            {/* Vertical line */}
            <div
                className="absolute left-0 top-0 w-px"
                style={{ height: '100%', backgroundColor: PLAYHEAD_COLOR }}
            />
        </div>
    );
}
