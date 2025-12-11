'use client';

/**
 * Timeline Header - Playback controls, zoom slider, timecode display
 */
import {
  Magnet,
  Pause,
  Play,
  Redo2,
  Save,
  SkipBack,
  SkipForward,
  Undo2,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';

import { Button } from '@kit/ui/button';
import { Slider } from '@kit/ui/slider';
import { cn } from '@kit/ui/utils';

import { useTimelineContext } from './timeline-context';
import { ZOOM_LEVELS } from './types';

// ============================================================================
// Types
// ============================================================================

interface TimelineHeaderProps {
  /** Callback to save timeline */
  onSave?: () => void;
  /** Whether undo is available */
  canUndo: boolean;
  /** Whether redo is available */
  canRedo: boolean;
  /** Additional CSS classes */
  className?: string;
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Format frame number as timecode (MM:SS:FF)
 */
function formatTimecode(frames: number, fps: number): string {
  const totalSeconds = Math.floor(frames / fps);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const remainingFrames = frames % fps;

  return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}:${remainingFrames.toString().padStart(2, '0')}`;
}

// ============================================================================
// Component
// ============================================================================

export function TimelineHeader({
  onSave,
  canUndo,
  canRedo,
  className,
}: TimelineHeaderProps) {
  const { state, dispatch } = useTimelineContext();

  return (
    <div
      className={cn(
        'bg-muted/30 flex items-center justify-between border-b px-4 py-2',
        className,
      )}
    >
      {/* Left: Playback controls */}
      <div className="flex items-center gap-2">
        {/* Go to start */}
        <Button
          variant="ghost"
          size="icon"
          onClick={() => dispatch({ type: 'SET_PLAYHEAD', frame: 0 })}
          title="Go to start (Home)"
        >
          <SkipBack className="h-4 w-4" />
        </Button>

        {/* Play/Pause */}
        <Button
          variant="ghost"
          size="icon"
          onClick={() => dispatch({ type: 'TOGGLE_PLAYBACK' })}
          title={state.isPlaying ? 'Pause (Space)' : 'Play (Space)'}
        >
          {state.isPlaying ? (
            <Pause className="h-4 w-4" />
          ) : (
            <Play className="h-4 w-4" />
          )}
        </Button>

        {/* Go to end */}
        <Button
          variant="ghost"
          size="icon"
          onClick={() =>
            dispatch({ type: 'SET_PLAYHEAD', frame: state.totalFrames - 1 })
          }
          title="Go to end (End)"
        >
          <SkipForward className="h-4 w-4" />
        </Button>

        {/* Timecode display */}
        <div className="bg-background ml-4 min-w-[100px] rounded px-3 py-1 text-center font-mono text-sm">
          {formatTimecode(state.playheadFrame, state.fps)}
        </div>
      </div>

      {/* Center: Zoom controls */}
      <div className="flex items-center gap-4">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => dispatch({ type: 'ZOOM_OUT' })}
          title="Zoom out (-)"
        >
          <ZoomOut className="h-4 w-4" />
        </Button>

        <div className="flex items-center gap-2">
          <Slider
            value={[state.zoom]}
            min={ZOOM_LEVELS.MIN}
            max={ZOOM_LEVELS.MAX}
            step={1}
            onValueChange={([zoom]) => {
              if (zoom !== undefined) {
                dispatch({ type: 'SET_ZOOM', zoom });
              }
            }}
            className="w-32"
          />
          <span className="text-muted-foreground min-w-[60px] text-xs">
            {state.zoom}px/s
          </span>
        </div>

        <Button
          variant="ghost"
          size="icon"
          onClick={() => dispatch({ type: 'ZOOM_IN' })}
          title="Zoom in (+)"
        >
          <ZoomIn className="h-4 w-4" />
        </Button>
      </div>

      {/* Right: Tools and actions */}
      <div className="flex items-center gap-2">
        {/* Snap toggle */}
        <Button
          variant="ghost"
          size="icon"
          onClick={() => dispatch({ type: 'TOGGLE_SNAP' })}
          className={cn(state.snapEnabled && 'bg-accent')}
          title={state.snapEnabled ? 'Disable snap' : 'Enable snap'}
        >
          <Magnet className="h-4 w-4" />
        </Button>

        <div className="bg-border mx-2 h-6 w-px" />

        {/* Undo */}
        <Button
          variant="ghost"
          size="icon"
          onClick={() => dispatch({ type: 'UNDO' })}
          disabled={!canUndo}
          title="Undo (Cmd+Z)"
        >
          <Undo2 className="h-4 w-4" />
        </Button>

        {/* Redo */}
        <Button
          variant="ghost"
          size="icon"
          onClick={() => dispatch({ type: 'REDO' })}
          disabled={!canRedo}
          title="Redo (Cmd+Shift+Z)"
        >
          <Redo2 className="h-4 w-4" />
        </Button>

        <div className="bg-border mx-2 h-6 w-px" />

        {/* Save */}
        {onSave && (
          <Button variant="outline" size="sm" onClick={onSave}>
            <Save className="mr-2 h-4 w-4" />
            Save
          </Button>
        )}
      </div>
    </div>
  );
}
