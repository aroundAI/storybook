'use client';

/**
 * Playhead - Draggable vertical line indicating current time position
 */
import { useCallback, useRef, useState } from 'react';

import { cn } from '@kit/ui/utils';

import { useTimelineContext } from './timeline-context';

// ============================================================================
// Types
// ============================================================================

interface PlayheadProps {
  /** Height of the playhead line */
  height: number;
  /** Additional CSS classes */
  className?: string;
}

// ============================================================================
// Component
// ============================================================================

export function Playhead({ height, className }: PlayheadProps) {
  const { state, dispatch, pixelsPerFrame, containerRef } =
    useTimelineContext();
  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef<{ x: number; frame: number } | null>(null);

  // Calculate playhead position
  const position = state.playheadFrame * pixelsPerFrame;

  // Handle mouse down on playhead
  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();

      setIsDragging(true);
      dragStartRef.current = {
        x: e.clientX,
        frame: state.playheadFrame,
      };

      // Add global mouse listeners
      const handleMouseMove = (moveEvent: MouseEvent) => {
        if (!containerRef.current || !dragStartRef.current) return;

        const deltaX = moveEvent.clientX - dragStartRef.current.x;
        const deltaFrames = Math.round(deltaX / pixelsPerFrame);
        const newFrame = Math.max(
          0,
          Math.min(
            dragStartRef.current.frame + deltaFrames,
            state.totalFrames - 1,
          ),
        );

        dispatch({ type: 'SET_PLAYHEAD', frame: newFrame });
      };

      const handleMouseUp = () => {
        setIsDragging(false);
        dragStartRef.current = null;
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
      };

      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    },
    [
      state.playheadFrame,
      state.totalFrames,
      pixelsPerFrame,
      containerRef,
      dispatch,
    ],
  );

  // Handle click on timeline to seek
  const handleTimelineClick = useCallback(
    (e: React.MouseEvent) => {
      if (!containerRef.current) return;

      const rect = containerRef.current.getBoundingClientRect();
      const scrollLeft = containerRef.current.scrollLeft;
      const clickX = e.clientX - rect.left + scrollLeft;
      const frame = Math.round(clickX / pixelsPerFrame);

      const clampedFrame = Math.max(0, Math.min(frame, state.totalFrames - 1));
      dispatch({ type: 'SET_PLAYHEAD', frame: clampedFrame });
    },
    [containerRef, pixelsPerFrame, state.totalFrames, dispatch],
  );

  return (
    <>
      {/* Click area for timeline (behind playhead) */}
      <div
        className="absolute inset-0 z-10 cursor-pointer"
        onClick={handleTimelineClick}
        onMouseDown={(e) => {
          // Only handle if not clicking on playhead
          if ((e.target as HTMLElement).closest('[data-playhead]')) return;
          handleTimelineClick(e);
        }}
      />

      {/* Playhead line */}
      <div
        data-playhead
        className={cn(
          'absolute top-0 z-30 flex flex-col items-center',
          isDragging ? 'cursor-grabbing' : 'cursor-grab',
          className,
        )}
        style={{
          left: position,
          height,
          transform: 'translateX(-50%)',
        }}
        onMouseDown={handleMouseDown}
      >
        {/* Head/handle */}
        <div
          className={cn(
            'h-4 w-4 -translate-y-1 transform rounded-sm bg-red-500',
            isDragging && 'scale-110',
          )}
          style={{
            clipPath: 'polygon(0 0, 100% 0, 50% 100%)',
          }}
        />

        {/* Line */}
        <div
          className={cn('w-0.5 flex-1 bg-red-500', isDragging && 'bg-red-400')}
        />
      </div>
    </>
  );
}
