'use client';

/**
 * Clip Item - Individual clip card with drag/resize handles
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import { Lock } from 'lucide-react';

import { timelineTrackTokens } from '@kit/film-studio/design-tokens';
import {
  SNAP_THRESHOLD_PX,
  snapToGrid,
} from '@kit/film-studio/interaction-patterns';
import { cn } from '@kit/ui/utils';

import { useTimelineContext } from './timeline-context';
import type { TimelineClip } from './types';
import { WaveformDisplay } from './waveform-display';

// ============================================================================
// Types
// ============================================================================

interface ClipItemProps {
  /** Clip data */
  clip: TimelineClip;
  /** Height of the parent track */
  trackHeight: number;
  /** Whether clip is selected */
  isSelected: boolean;
  /** Whether clip is locked */
  isLocked: boolean;
  /** Additional CSS classes */
  className?: string;
}

interface DragState {
  type: 'move' | 'resize-left' | 'resize-right';
  startX: number;
  startFrame: number;
  startDuration: number;
}

// ============================================================================
// Component
// ============================================================================

export function ClipItem({
  clip,
  trackHeight,
  isSelected,
  isLocked,
  className,
}: ClipItemProps) {
  const { state, dispatch, pixelsPerFrame } = useTimelineContext();
  const [dragState, setDragState] = useState<DragState | null>(null);
  const clipRef = useRef<HTMLDivElement>(null);

  // Refs for latest values to avoid stale closures in event handlers
  const clipRef_data = useRef(clip);
  const stateRef = useRef(state);
  const pixelsPerFrameRef = useRef(pixelsPerFrame);

  // Keep refs in sync with latest props/state
  // useEffect is required here to sync refs with latest values for use in
  // document-level event handlers that would otherwise capture stale closures
  useEffect(() => {
    clipRef_data.current = clip;
    stateRef.current = state;
    pixelsPerFrameRef.current = pixelsPerFrame;
  });

  // Track active drag event handlers for cleanup on unmount
  const dragHandlersRef = useRef<{
    move: ((e: MouseEvent) => void) | null;
    up: (() => void) | null;
  }>({ move: null, up: null });

  // Cleanup event listeners on unmount to prevent memory leaks
  // useEffect is required here to clean up document-level event listeners
  // if the component unmounts during an active drag operation
  useEffect(() => {
    return () => {
      if (dragHandlersRef.current.move) {
        document.removeEventListener('mousemove', dragHandlersRef.current.move);
      }
      if (dragHandlersRef.current.up) {
        document.removeEventListener('mouseup', dragHandlersRef.current.up);
      }
    };
  }, []);

  // Calculate dimensions
  const left = clip.startFrame * pixelsPerFrame;
  const width = clip.durationFrames * pixelsPerFrame;
  const height = trackHeight - 8; // 4px margin top and bottom

  // Get track token for colors
  const trackToken = timelineTrackTokens[clip.trackType];

  // Handle clip selection
  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      if (isLocked) return;

      dispatch({
        type: 'SELECT_CLIP',
        clipId: clip.id,
        additive: e.shiftKey,
      });
    },
    [clip.id, isLocked, dispatch],
  );

  // Handle double-click to open clip editor
  const handleDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      if (isLocked) return;

      dispatch({
        type: 'OPEN_CLIP_EDITOR',
        clipId: clip.id,
      });
    },
    [clip.id, isLocked, dispatch],
  );

  // Handle drag start
  const handleDragStart = useCallback(
    (e: React.MouseEvent, type: DragState['type']) => {
      e.preventDefault();
      e.stopPropagation();

      if (isLocked) return;

      // Capture initial values at drag start for delta calculations
      const initialStartFrame = clip.startFrame;
      const initialDurationFrames = clip.durationFrames;
      const initialClientX = e.clientX;

      setDragState({
        type,
        startX: initialClientX,
        startFrame: initialStartFrame,
        startDuration: initialDurationFrames,
      });

      dispatch({
        type: 'START_DRAG',
        clipId: clip.id,
        resizeEdge:
          type === 'move'
            ? undefined
            : type === 'resize-left'
              ? 'left'
              : 'right',
      });

      const handleMouseMove = (moveEvent: MouseEvent) => {
        // Use refs to get latest values, avoiding stale closures
        const currentState = stateRef.current;
        const currentPixelsPerFrame = pixelsPerFrameRef.current;
        const currentClip = clipRef_data.current;

        const deltaX = moveEvent.clientX - initialClientX;
        const deltaFrames = Math.round(deltaX / currentPixelsPerFrame);

        if (type === 'move') {
          // Moving the clip - use initial value + delta for smooth dragging
          let newStartFrame = initialStartFrame + deltaFrames;

          // Apply snapping if enabled
          if (currentState.snapEnabled) {
            newStartFrame = snapToGrid(
              newStartFrame,
              currentState.fps, // Snap to 1-second intervals
              SNAP_THRESHOLD_PX / currentPixelsPerFrame,
            );
          }

          dispatch({
            type: 'MOVE_CLIP',
            clipId: currentClip.id,
            newStartFrame: Math.max(0, newStartFrame),
          });
        } else if (type === 'resize-left') {
          // Resizing from left edge
          let newStartFrame = initialStartFrame + deltaFrames;
          let newDuration = initialDurationFrames - deltaFrames;

          // Apply snapping
          if (currentState.snapEnabled) {
            newStartFrame = snapToGrid(
              newStartFrame,
              currentState.fps,
              SNAP_THRESHOLD_PX / currentPixelsPerFrame,
            );
            newDuration =
              initialStartFrame + initialDurationFrames - newStartFrame;
          }

          // Ensure minimum duration of 1 frame
          if (newDuration < 1) {
            newDuration = 1;
            newStartFrame = initialStartFrame + initialDurationFrames - 1;
          }

          dispatch({
            type: 'RESIZE_CLIP',
            clipId: currentClip.id,
            newStartFrame: Math.max(0, newStartFrame),
            newDurationFrames: newDuration,
          });
        } else {
          // Resizing from right edge
          let newDuration = initialDurationFrames + deltaFrames;

          // Apply snapping to end position
          if (currentState.snapEnabled) {
            const endFrame = initialStartFrame + newDuration;
            const snappedEnd = snapToGrid(
              endFrame,
              currentState.fps,
              SNAP_THRESHOLD_PX / currentPixelsPerFrame,
            );
            newDuration = snappedEnd - initialStartFrame;
          }

          // Ensure minimum duration of 1 frame
          newDuration = Math.max(1, newDuration);

          dispatch({
            type: 'RESIZE_CLIP',
            clipId: currentClip.id,
            newStartFrame: initialStartFrame,
            newDurationFrames: newDuration,
          });
        }
      };

      const handleMouseUp = () => {
        setDragState(null);
        dispatch({ type: 'END_DRAG' });
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
        // Clear refs for cleanup tracking
        dragHandlersRef.current = { move: null, up: null };
      };

      // Store handlers for cleanup on unmount
      dragHandlersRef.current = { move: handleMouseMove, up: handleMouseUp };

      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    },
    [clip.id, clip.startFrame, clip.durationFrames, isLocked, dispatch],
  );

  // Determine if clip has audio waveform
  const hasWaveform = clip.waveformData && clip.waveformData.length > 0;

  // Determine if clip has thumbnail
  const hasThumbnail = clip.thumbnailUrl && clip.trackType === 'video';

  return (
    <div
      ref={clipRef}
      className={cn(
        'absolute top-1 z-20 overflow-hidden rounded',
        trackToken.bg,
        trackToken.border,
        'border',
        isSelected && 'ring-offset-background ring-2 ring-white ring-offset-1',
        dragState && 'opacity-75 shadow-lg',
        isLocked && 'cursor-not-allowed',
        !isLocked && 'cursor-grab',
        className,
      )}
      style={{
        left,
        width: Math.max(width, 4), // Minimum 4px width for visibility
        height,
      }}
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
      onMouseDown={(e) => {
        if (isLocked) return;
        // Only start move drag if not clicking on resize handles
        const target = e.target as HTMLElement;
        if (target.dataset.resizeHandle) return;
        handleDragStart(e, 'move');
      }}
      data-clip-id={clip.id}
    >
      {/* Background: thumbnail or waveform */}
      {hasThumbnail && (
        /* eslint-disable-next-line @next/next/no-img-element */
        <img
          src={clip.thumbnailUrl}
          alt=""
          className="absolute inset-0 h-full w-full object-cover opacity-50"
        />
      )}

      {hasWaveform && (
        <div className="absolute inset-0 opacity-50">
          <WaveformDisplay
            data={clip.waveformData!}
            width={Math.max(width - 4, 1)}
            height={height}
          />
        </div>
      )}

      {/* Clip name */}
      <div
        className={cn(
          'absolute bottom-0 left-0 right-0 truncate px-2 py-0.5 text-xs',
          trackToken.text,
          'bg-black/30',
        )}
      >
        {clip.name}
      </div>

      {/* Lock indicator */}
      {isLocked && (
        <div className="absolute right-1 top-1">
          <Lock className="h-3 w-3 text-white/70" />
        </div>
      )}

      {/* Resize handles */}
      {!isLocked && (
        <>
          {/* Left resize handle */}
          <div
            data-resize-handle="left"
            className="absolute left-0 top-0 h-full w-2 cursor-ew-resize bg-white/0 hover:bg-white/30"
            onMouseDown={(e) => handleDragStart(e, 'resize-left')}
          />

          {/* Right resize handle */}
          <div
            data-resize-handle="right"
            className="absolute right-0 top-0 h-full w-2 cursor-ew-resize bg-white/0 hover:bg-white/30"
            onMouseDown={(e) => handleDragStart(e, 'resize-right')}
          />
        </>
      )}
    </div>
  );
}
