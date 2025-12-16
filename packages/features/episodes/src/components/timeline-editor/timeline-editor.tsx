'use client';

/**
 * Timeline Editor - Main component
 *
 * Multi-track timeline for video editing with drag-drop, zoom, and playhead controls.
 */
import { useCallback, useEffect, useMemo, useReducer, useRef } from 'react';

import { useTimelineKeyboard } from '@kit/film-studio/hooks';
import { Card } from '@kit/ui/card';
import { cn } from '@kit/ui/utils';

import { ClipEditor } from './clip-editor';
import { Playhead } from './playhead';
import { PreviewPlayer } from './preview-player';
import { TimelineContext } from './timeline-context';
import { TimelineHeader } from './timeline-header';
import { createInitialState, timelineReducer } from './timeline-reducer';
import { TimelineRuler } from './timeline-ruler';
import { TrackLayer } from './track-layer';
import type { TimelineClip, TimelineData, TimelineEditorProps } from './types';

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

export function TimelineEditor({
  episodeId: _episodeId,
  initialData,
  onSave,
  onPlaybackStateChange,
  fps = 30,
  className,
}: TimelineEditorProps) {
  const [state, dispatch] = useReducer(
    timelineReducer,
    fps,
    createInitialState,
  );
  const containerRef = useRef<HTMLDivElement>(null);
  const animationFrameRef = useRef<number | null>(null);
  const lastTimeRef = useRef<number>(0);

  // Load initial data into reducer state
  // useEffect is required here to sync external prop (initialData) with internal
  // reducer state on mount and when initialData changes
  useEffect(() => {
    if (initialData) {
      dispatch({ type: 'LOAD_TIMELINE', data: initialData });
    }
  }, [initialData]);

  // Playback animation loop using requestAnimationFrame
  // useEffect is required here because requestAnimationFrame is a browser API
  // that schedules callbacks outside React's render cycle, requiring manual
  // setup and cleanup
  useEffect(() => {
    if (!state.isPlaying) {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
      lastTimeRef.current = 0;
      return;
    }

    const frameInterval = 1000 / state.fps;

    const animate = (time: number) => {
      if (lastTimeRef.current === 0) {
        lastTimeRef.current = time;
      }

      const delta = time - lastTimeRef.current;

      if (delta >= frameInterval) {
        dispatch({ type: 'TICK' });
        lastTimeRef.current = time - (delta % frameInterval);
      }

      animationFrameRef.current = requestAnimationFrame(animate);
    };

    animationFrameRef.current = requestAnimationFrame(animate);

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
    };
  }, [state.isPlaying, state.fps]);

  // Notify parent of playback state changes via callback prop
  // useEffect is required here to synchronize internal state changes with
  // parent component through the callback prop
  useEffect(() => {
    onPlaybackStateChange?.(state.isPlaying, state.playheadFrame);
  }, [state.isPlaying, state.playheadFrame, onPlaybackStateChange]);

  // Keyboard shortcuts
  useTimelineKeyboard({
    playhead: state.playheadFrame,
    fps: state.fps,
    totalFrames: state.totalFrames,
    zoom: state.zoom / 50, // Normalize for keyboard hook
    isPlaying: state.isPlaying,
    inPoint: state.inPoint,
    outPoint: state.outPoint,
    onPlayheadChange: useCallback((frame: number) => {
      dispatch({ type: 'SET_PLAYHEAD', frame });
    }, []),
    onPlayToggle: useCallback(() => {
      dispatch({ type: 'TOGGLE_PLAYBACK' });
    }, []),
    onZoomChange: useCallback((zoom: number) => {
      dispatch({ type: 'SET_ZOOM', zoom: zoom * 50 });
    }, []),
    onInPointSet: useCallback((frame: number) => {
      dispatch({ type: 'SET_IN_POINT', frame });
    }, []),
    onOutPointSet: useCallback((frame: number) => {
      dispatch({ type: 'SET_OUT_POINT', frame });
    }, []),
    onUndo: useCallback(() => {
      dispatch({ type: 'UNDO' });
    }, []),
    onRedo: useCallback(() => {
      dispatch({ type: 'REDO' });
    }, []),
    enabled: true,
  });

  // Calculate pixels per frame based on zoom
  const pixelsPerFrame = useMemo(
    () => state.zoom / state.fps,
    [state.zoom, state.fps],
  );

  // Calculate timeline width
  const timelineWidth = useMemo(
    () => state.totalFrames * pixelsPerFrame,
    [state.totalFrames, pixelsPerFrame],
  );

  // Total track height
  const totalTrackHeight = useMemo(
    () => state.tracks.reduce((sum, track) => sum + track.height, 0),
    [state.tracks],
  );

  // Save handler
  const handleSave = useCallback(async () => {
    const data: TimelineData = {
      tracks: state.tracks,
      totalFrames: state.totalFrames,
      fps: state.fps,
      inPoint: state.inPoint,
      outPoint: state.outPoint,
      version: 1,
    };
    await onSave?.(data);
  }, [state, onSave]);

  // Context value
  const contextValue = useMemo(
    () => ({
      state,
      dispatch,
      pixelsPerFrame,
      pixelsPerSecond: state.zoom,
      containerRef,
    }),
    [state, pixelsPerFrame],
  );

  // Get current video clip at playhead
  const currentVideoClip = useMemo(() => {
    const videoTrack = state.tracks.find((t) => t.type === 'video');
    if (!videoTrack) return null;

    return (
      videoTrack.clips.find(
        (clip) =>
          state.playheadFrame >= clip.startFrame &&
          state.playheadFrame < clip.startFrame + clip.durationFrames,
      ) ?? null
    );
  }, [state.tracks, state.playheadFrame]);

  // Get clip and track being edited
  const editingClip = useMemo(() => {
    if (!state.editingClipId) return null;

    for (const track of state.tracks) {
      const clip = track.clips.find((c) => c.id === state.editingClipId);
      if (clip) {
        return { clip, track };
      }
    }
    return null;
  }, [state.editingClipId, state.tracks]);

  // Clip editor handlers
  const handleClipEditorClose = useCallback(() => {
    dispatch({ type: 'CLOSE_CLIP_EDITOR' });
  }, []);

  const handleClipEditorSave = useCallback(
    (updates: Partial<TimelineClip>) => {
      if (state.editingClipId) {
        dispatch({
          type: 'UPDATE_CLIP',
          clipId: state.editingClipId,
          updates,
        });
      }
      dispatch({ type: 'CLOSE_CLIP_EDITOR' });
    },
    [state.editingClipId],
  );

  return (
    <TimelineContext.Provider value={contextValue}>
      <Card
        className={cn(
          'bg-background flex h-[700px] flex-col overflow-hidden',
          className,
        )}
        data-test="timeline-editor"
      >
        {/* Preview pane */}
        <div className="h-[250px] flex-shrink-0 border-b bg-black">
          <PreviewPlayer
            clip={currentVideoClip}
            currentFrame={state.playheadFrame}
            isPlaying={state.isPlaying}
            fps={state.fps}
          />
        </div>

        {/* Header with controls */}
        <TimelineHeader
          onSave={handleSave}
          canUndo={state.historyIndex > 0}
          canRedo={state.historyIndex < state.history.length - 1}
        />

        {/* Main timeline area */}
        <div className="flex flex-1 overflow-hidden">
          {/* Track labels column */}
          <div className="bg-muted/50 w-48 flex-shrink-0 border-r">
            {state.tracks.map((track) => (
              <div
                key={track.id}
                className="flex items-center justify-between border-b px-3 py-2"
                style={{ height: track.height }}
              >
                <span className="text-sm font-medium">{track.name}</span>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() =>
                      dispatch({ type: 'TOGGLE_TRACK_MUTE', trackId: track.id })
                    }
                    className={cn(
                      'h-6 w-6 rounded text-xs',
                      track.isMuted
                        ? 'bg-red-500 text-white'
                        : 'bg-muted hover:bg-muted/80',
                    )}
                    title={track.isMuted ? 'Unmute' : 'Mute'}
                  >
                    M
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      dispatch({ type: 'TOGGLE_TRACK_SOLO', trackId: track.id })
                    }
                    className={cn(
                      'h-6 w-6 rounded text-xs',
                      track.isSolo
                        ? 'bg-yellow-500 text-white'
                        : 'bg-muted hover:bg-muted/80',
                    )}
                    title={track.isSolo ? 'Unsolo' : 'Solo'}
                  >
                    S
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      dispatch({ type: 'TOGGLE_TRACK_LOCK', trackId: track.id })
                    }
                    className={cn(
                      'h-6 w-6 rounded text-xs',
                      track.isLocked
                        ? 'bg-blue-500 text-white'
                        : 'bg-muted hover:bg-muted/80',
                    )}
                    title={track.isLocked ? 'Unlock' : 'Lock'}
                  >
                    L
                  </button>
                </div>
              </div>
            ))}
          </div>

          {/* Scrollable timeline area */}
          <div className="relative flex-1 overflow-auto" ref={containerRef}>
            {/* Ruler */}
            <div className="bg-background sticky top-0 z-20">
              <TimelineRuler width={timelineWidth} />
            </div>

            {/* Tracks with clips */}
            <div
              className="relative"
              style={{ width: timelineWidth, minHeight: totalTrackHeight }}
            >
              {state.tracks.map((track) => (
                <TrackLayer key={track.id} track={track} />
              ))}

              {/* Playhead */}
              <Playhead height={totalTrackHeight} />
            </div>
          </div>
        </div>

        {/* Footer with duration display */}
        <div className="bg-muted/30 flex justify-between border-t px-4 py-2 text-sm">
          <span className="text-muted-foreground">
            Position: {formatTimecode(state.playheadFrame, state.fps)}
          </span>
          <span className="text-muted-foreground">
            Duration: {formatTimecode(state.totalFrames, state.fps)} |{' '}
            {state.fps} fps
          </span>
        </div>
      </Card>

      {/* Clip Editor Modal */}
      {editingClip && (
        <ClipEditor
          clip={editingClip.clip}
          track={editingClip.track}
          isOpen={state.editingClipId !== null}
          fps={state.fps}
          onClose={handleClipEditorClose}
          onSave={handleClipEditorSave}
        />
      )}
    </TimelineContext.Provider>
  );
}
