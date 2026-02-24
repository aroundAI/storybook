'use client';

/**
 * useVisibleClips — virtual scrolling hook for the timeline.
 *
 * Instead of rendering every clip in every track, this hook
 * calculates which clips are visible within the current scroll
 * viewport and returns only those. This dramatically reduces
 * DOM nodes for projects with hundreds of clips.
 *
 * Uses a buffer zone (BUFFER_PX) on each side to prevent
 * popping during fast scrolling.
 */

import { useMemo, useState, useEffect, useCallback, useRef } from 'react';

import type { EditClip } from '../lib/types';

// Buffer zone on each side to pre-render nearby clips
const BUFFER_PX = 200;

interface UseVisibleClipsOptions {
    clips: EditClip[];
    zoom: number; // px per second
    scrollContainerRef: React.RefObject<HTMLDivElement | null>;
}

interface VisibleRange {
    startMs: number;
    endMs: number;
}

/**
 * Returns only clips that fall within the visible viewport + buffer.
 */
export function useVisibleClips({
    clips,
    zoom,
    scrollContainerRef,
}: UseVisibleClipsOptions): {
    visibleClips: EditClip[];
    visibleRange: VisibleRange;
} {
    const [scrollLeft, setScrollLeft] = useState(0);
    const [containerWidth, setContainerWidth] = useState(0);
    const rafRef = useRef<number>(0);

    // Listen to scroll events with requestAnimationFrame throttling
    const handleScroll = useCallback(() => {
        if (rafRef.current) cancelAnimationFrame(rafRef.current);
        rafRef.current = requestAnimationFrame(() => {
            const container = scrollContainerRef.current;
            if (container) {
                setScrollLeft(container.scrollLeft);
                setContainerWidth(container.clientWidth);
            }
        });
    }, [scrollContainerRef]);

    // Observe resize changes
    useEffect(() => {
        const container = scrollContainerRef.current;
        if (!container) return;

        // Set initial values
        setScrollLeft(container.scrollLeft);
        setContainerWidth(container.clientWidth);

        container.addEventListener('scroll', handleScroll, { passive: true });

        const resizeObserver = new ResizeObserver(() => {
            setContainerWidth(container.clientWidth);
        });
        resizeObserver.observe(container);

        return () => {
            container.removeEventListener('scroll', handleScroll);
            resizeObserver.disconnect();
            if (rafRef.current) cancelAnimationFrame(rafRef.current);
        };
    }, [scrollContainerRef, handleScroll]);

    // Calculate visible time range from scroll position
    const visibleRange = useMemo((): VisibleRange => {
        const leftPx = Math.max(0, scrollLeft - BUFFER_PX);
        const rightPx = scrollLeft + containerWidth + BUFFER_PX;

        return {
            startMs: (leftPx / zoom) * 1000,
            endMs: (rightPx / zoom) * 1000,
        };
    }, [scrollLeft, containerWidth, zoom]);

    // Filter clips to only those overlapping the visible range
    const visibleClips = useMemo(() => {
        return clips.filter(
            (clip) => clip.endMs >= visibleRange.startMs && clip.startMs <= visibleRange.endMs,
        );
    }, [clips, visibleRange]);

    return { visibleClips, visibleRange };
}
