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
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import type { Dispatch } from 'react';

import type { TrackType } from '../../lib/schemas';
import type { EditClip, EditKeyframe } from '../../lib/types';
import {
  AddClipCommand,
  MoveClipCommand,
  TrimClipCommand,
} from '../../state/edit-commands';
import type { EditAction } from '../../state/types';
import { useEditCommands } from '../edit-suite-provider';
import { ThumbnailStrip } from './thumbnail-strip';
import { Waveform } from './waveform';

// ──────────────────────────────────────────
// Constants
// ──────────────────────────────────────────

const EDGE_HIT_ZONE_PX = 8; // Width of trim edge handles
const MIN_CLIP_DURATION_MS = 100; // Minimum clip duration
const SNAP_THRESHOLD_PX = 10; // Distance for snap engagement
const AUDIO_TRACK_TYPES = new Set<TrackType>([
  'dialogue',
  'music',
  'sfx',
  'ambient',
  'upload',
]);

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
  /** Track type for waveform rendering */
  trackType: TrackType;
  /** All clips for snap targets */
  allClips?: EditClip[];
  /** Current playhead ms for snap-to-playhead */
  playheadMs?: number;
  /** Keyframes for this clip (for diamond markers) */
  clipKeyframes?: EditKeyframe[];
}

/** Color palette for keyframe property diamonds */
const KF_PROPERTY_COLORS: Record<string, string> = {
  volume: '#10b981',
  opacity: '#8b5cf6',
  position_x: '#3b82f6',
  position_y: '#06b6d4',
  scale: '#f59e0b',
  rotation: '#ef4444',
};

// ──────────────────────────────────────────
// Component
// ──────────────────────────────────────────

export const ClipBlock = memo(
  function ClipBlock({
    clip,
    zoom,
    isSelected,
    colorClass,
    dispatch,
    trackType,
    allClips = [],
    playheadMs = 0,
    clipKeyframes = [],
  }: ClipBlockProps) {
    const { executeCommand, recordCommand, audioEngineRef } = useEditCommands();
    const blockRef = useRef<HTMLDivElement>(null);
    const [dragMode, setDragMode] = useState<DragMode>('none');
    const showWaveform = AUDIO_TRACK_TYPES.has(trackType) && !!clip.mediaUrl;
    const showThumbnails = trackType === 'video' && !!clip.mediaUrl;
    const showTextOverlay = trackType === 'title' && !!clip.text;
    const [snapLineX, setSnapLineX] = useState<number | null>(null);

    const getBuffer = useCallback(
      (url: string) =>
        audioEngineRef.current?.getAudioBuffer(url) ?? Promise.resolve(null),
      [audioEngineRef],
    );

    // Track latest clip state via ref for stale-closure-safe access in mouseup
    const clipRef = useRef(clip);
    useEffect(() => {
      clipRef.current = clip;
    }, [clip]);

    const leftPx = (clip.startMs / 1000) * zoom;
    const widthPx = Math.max(4, ((clip.endMs - clip.startMs) / 1000) * zoom);

    // Derive a display name from the clip's source
    const name = clip.text
      ? clip.text.length > 20
        ? clip.text.slice(0, 20) + '…'
        : clip.text
      : clip.sourceShotId
        ? 'Shot'
        : clip.sourceDialogueId
          ? 'Dialogue'
          : clip.sourceDubbedDialogueId
            ? 'Dubbed'
            : clip.sourceAudioTrackId
              ? 'Audio'
              : 'Clip';

    const durationMs = clip.endMs - clip.startMs;
    const durationLabel =
      durationMs >= 1000
        ? `${(durationMs / 1000).toFixed(1)}s`
        : `${durationMs}ms`;

    // ── Click / select ──

    const handleClick = useCallback(
      (e: React.MouseEvent) => {
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
      },
      [clip.id, dispatch],
    );

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

    const findSnapTarget = useCallback(
      (
        ms: number,
        excludeClipId: string,
      ): { snappedMs: number; snapPx: number | null } => {
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
      },
      [zoom, playheadMs, allClips],
    );

    // ── Mouse down — start drag ──

    const handleMouseDown = useCallback(
      (e: React.MouseEvent) => {
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
            const { snappedMs: snappedStart, snapPx } = findSnapTarget(
              rawStartMs,
              clip.id,
            );
            const offset = snappedStart - rawStartMs;
            const newStartMs = Math.max(0, snappedStart);
            const newEndMs = rawEndMs + offset;

            setSnapLineX(snapPx);

            const targetId =
              isAltDuplicate && duplicateId ? duplicateId : clip.id;
            dispatch({
              type: 'MOVE_CLIP',
              payload: {
                clipId: targetId,
                startMs: newStartMs,
                endMs: newEndMs,
              },
            });
          } else if (mode === 'trim-left') {
            const rawStartMs = origStartMs + deltaMs;
            const { snappedMs: snappedStart, snapPx } = findSnapTarget(
              rawStartMs,
              clip.id,
            );
            const newStartMs = Math.max(
              0,
              Math.min(snappedStart, origEndMs - MIN_CLIP_DURATION_MS),
            );
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
            const { snappedMs: snappedEnd, snapPx } = findSnapTarget(
              rawEndMs,
              clip.id,
            );
            const newEndMs = Math.max(
              origStartMs + MIN_CLIP_DURATION_MS,
              snappedEnd,
            );
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
            if (
              currentClip.startMs !== origStartMs ||
              currentClip.endMs !== origEndMs
            ) {
              recordCommand(
                new MoveClipCommand(
                  currentClip.id,
                  origStartMs,
                  origEndMs,
                  currentClip.startMs,
                  currentClip.endMs,
                  currentClip.trackId,
                  currentClip.trackId,
                ),
              );
            }
          }
          if (mode === 'trim-left' || mode === 'trim-right') {
            if (
              currentClip.startMs !== origStartMs ||
              currentClip.endMs !== origEndMs
            ) {
              recordCommand(
                new TrimClipCommand(
                  currentClip.id,
                  {
                    startMs: origStartMs,
                    endMs: origEndMs,
                    inPointMs: origInPointMs,
                    outPointMs: origOutPointMs,
                  },
                  {
                    startMs: currentClip.startMs,
                    endMs: currentClip.endMs,
                    inPointMs: currentClip.inPointMs,
                    outPointMs: currentClip.outPointMs,
                  },
                ),
              );
            }
          }
        };

        window.addEventListener('mousemove', handleMouseMove);
        window.addEventListener('mouseup', handleMouseUp);
      },
      [
        clip,
        zoom,
        isSelected,
        dispatch,
        getDragMode,
        findSnapTarget,
        executeCommand,
        recordCommand,
      ],
    );

    // ── Cursor style ──

    const getCursor = useCallback(
      (e: React.MouseEvent): string => {
        const mode = getDragMode(e);
        if (mode === 'trim-left' || mode === 'trim-right') return 'col-resize';
        return 'grab';
      },
      [getDragMode],
    );

    const [cursor, setCursor] = useState('grab');

    const handleMouseMoveLocal = useCallback(
      (e: React.MouseEvent) => {
        if (dragMode !== 'none') return;
        setCursor(getCursor(e));
      },
      [dragMode, getCursor],
    );

    return (
      <>
        <div
          ref={blockRef}
          className={`group/clip absolute top-1 flex items-center overflow-hidden rounded-[3px] border text-[10px] text-white/90 transition-shadow ${colorClass} ${
            isSelected
              ? 'z-10 border-violet-400 shadow-[0_0_0_1px_rgba(139,92,246,0.5)]'
              : clip.syncGroupId && clip.speed !== 1
                ? 'border-2 border-amber-500'
                : 'border-white/10 hover:border-white/25'
          } ${dragMode !== 'none' ? 'opacity-90' : ''} ${!clip.isActive ? 'border-dashed opacity-40' : ''}`}
          style={{
            left: `${leftPx}px`,
            width: `${widthPx}px`,
            height: 'calc(100% - 8px)',
            cursor:
              dragMode !== 'none'
                ? dragMode === 'move'
                  ? 'grabbing'
                  : 'col-resize'
                : cursor,
          }}
          onClick={handleClick}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMoveLocal}
          role="option"
          aria-selected={isSelected}
          tabIndex={0}
        >
          {/* Left trim handle indicator */}
          <div className="absolute top-0 left-0 h-full w-1 bg-white/0 transition-colors hover:bg-white/30" />

          {/* Thumbnail strip for video clips */}
          {showThumbnails && (
            <ThumbnailStrip
              mediaUrl={clip.mediaUrl!}
              inPointMs={clip.inPointMs}
              outPointMs={clip.outPointMs}
              widthPx={widthPx}
              speed={clip.speed}
            />
          )}

          {/* Waveform for audio clips */}
          {showWaveform && (
            <Waveform
              mediaUrl={clip.mediaUrl!}
              inPointMs={clip.inPointMs}
              outPointMs={clip.outPointMs}
              widthPx={widthPx}
              heightPx={40}
              getBuffer={getBuffer}
            />
          )}

          {/* Text overlay for title clips */}
          {showTextOverlay && (
            <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-r from-violet-900/60 to-fuchsia-900/60">
              <span
                className="truncate px-2 text-[11px] font-semibold"
                style={{
                  color: clip.fontColor ?? '#ffffff',
                  fontFamily: clip.fontFamily ?? 'inherit',
                  textShadow: clip.textShadowColor
                    ? `0 1px ${clip.textShadowBlur ?? 4}px ${clip.textShadowColor}`
                    : '0 1px 2px rgba(0,0,0,0.8)',
                }}
              >
                {clip.text}
              </span>
            </div>
          )}

          {/* Clip content (only show if wide enough) */}
          {widthPx > 40 && (
            <span className="relative z-[1] truncate px-1.5 py-0.5 font-medium drop-shadow-[0_1px_1px_rgba(0,0,0,0.8)]">
              {name}
            </span>
          )}
          {widthPx > 80 && (
            <span className="relative z-[1] ml-auto flex-shrink-0 px-1 text-[9px] text-white/50 drop-shadow-[0_1px_1px_rgba(0,0,0,0.8)]">
              {durationLabel}
            </span>
          )}

          {/* Speed badge */}
          {clip.speed !== 1 && widthPx > 50 && (
            <span className="absolute right-1 bottom-0.5 z-[1] rounded bg-black/60 px-1 py-px text-[8px] font-bold text-amber-300">
              {clip.speed}×
            </span>
          )}

          {/* Keyframe diamond markers (visible when selected or hovered) */}
          {clipKeyframes.length > 0 && (
            <div
              className={`absolute bottom-0 left-0 h-2.5 w-full ${isSelected ? 'opacity-100' : 'opacity-0 group-hover/clip:opacity-70'} transition-opacity`}
            >
              {clipKeyframes.map((kf) => {
                const clipDurationMs = clip.endMs - clip.startMs;
                if (clipDurationMs <= 0) return null;
                const xFraction = kf.offsetMs / clipDurationMs;
                if (xFraction < 0 || xFraction > 1) return null;
                const color = KF_PROPERTY_COLORS[kf.property] ?? '#888';
                return (
                  <div
                    key={kf.id}
                    className="absolute -translate-x-1/2"
                    style={{
                      left: `${xFraction * 100}%`,
                      bottom: '1px',
                    }}
                    title={`${kf.property}: ${kf.value} @ ${kf.offsetMs}ms`}
                  >
                    <svg width="7" height="7" viewBox="0 0 7 7">
                      <rect
                        x="1"
                        y="1"
                        width="5"
                        height="5"
                        fill={color}
                        stroke="#000"
                        strokeWidth="0.5"
                        transform="rotate(45 3.5 3.5)"
                      />
                    </svg>
                  </div>
                );
              })}
            </div>
          )}

          {/* Right trim handle indicator */}
          <div className="absolute top-0 right-0 h-full w-1 bg-white/0 transition-colors hover:bg-white/30" />
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
  },
  (prev, next) => {
    return (
      prev.clip === next.clip &&
      prev.zoom === next.zoom &&
      prev.isSelected === next.isSelected &&
      prev.colorClass === next.colorClass &&
      prev.trackType === next.trackType &&
      prev.clipKeyframes === next.clipKeyframes &&
      prev.playheadMs === next.playheadMs
    );
  },
);
