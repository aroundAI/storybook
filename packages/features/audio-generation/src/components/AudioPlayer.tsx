'use client';

import * as React from 'react';
import { useCallback, useEffect } from 'react';

import { Loader2, Pause, Play, Volume2, VolumeX } from 'lucide-react';

import { Button } from '@kit/ui/button';
import { Slider } from '@kit/ui/slider';
import { Spinner } from '@kit/ui/spinner';
import { cn } from '@kit/ui/utils';

import { useAudioPlayer } from '../hooks/useAudioPlayer';
import { formatTime } from '../lib/audio';
import { Waveform } from './Waveform';

export interface AudioPlayerProps {
  /** URL of the audio file to play */
  audioUrl: string;
  /** Controlled playing state */
  isPlaying: boolean;
  /** Callback when play is requested */
  onPlay: () => void;
  /** Callback when pause is requested */
  onPause: () => void;
  /** Whether to start playing automatically */
  autoPlay?: boolean;
  /** Whether to show the waveform visualization (default: true) */
  showWaveform?: boolean;
  /** Additional CSS classes */
  className?: string;
}

/**
 * Professional audio player component with waveform visualization
 *
 * Features:
 * - Play/pause controls
 * - Volume control with mute toggle
 * - Progress bar with seeking
 * - Optional waveform visualization
 * - Keyboard shortcuts (Space, M, arrows)
 *
 * @example
 * ```tsx
 * function AudioPreview() {
 *   const [isPlaying, setIsPlaying] = useState(false);
 *
 *   return (
 *     <AudioPlayer
 *       audioUrl="https://example.com/audio.mp3"
 *       isPlaying={isPlaying}
 *       onPlay={() => setIsPlaying(true)}
 *       onPause={() => setIsPlaying(false)}
 *       showWaveform
 *     />
 *   );
 * }
 * ```
 */
export const AudioPlayer = React.forwardRef<HTMLDivElement, AudioPlayerProps>(
  (
    {
      audioUrl,
      isPlaying,
      onPlay,
      onPause,
      autoPlay = false,
      showWaveform = true,
      className,
    },
    ref,
  ) => {
    const {
      currentTime,
      duration,
      volume,
      isMuted,
      isBuffering,
      isLoading,
      isPlaying: internalIsPlaying,
      error,
      waveformData,
      play,
      pause,
      seek,
      setVolume,
      toggleMute,
    } = useAudioPlayer({
      audioUrl,
      autoPlay,
      generateWaveform: showWaveform,
      onPlay,
      onPause,
    });

    // Sync internal state with controlled isPlaying prop
    useEffect(() => {
      if (isPlaying && !internalIsPlaying && !isLoading) {
        play();
      } else if (!isPlaying && internalIsPlaying) {
        pause();
      }
    }, [isPlaying, internalIsPlaying, isLoading, play, pause]);

    // Handle keyboard shortcuts
    useEffect(() => {
      const handleKeyDown = (event: KeyboardEvent) => {
        // Skip if user is typing in an input
        if (
          event.target instanceof HTMLInputElement ||
          event.target instanceof HTMLTextAreaElement
        ) {
          return;
        }

        switch (event.key) {
          case ' ':
            event.preventDefault();
            if (internalIsPlaying) {
              pause();
            } else {
              play();
            }
            break;
          case 'm':
          case 'M':
            toggleMute();
            break;
          case 'ArrowLeft':
            event.preventDefault();
            seek(currentTime - (event.shiftKey ? 10 : 5));
            break;
          case 'ArrowRight':
            event.preventDefault();
            seek(currentTime + (event.shiftKey ? 10 : 5));
            break;
          case 'ArrowUp':
            event.preventDefault();
            setVolume(Math.min(1, volume + 0.1));
            break;
          case 'ArrowDown':
            event.preventDefault();
            setVolume(Math.max(0, volume - 0.1));
            break;
        }
      };

      document.addEventListener('keydown', handleKeyDown);
      return () => document.removeEventListener('keydown', handleKeyDown);
    }, [
      currentTime,
      internalIsPlaying,
      volume,
      play,
      pause,
      seek,
      setVolume,
      toggleMute,
    ]);

    // Handle progress slider change
    const handleProgressChange = useCallback(
      (value: number[]) => {
        const newTime = ((value[0] ?? 0) / 100) * duration;
        seek(newTime);
      },
      [duration, seek],
    );

    // Handle volume slider change
    const handleVolumeChange = useCallback(
      (value: number[]) => {
        setVolume((value[0] ?? 0) / 100);
      },
      [setVolume],
    );

    // Handle play/pause button click
    const handlePlayPauseClick = useCallback(() => {
      if (internalIsPlaying) {
        pause();
      } else {
        play();
      }
    }, [internalIsPlaying, play, pause]);

    // Calculate progress percentage
    const progressPercent = duration > 0 ? (currentTime / duration) * 100 : 0;

    // Render error state
    if (error) {
      return (
        <div
          ref={ref}
          className={cn(
            'bg-destructive/10 text-destructive flex items-center justify-center rounded-lg border p-4',
            className,
          )}
          data-test="audio-player-error"
        >
          <span className="text-sm">{error.message}</span>
        </div>
      );
    }

    return (
      <div
        ref={ref}
        className={cn(
          'bg-card flex flex-col gap-3 rounded-lg border p-4',
          className,
        )}
        data-test="audio-player"
      >
        {/* Waveform visualization */}
        {showWaveform && (
          <Waveform
            waveformData={waveformData}
            currentTime={currentTime}
            duration={duration}
            onSeek={seek}
            isLoading={isLoading && !waveformData}
          />
        )}

        {/* Controls row */}
        <div className="flex items-center gap-3">
          {/* Play/Pause button */}
          <Button
            variant="ghost"
            size="icon"
            onClick={handlePlayPauseClick}
            disabled={isLoading}
            aria-label={internalIsPlaying ? 'Pause' : 'Play'}
            data-test="audio-player-play-button"
          >
            {isLoading ? (
              <Spinner className="h-5 w-5" />
            ) : isBuffering ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : internalIsPlaying ? (
              <Pause className="h-5 w-5" />
            ) : (
              <Play className="h-5 w-5" />
            )}
          </Button>

          {/* Time display */}
          <span
            className="text-muted-foreground min-w-[80px] text-sm tabular-nums"
            data-test="audio-player-time"
          >
            {formatTime(currentTime)} / {formatTime(duration)}
          </span>

          {/* Progress slider */}
          <Slider
            value={[progressPercent]}
            onValueChange={handleProgressChange}
            max={100}
            step={0.1}
            className="flex-1"
            aria-label="Playback progress"
            data-test="audio-player-progress"
          />

          {/* Volume controls */}
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon"
              onClick={toggleMute}
              aria-label={isMuted ? 'Unmute' : 'Mute'}
              data-test="audio-player-mute-button"
            >
              {isMuted || volume === 0 ? (
                <VolumeX className="h-5 w-5" />
              ) : (
                <Volume2 className="h-5 w-5" />
              )}
            </Button>

            <Slider
              value={[isMuted ? 0 : volume * 100]}
              onValueChange={handleVolumeChange}
              max={100}
              step={1}
              className="w-24"
              aria-label="Volume"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={isMuted ? 0 : Math.round(volume * 100)}
              data-test="audio-player-volume"
            />
          </div>
        </div>
      </div>
    );
  },
);

AudioPlayer.displayName = 'AudioPlayer';
