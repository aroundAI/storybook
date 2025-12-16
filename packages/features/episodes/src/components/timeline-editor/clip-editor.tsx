'use client';

/**
 * Clip Editor - Modal dialog for editing individual clips
 *
 * Provides trim controls, speed adjustment, audio settings (for non-video tracks),
 * and metadata editing. Opens when double-clicking a clip on the timeline.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import { Pause, Play, RotateCcw } from 'lucide-react';

import { Button } from '@kit/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@kit/ui/dialog';
import { Input } from '@kit/ui/input';
import { Label } from '@kit/ui/label';
import { Slider } from '@kit/ui/slider';
import { Textarea } from '@kit/ui/textarea';

import { DualRangeSlider } from './dual-range-slider';
import type { TimelineClip, TimelineTrack } from './types';

// ============================================================================
// Types
// ============================================================================

interface ClipEditorProps {
  /** Clip being edited */
  clip: TimelineClip;
  /** Parent track (determines if audio/video) */
  track: TimelineTrack;
  /** Whether the dialog is open */
  isOpen: boolean;
  /** Frames per second */
  fps: number;
  /** Callback when dialog closes */
  onClose: () => void;
  /** Callback when changes are saved */
  onSave: (updates: Partial<TimelineClip>) => void;
}

interface ClipEditorState {
  sourceStartFrame: number;
  sourceEndFrame: number;
  speed: number;
  volume: number;
  fadeInSeconds: number;
  fadeOutSeconds: number;
  pitchSemitones: number;
  name: string;
  notes: string;
}

// ============================================================================
// Helpers
// ============================================================================

function formatTimecode(frames: number, fps: number): string {
  const totalSeconds = frames / fps;
  const mins = Math.floor(totalSeconds / 60);
  const secs = Math.floor(totalSeconds % 60);
  const remainingFrames = Math.floor(frames % fps);
  return `${mins}:${secs.toString().padStart(2, '0')}:${remainingFrames.toString().padStart(2, '0')}`;
}

// ============================================================================
// Component
// ============================================================================

export function ClipEditor({
  clip,
  track,
  isOpen,
  fps,
  onClose,
  onSave,
}: ClipEditorProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);

  // Determine source duration (original asset length)
  const sourceDurationFrames = clip.sourceDurationFrames ?? clip.durationFrames;

  // Initialize state from clip data
  const [state, setState] = useState<ClipEditorState>(() => ({
    sourceStartFrame: clip.sourceStartFrame ?? 0,
    sourceEndFrame: clip.sourceEndFrame ?? sourceDurationFrames,
    speed: clip.metadata?.speed ?? 1,
    volume: clip.metadata?.volume ?? 1,
    fadeInSeconds: clip.metadata?.fadeInSeconds ?? 0,
    fadeOutSeconds: clip.metadata?.fadeOutSeconds ?? 0,
    pitchSemitones: clip.metadata?.pitchSemitones ?? 0,
    name: clip.name,
    notes: clip.notes ?? '',
  }));

  // Reset state when clip changes
  useEffect(() => {
    const srcDuration = clip.sourceDurationFrames ?? clip.durationFrames;
    setState({
      sourceStartFrame: clip.sourceStartFrame ?? 0,
      sourceEndFrame: clip.sourceEndFrame ?? srcDuration,
      speed: clip.metadata?.speed ?? 1,
      volume: clip.metadata?.volume ?? 1,
      fadeInSeconds: clip.metadata?.fadeInSeconds ?? 0,
      fadeOutSeconds: clip.metadata?.fadeOutSeconds ?? 0,
      pitchSemitones: clip.metadata?.pitchSemitones ?? 0,
      name: clip.name,
      notes: clip.notes ?? '',
    });
  }, [clip]);

  // Derived values
  const selectedDurationFrames = state.sourceEndFrame - state.sourceStartFrame;
  const outputDurationFrames = Math.round(selectedDurationFrames / state.speed);

  // Is this an audio track?
  const isAudioTrack = track.type !== 'video';

  // Preview playback - loop within selected range
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !isPlaying) return;

    const startTime = state.sourceStartFrame / fps;
    const endTime = state.sourceEndFrame / fps;

    video.currentTime = startTime;
    video.playbackRate = state.speed;
    video.play().catch(() => {});

    const handleTimeUpdate = () => {
      if (video.currentTime >= endTime) {
        video.currentTime = startTime;
      }
    };

    video.addEventListener('timeupdate', handleTimeUpdate);
    return () => {
      video.removeEventListener('timeupdate', handleTimeUpdate);
      video.pause();
    };
  }, [
    isPlaying,
    state.sourceStartFrame,
    state.sourceEndFrame,
    state.speed,
    fps,
  ]);

  // Stop playback when dialog closes
  useEffect(() => {
    if (!isOpen) {
      setIsPlaying(false);
    }
  }, [isOpen]);

  const handleSave = useCallback(() => {
    const updates: Partial<TimelineClip> = {
      name: state.name,
      notes: state.notes,
      sourceStartFrame: state.sourceStartFrame,
      sourceEndFrame: state.sourceEndFrame,
      durationFrames: outputDurationFrames,
      metadata: {
        ...clip.metadata,
        speed: state.speed,
        ...(isAudioTrack && {
          volume: state.volume,
          fadeInSeconds: state.fadeInSeconds,
          fadeOutSeconds: state.fadeOutSeconds,
          pitchSemitones: state.pitchSemitones,
        }),
      },
    };
    onSave(updates);
  }, [state, outputDurationFrames, clip.metadata, isAudioTrack, onSave]);

  const handleResetPlayhead = useCallback(() => {
    const video = videoRef.current;
    if (video) {
      video.currentTime = state.sourceStartFrame / fps;
    }
  }, [state.sourceStartFrame, fps]);

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit Clip: {clip.name}</DialogTitle>
        </DialogHeader>

        <div className="space-y-6">
          {/* Video Preview (video tracks only) */}
          {track.type === 'video' && clip.videoUrl && (
            <div className="relative aspect-video overflow-hidden rounded-lg bg-black">
              <video
                ref={videoRef}
                src={clip.videoUrl}
                className="h-full w-full object-contain"
                muted
                playsInline
              />
              <div className="absolute bottom-2 left-2 flex gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => setIsPlaying(!isPlaying)}
                >
                  {isPlaying ? (
                    <Pause className="h-4 w-4" />
                  ) : (
                    <Play className="h-4 w-4" />
                  )}
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={handleResetPlayhead}
                >
                  <RotateCcw className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}

          {/* Trim Range Selector */}
          <div className="space-y-2">
            <Label>Trim Range</Label>
            <DualRangeSlider
              value={[state.sourceStartFrame, state.sourceEndFrame]}
              min={0}
              max={sourceDurationFrames}
              step={1}
              onValueChange={([start, end]) =>
                setState((s) => ({
                  ...s,
                  sourceStartFrame: start,
                  sourceEndFrame: end,
                }))
              }
            />
            <div className="text-muted-foreground flex justify-between text-xs">
              <span>In: {formatTimecode(state.sourceStartFrame, fps)}</span>
              <span>
                Duration: {formatTimecode(selectedDurationFrames, fps)}
              </span>
              <span>Out: {formatTimecode(state.sourceEndFrame, fps)}</span>
            </div>
          </div>

          {/* Speed Control */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Speed</Label>
              <Slider
                value={[state.speed * 100]}
                min={50}
                max={200}
                step={5}
                onValueChange={(values) =>
                  setState((s) => ({ ...s, speed: (values[0] ?? 100) / 100 }))
                }
              />
              <div className="text-muted-foreground text-center text-sm">
                {state.speed.toFixed(2)}x
              </div>
            </div>

            {/* Volume Control (audio tracks only) */}
            {isAudioTrack && (
              <div className="space-y-2">
                <Label>Volume</Label>
                <Slider
                  value={[state.volume * 100]}
                  min={0}
                  max={150}
                  step={5}
                  onValueChange={(values) =>
                    setState((s) => ({
                      ...s,
                      volume: (values[0] ?? 100) / 100,
                    }))
                  }
                />
                <div className="text-muted-foreground text-center text-sm">
                  {Math.round(state.volume * 100)}%
                </div>
              </div>
            )}
          </div>

          {/* Fade Controls (audio tracks only) */}
          {isAudioTrack && (
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Fade In</Label>
                <Slider
                  value={[state.fadeInSeconds * 10]}
                  min={0}
                  max={30}
                  step={1}
                  onValueChange={(values) =>
                    setState((s) => ({
                      ...s,
                      fadeInSeconds: (values[0] ?? 0) / 10,
                    }))
                  }
                />
                <div className="text-muted-foreground text-center text-sm">
                  {state.fadeInSeconds.toFixed(1)}s
                </div>
              </div>
              <div className="space-y-2">
                <Label>Fade Out</Label>
                <Slider
                  value={[state.fadeOutSeconds * 10]}
                  min={0}
                  max={30}
                  step={1}
                  onValueChange={(values) =>
                    setState((s) => ({
                      ...s,
                      fadeOutSeconds: (values[0] ?? 0) / 10,
                    }))
                  }
                />
                <div className="text-muted-foreground text-center text-sm">
                  {state.fadeOutSeconds.toFixed(1)}s
                </div>
              </div>
            </div>
          )}

          {/* Pitch Control (audio tracks only) */}
          {isAudioTrack && (
            <div className="space-y-2">
              <Label>Pitch Adjustment</Label>
              <Slider
                value={[state.pitchSemitones]}
                min={-12}
                max={12}
                step={1}
                onValueChange={(values) =>
                  setState((s) => ({ ...s, pitchSemitones: values[0] ?? 0 }))
                }
              />
              <div className="text-muted-foreground text-center text-sm">
                {state.pitchSemitones > 0 ? '+' : ''}
                {state.pitchSemitones} semitones
              </div>
            </div>
          )}

          {/* Metadata Fields */}
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="clip-name">Name</Label>
              <Input
                id="clip-name"
                value={state.name}
                onChange={(e) =>
                  setState((s) => ({ ...s, name: e.target.value }))
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="clip-notes">Notes</Label>
              <Textarea
                id="clip-notes"
                value={state.notes}
                onChange={(e) =>
                  setState((s) => ({ ...s, notes: e.target.value }))
                }
                rows={2}
              />
            </div>
          </div>

          {/* Output Duration Info */}
          <div className="bg-muted/50 text-muted-foreground rounded p-3 text-sm">
            <strong>Output duration:</strong>{' '}
            {formatTimecode(outputDurationFrames, fps)}
            {state.speed !== 1 && (
              <span className="ml-2 text-xs">
                (adjusted from {formatTimecode(selectedDurationFrames, fps)} at{' '}
                {state.speed}x)
              </span>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleSave}>Apply Changes</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
