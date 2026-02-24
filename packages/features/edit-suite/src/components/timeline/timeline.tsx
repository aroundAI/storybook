'use client';

/**
 * Timeline — bottom panel with tracks, clips, ruler, and playhead.
 *
 * Composes:
 * - TimelineRuler (adaptive tick marks, click-to-jump)
 * - Playhead (draggable red line)
 * - TrackRow × N (header + clip lane with drop target)
 * - ClipBlock (positioned clips within each track)
 * - Zoom controls (slider + buttons)
 */

import { useEffect, useMemo, useRef } from 'react';

import { useEditSuite } from '../edit-suite-provider';
import { TimelineRuler } from './timeline-ruler';
import { Playhead } from './playhead';
import { TrackRow } from './track-row';

// ──────────────────────────────────────────
// Constants
// ──────────────────────────────────────────

const MIN_ZOOM = 10;    // px per second (zoomed out)
const MAX_ZOOM = 500;   // px per second (zoomed in)
const ZOOM_STEP = 10;
const MIN_DURATION_MS = 60_000; // 1 minute minimum
const DURATION_BUFFER = 1.2;    // 20% extra beyond last clip
const AUTO_SCROLL_MARGIN = 100; // px from edge to trigger auto-scroll

// ──────────────────────────────────────────
// Component
// ──────────────────────────────────────────

export function Timeline() {
    const { state, dispatch } = useEditSuite();
    const scrollContainerRef = useRef<HTMLDivElement>(null);

    // Compute dynamic timeline duration based on clips
    const durationMs = useMemo(() => {
        const maxEnd = state.clips.reduce((max, c) => Math.max(max, c.endMs), 0);
        return Math.max(MIN_DURATION_MS, Math.round(maxEnd * DURATION_BUFFER));
    }, [state.clips]);

    // Group clips by track
    const clipsByTrack = useMemo(() => {
        const map = new Map<string, typeof state.clips>();
        for (const track of state.tracks) {
            map.set(track.id, []);
        }
        for (const clip of state.clips) {
            const trackClips = map.get(clip.trackId);
            if (trackClips) {
                trackClips.push(clip);
            }
        }
        return map;
    }, [state.tracks, state.clips]);

    // Selected clip IDs as a Set for O(1) lookups
    const selectedClipIds = useMemo(
        () => new Set(state.selectedClipIds),
        [state.selectedClipIds],
    );

    // Group transitions by track (keyed by fromClipId's track)
    const transitionsByTrack = useMemo(() => {
        const clipTrack = new Map(state.clips.map((c) => [c.id, c.trackId]));
        const map = new Map<string, typeof state.transitions>();
        for (const t of state.transitions) {
            const trackId = clipTrack.get(t.fromClipId);
            if (trackId) {
                const arr = map.get(trackId);
                if (arr) arr.push(t);
                else map.set(trackId, [t]);
            }
        }
        return map;
    }, [state.clips, state.transitions]);

    // Group keyframes by track (keyed by clip's trackId)
    const keyframesByTrack = useMemo(() => {
        const clipTrack = new Map(state.clips.map((c) => [c.id, c.trackId]));
        const map = new Map<string, typeof state.keyframes>();
        for (const kf of state.keyframes) {
            const trackId = clipTrack.get(kf.clipId);
            if (trackId) {
                const arr = map.get(trackId);
                if (arr) arr.push(kf);
                else map.set(trackId, [kf]);
            }
        }
        return map;
    }, [state.clips, state.keyframes]);

    // Auto-scroll to keep playhead visible during playback
    useEffect(() => {
        if (!state.isPlaying) return;
        const container = scrollContainerRef.current;
        if (!container) return;

        const playheadPx = (state.playheadMs / 1000) * state.zoom;
        const visibleLeft = container.scrollLeft;
        const visibleRight = visibleLeft + container.clientWidth;

        // Scroll if playhead is near the right edge
        if (playheadPx > visibleRight - AUTO_SCROLL_MARGIN) {
            container.scrollLeft = playheadPx - container.clientWidth / 3;
        }
        // Scroll if playhead is near the left edge (reverse playback)
        else if (playheadPx < visibleLeft + AUTO_SCROLL_MARGIN) {
            container.scrollLeft = Math.max(0, playheadPx - container.clientWidth * 2 / 3);
        }
    }, [state.isPlaying, state.playheadMs, state.zoom]);

    const totalWidthPx = (durationMs / 1000) * state.zoom;

    return (
        <div className="flex h-full flex-col overflow-hidden bg-[#0d0d0f]">
            {/* Toolbar bar */}
            <div className="flex items-center gap-3 border-b border-zinc-800 px-3 py-1.5">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
                    Timeline
                </h3>

                <div className="ml-auto flex items-center gap-2">
                    {/* Snap toggle */}
                    <button
                        className={`rounded px-2 py-0.5 text-[10px] font-medium transition-colors ${state.snapEnabled
                            ? 'bg-violet-600/30 text-violet-300'
                            : 'text-zinc-500 hover:bg-zinc-800'
                            }`}
                        onClick={() => dispatch({ type: 'TOGGLE_SNAP' })}
                        title="Snap to grid"
                    >
                        Snap
                    </button>

                    {/* Zoom controls */}
                    <button
                        className="rounded px-1.5 py-0.5 text-xs text-zinc-400 hover:bg-zinc-800"
                        onClick={() => dispatch({
                            type: 'SET_ZOOM',
                            payload: { zoom: state.zoom - ZOOM_STEP },
                        })}
                        title="Zoom out"
                    >
                        −
                    </button>
                    <input
                        type="range"
                        min={MIN_ZOOM}
                        max={MAX_ZOOM}
                        step={ZOOM_STEP}
                        value={state.zoom}
                        onChange={(e) => dispatch({
                            type: 'SET_ZOOM',
                            payload: { zoom: parseInt(e.target.value, 10) },
                        })}
                        className="h-1 w-20 cursor-pointer accent-violet-500"
                        title={`Zoom: ${state.zoom}px/s`}
                    />
                    <button
                        className="rounded px-1.5 py-0.5 text-xs text-zinc-400 hover:bg-zinc-800"
                        onClick={() => dispatch({
                            type: 'SET_ZOOM',
                            payload: { zoom: state.zoom + ZOOM_STEP },
                        })}
                        title="Zoom in"
                    >
                        +
                    </button>
                    <span className="text-[10px] text-zinc-500">{state.zoom}px/s</span>
                </div>
            </div>

            {/* Scrollable timeline area */}
            <div
                ref={scrollContainerRef}
                className="relative flex-1 overflow-auto"
                onScroll={(e) => {
                    const target = e.target as HTMLDivElement;
                    dispatch({ type: 'SET_SCROLL_LEFT', payload: { scrollLeft: target.scrollLeft } });
                }}
            >
                {/* Inner container with computed width */}
                <div className="relative" style={{ width: `${totalWidthPx}px`, minHeight: '100%' }}>
                    {/* Ruler */}
                    <div className="sticky top-0 z-10">
                        <TimelineRuler
                            durationMs={durationMs}
                            zoom={state.zoom}
                            dispatch={dispatch}
                        />
                    </div>

                    {/* Tracks */}
                    <div className="relative">
                        {state.tracks.length === 0 ? (
                            <div className="flex items-center justify-center py-12 text-sm text-zinc-500">
                                No tracks. Use Auto-Assembly or drag assets from the Media Bin.
                            </div>
                        ) : (
                            state.tracks
                                .sort((a, b) => a.sortOrder - b.sortOrder)
                                .map((track) => (
                                    <TrackRow
                                        key={track.id}
                                        track={track}
                                        clips={clipsByTrack.get(track.id) ?? []}
                                        allClips={state.clips}
                                        transitions={transitionsByTrack.get(track.id) ?? []}
                                        keyframes={keyframesByTrack.get(track.id) ?? []}
                                        zoom={state.zoom}
                                        playheadMs={state.playheadMs}
                                        selectedClipIds={selectedClipIds}
                                        dispatch={dispatch}
                                    />
                                ))
                        )}

                        {/* Playhead overlay */}
                        <Playhead
                            playheadMs={state.playheadMs}
                            zoom={state.zoom}
                            containerRef={scrollContainerRef}
                            dispatch={dispatch}
                        />
                    </div>
                </div>
            </div>
        </div>
    );
}
