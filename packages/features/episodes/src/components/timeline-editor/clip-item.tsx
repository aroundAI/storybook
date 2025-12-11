'use client';

/**
 * Clip Item - Individual clip card with drag/resize handles
 */
import { useCallback, useRef, useState } from 'react';

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

  // Handle drag start
  const handleDragStart = useCallback(
    (e: React.MouseEvent, type: DragState['type']) => {
      e.preventDefault();
      e.stopPropagation();

      if (isLocked) return;

      setDragState({
        type,
        startX: e.clientX,
        startFrame: clip.startFrame,
        startDuration: clip.durationFrames,
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
        const deltaX = moveEvent.clientX - e.clientX;
        const deltaFrames = Math.round(deltaX / pixelsPerFrame);

        if (type === 'move') {
          // Moving the clip
          let newStartFrame = clip.startFrame + deltaFrames;

          // Apply snapping if enabled
          if (state.snapEnabled) {
            newStartFrame = snapToGrid(
              newStartFrame,
              state.fps, // Snap to 1-second intervals
              SNAP_THRESHOLD_PX / pixelsPerFrame,
            );
          }

          dispatch({
            type: 'MOVE_CLIP',
            clipId: clip.id,
            newStartFrame: Math.max(0, newStartFrame),
          });
        } else if (type === 'resize-left') {
          // Resizing from left edge
          let newStartFrame = clip.startFrame + deltaFrames;
          let newDuration = clip.durationFrames - deltaFrames;

          // Apply snapping
          if (state.snapEnabled) {
            newStartFrame = snapToGrid(
              newStartFrame,
              state.fps,
              SNAP_THRESHOLD_PX / pixelsPerFrame,
            );
            newDuration = clip.startFrame + clip.durationFrames - newStartFrame;
          }

          // Ensure minimum duration of 1 frame
          if (newDuration < 1) {
            newDuration = 1;
            newStartFrame = clip.startFrame + clip.durationFrames - 1;
          }

          dispatch({
            type: 'RESIZE_CLIP',
            clipId: clip.id,
            newStartFrame: Math.max(0, newStartFrame),
            newDurationFrames: newDuration,
          });
        } else {
          // Resizing from right edge
          let newDuration = clip.durationFrames + deltaFrames;

          // Apply snapping to end position
          if (state.snapEnabled) {
            const endFrame = clip.startFrame + newDuration;
            const snappedEnd = snapToGrid(
              endFrame,
              state.fps,
              SNAP_THRESHOLD_PX / pixelsPerFrame,
            );
            newDuration = snappedEnd - clip.startFrame;
          }

          // Ensure minimum duration of 1 frame
          newDuration = Math.max(1, newDuration);

          dispatch({
            type: 'RESIZE_CLIP',
            clipId: clip.id,
            newStartFrame: clip.startFrame,
            newDurationFrames: newDuration,
          });
        }
      };

      const handleMouseUp = () => {
        setDragState(null);
        dispatch({ type: 'END_DRAG' });
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
      };

      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    },
    [clip, isLocked, pixelsPerFrame, state.snapEnabled, state.fps, dispatch],
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
