'use client';

/**
 * Timeline Ruler - Time scale markers with zoom-responsive intervals
 */
import { useMemo } from 'react';

import { cn } from '@kit/ui/utils';

import { useTimelineContext } from './timeline-context';

// ============================================================================
// Types
// ============================================================================

interface TimelineRulerProps {
  /** Total width of the ruler in pixels */
  width: number;
  /** Height of the ruler */
  height?: number;
  /** Additional CSS classes */
  className?: string;
}

interface TimeMarker {
  /** Position in pixels */
  position: number;
  /** Label text */
  label: string;
  /** Whether this is a major marker */
  isMajor: boolean;
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Format time as MM:SS or SS
 */
function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;

  if (mins > 0) {
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  }

  return `${secs}s`;
}

/**
 * Get appropriate interval based on zoom level
 */
function getInterval(pixelsPerSecond: number): {
  major: number;
  minor: number;
} {
  // At high zoom (many pixels per second), show finer intervals
  if (pixelsPerSecond >= 200) {
    return { major: 1, minor: 0.5 }; // 1 second major, 0.5 second minor
  }
  if (pixelsPerSecond >= 100) {
    return { major: 2, minor: 1 }; // 2 seconds major, 1 second minor
  }
  if (pixelsPerSecond >= 50) {
    return { major: 5, minor: 1 }; // 5 seconds major, 1 second minor
  }
  if (pixelsPerSecond >= 25) {
    return { major: 10, minor: 5 }; // 10 seconds major, 5 second minor
  }
  return { major: 30, minor: 10 }; // 30 seconds major, 10 second minor
}

// ============================================================================
// Component
// ============================================================================

export function TimelineRuler({
  width,
  height = 24,
  className,
}: TimelineRulerProps) {
  const { state, pixelsPerFrame, pixelsPerSecond } = useTimelineContext();

  // Calculate markers
  const markers = useMemo(() => {
    const result: TimeMarker[] = [];
    const { major, minor } = getInterval(pixelsPerSecond);
    const totalSeconds = state.totalFrames / state.fps;

    // Generate minor markers
    for (let time = 0; time <= totalSeconds; time += minor) {
      const isMajor = time % major === 0;
      const position = time * pixelsPerSecond;

      result.push({
        position,
        label: isMajor ? formatTime(time) : '',
        isMajor,
      });
    }

    return result;
  }, [state.totalFrames, state.fps, pixelsPerSecond]);

  return (
    <div
      className={cn('bg-muted/50 relative border-b', className)}
      style={{ width, height }}
    >
      {/* Markers */}
      {markers.map((marker, index) => (
        <div
          key={index}
          className="absolute top-0"
          style={{ left: marker.position }}
        >
          {/* Tick mark */}
          <div
            className={cn('bg-border w-px', marker.isMajor ? 'h-full' : 'h-2')}
          />

          {/* Label */}
          {marker.label && (
            <span
              className="text-muted-foreground absolute left-1 top-0 text-xs"
              style={{ transform: 'translateX(-50%)' }}
            >
              {marker.label}
            </span>
          )}
        </div>
      ))}

      {/* In/Out point markers */}
      {state.inPoint !== null && (
        <div
          className="absolute bottom-0 h-2 w-0.5 bg-green-500"
          style={{ left: state.inPoint * pixelsPerFrame }}
          title={`In point: ${state.inPoint}`}
        />
      )}

      {state.outPoint !== null && (
        <div
          className="absolute bottom-0 h-2 w-0.5 bg-red-500"
          style={{ left: state.outPoint * pixelsPerFrame }}
          title={`Out point: ${state.outPoint}`}
        />
      )}

      {/* Loop region highlight */}
      {state.inPoint !== null && state.outPoint !== null && (
        <div
          className="absolute bottom-0 h-1 bg-blue-500/30"
          style={{
            left: state.inPoint * pixelsPerFrame,
            width: (state.outPoint - state.inPoint) * pixelsPerFrame,
          }}
        />
      )}
    </div>
  );
}
