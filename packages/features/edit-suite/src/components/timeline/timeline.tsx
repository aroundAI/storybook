'use client';

import { useDeferredValue } from 'react';
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

import { useVisibleClips } from '../../hooks/use-visible-clips';
import { useEditData, usePlayback } from '../edit-suite-provider';
import { ActiveEditorsList, CursorPresence } from './cursor-presence';
import { Playhead } from './playhead';
import { TimelineRuler } from './timeline-ruler';
import { TrackRow } from './track-row';

// ──────────────────────────────────────────
// Constants
// ──────────────────────────────────────────

const MIN_ZOOM = 10; // px per second (zoomed out)
const MAX_ZOOM = 500; // px per second (zoomed in)
const ZOOM_STEP = 10;
const MIN_DURATION_MS = 60_000; // 1 minute minimum
const DURATION_BUFFER = 1.2; // 20% extra beyond last clip
const AUTO_SCROLL_MARGIN = 100; // px from edge to trigger auto-scroll

// ──────────────────────────────────────────
// Component
// ──────────────────────────────────────────

export function Timeline() {
  const data = useEditData();
  const playback = usePlayback();
  const { dispatch } = data;
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // Use deferred zoom to prevent jank during rapid zoom slider changes
  const deferredZoom = useDeferredValue(data.zoom);

  // Compute dynamic timeline duration based on clips
  const durationMs = useMemo(() => {
    const maxEnd = data.clips.reduce((max, c) => Math.max(max, c.endMs), 0);
    return Math.max(MIN_DURATION_MS, Math.round(maxEnd * DURATION_BUFFER));
  }, [data.clips]);

  // Group clips by track
  const clipsByTrack = useMemo(() => {
    const map = new Map<string, typeof data.clips>();
    for (const track of data.tracks) {
      map.set(track.id, []);
    }
    for (const clip of data.clips) {
      const trackClips = map.get(clip.trackId);
      if (trackClips) {
        trackClips.push(clip);
      }
    }
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally depends on data.tracks and data.clips, not the entire data context
  }, [data.tracks, data.clips]);

  // Virtual scrolling: only render clips within the viewport + buffer
  const { visibleClips } = useVisibleClips({
    clips: data.clips,
    zoom: deferredZoom,
    scrollContainerRef,
  });

  // Group VISIBLE clips by track (for rendering)
  const visibleClipsByTrack = useMemo(() => {
    const map = new Map<string, typeof data.clips>();
    for (const track of data.tracks) {
      map.set(track.id, []);
    }
    for (const clip of visibleClips) {
      const trackClips = map.get(clip.trackId);
      if (trackClips) {
        trackClips.push(clip);
      }
    }
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally depends on data.tracks, not the entire data context
  }, [data.tracks, visibleClips]);

  // Group transitions by track (keyed by fromClipId's track)
  const transitionsByTrack = useMemo(() => {
    const clipTrack = new Map(data.clips.map((c) => [c.id, c.trackId]));
    const map = new Map<string, typeof data.transitions>();
    for (const t of data.transitions) {
      const trackId = clipTrack.get(t.fromClipId);
      if (trackId) {
        const arr = map.get(trackId);
        if (arr) arr.push(t);
        else map.set(trackId, [t]);
      }
    }
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally depends on data.clips and data.transitions, not the entire data context
  }, [data.clips, data.transitions]);

  // Group keyframes by track (keyed by clip's trackId)
  const keyframesByTrack = useMemo(() => {
    const clipTrack = new Map(data.clips.map((c) => [c.id, c.trackId]));
    const map = new Map<string, typeof data.keyframes>();
    for (const kf of data.keyframes) {
      const trackId = clipTrack.get(kf.clipId);
      if (trackId) {
        const arr = map.get(trackId);
        if (arr) arr.push(kf);
        else map.set(trackId, [kf]);
      }
    }
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally depends on data.clips and data.keyframes, not the entire data context
  }, [data.clips, data.keyframes]);

  // Sort tracks without mutating the original array
  const sortedTracks = useMemo(
    () => [...data.tracks].sort((a, b) => a.sortOrder - b.sortOrder),
    [data.tracks],
  );

  // Auto-scroll to keep playhead visible during playback
  useEffect(() => {
    if (!playback.isPlaying) return;
    const container = scrollContainerRef.current;
    if (!container) return;

    const playheadPx = (playback.playheadMs / 1000) * data.zoom;
    const visibleLeft = container.scrollLeft;
    const visibleRight = visibleLeft + container.clientWidth;

    // Scroll if playhead is near the right edge
    if (playheadPx > visibleRight - AUTO_SCROLL_MARGIN) {
      container.scrollLeft = playheadPx - container.clientWidth / 3;
    }
    // Scroll if playhead is near the left edge (reverse playback)
    else if (playheadPx < visibleLeft + AUTO_SCROLL_MARGIN) {
      container.scrollLeft = Math.max(
        0,
        playheadPx - (container.clientWidth * 2) / 3,
      );
    }
  }, [playback.isPlaying, playback.playheadMs, data.zoom]);

  const totalWidthPx = (durationMs / 1000) * data.zoom;

  return (
    <div className="flex h-full flex-col overflow-hidden bg-[#0d0d0f]">
      {/* Toolbar bar */}
      <div className="flex items-center gap-3 border-b border-zinc-800 px-3 py-1.5">
        <h3 className="text-xs font-semibold tracking-wider text-zinc-400 uppercase">
          Timeline
        </h3>

        <div className="ml-auto flex items-center gap-2">
          {/* Snap toggle */}
          <button
            className={`rounded px-2 py-0.5 text-[10px] font-medium transition-colors ${
              data.snapEnabled
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
            onClick={() =>
              dispatch({
                type: 'SET_ZOOM',
                payload: { zoom: data.zoom - ZOOM_STEP },
              })
            }
            title="Zoom out"
          >
            −
          </button>
          <input
            type="range"
            min={MIN_ZOOM}
            max={MAX_ZOOM}
            step={ZOOM_STEP}
            value={data.zoom}
            onChange={(e) =>
              dispatch({
                type: 'SET_ZOOM',
                payload: { zoom: parseInt(e.target.value, 10) },
              })
            }
            className="h-1 w-20 cursor-pointer accent-violet-500"
            title={`Zoom: ${data.zoom}px/s`}
          />
          <button
            className="rounded px-1.5 py-0.5 text-xs text-zinc-400 hover:bg-zinc-800"
            onClick={() =>
              dispatch({
                type: 'SET_ZOOM',
                payload: { zoom: data.zoom + ZOOM_STEP },
              })
            }
            title="Zoom in"
          >
            +
          </button>
          <span className="text-[10px] text-zinc-500">{data.zoom}px/s</span>

          {/* Active collaborators */}
          <ActiveEditorsList />
        </div>
      </div>

      {/* Scrollable timeline area */}
      <div
        ref={scrollContainerRef}
        className="relative flex-1 overflow-auto"
        onScroll={(e) => {
          const target = e.target as HTMLDivElement;
          dispatch({
            type: 'SET_SCROLL_LEFT',
            payload: { scrollLeft: target.scrollLeft },
          });
        }}
      >
        {/* Inner container with computed width */}
        <div
          className="relative"
          style={{ width: `${totalWidthPx}px`, minHeight: '100%' }}
        >
          {/* Ruler */}
          <div className="sticky top-0 z-10">
            <TimelineRuler
              durationMs={durationMs}
              zoom={data.zoom}
              dispatch={dispatch}
            />
          </div>

          {/* Tracks */}
          <div className="relative">
            {data.tracks.length === 0 ? (
              <div className="flex items-center justify-center py-12 text-sm text-zinc-500">
                No tracks. Use Auto-Assembly or drag assets from the Media Bin.
              </div>
            ) : (
              sortedTracks.map((track) => (
                <TrackRow
                  key={track.id}
                  track={track}
                  clips={visibleClipsByTrack.get(track.id) ?? []}
                  allClips={clipsByTrack.get(track.id) ?? []}
                  transitions={transitionsByTrack.get(track.id) ?? []}
                  keyframes={keyframesByTrack.get(track.id) ?? []}
                  zoom={data.zoom}
                  playheadMs={playback.playheadMs}
                  selectedClipIds={data.selectedClipIds}
                  dispatch={dispatch}
                />
              ))
            )}

            {/* Playhead overlay */}
            <Playhead
              playheadMs={playback.playheadMs}
              zoom={data.zoom}
              containerRef={scrollContainerRef}
              dispatch={dispatch}
            />

            {/* Remote cursors overlay (collaborative editing) */}
            <CursorPresence />
          </div>
        </div>
      </div>
    </div>
  );
}
