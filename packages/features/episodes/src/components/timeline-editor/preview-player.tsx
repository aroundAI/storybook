'use client';

/**
 * Preview Player - Video preview pane synced with timeline playhead
 */
import { useCallback, useEffect, useRef } from 'react';

import { Film, ImageOff } from 'lucide-react';

import { cn } from '@kit/ui/utils';

import type { TimelineClip } from './types';

// ============================================================================
// Types
// ============================================================================

interface PreviewPlayerProps {
  /** Current video clip at playhead position */
  clip: TimelineClip | null;
  /** Current frame position */
  currentFrame: number;
  /** Whether playback is active */
  isPlaying: boolean;
  /** Frames per second */
  fps: number;
  /** Additional CSS classes */
  className?: string;
}

// ============================================================================
// Component
// ============================================================================

export function PreviewPlayer({
  clip,
  currentFrame,
  isPlaying,
  fps,
  className,
}: PreviewPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const lastSeekRef = useRef<number>(-1);
  const isSeekingRef = useRef<boolean>(false);
  const pendingSeekRef = useRef<number | null>(null);

  // Calculate time within clip
  const clipTime = clip ? (currentFrame - clip.startFrame) / fps : 0;

  // Sync video with playhead - avoids race conditions by tracking seek state
  // useEffect is required here to perform imperative video.currentTime manipulation
  // which is a DOM side effect that cannot be done during render
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !clip?.videoUrl) return;

    // Calculate target time in video
    const targetTime = clipTime;

    // Only seek if we've moved significantly (more than half a frame)
    const timeDiff = Math.abs(video.currentTime - targetTime);
    const needsSeek =
      timeDiff > 0.5 / fps && lastSeekRef.current !== currentFrame;

    if (!needsSeek) return;

    // If a seek is already in progress, queue this one
    if (isSeekingRef.current) {
      pendingSeekRef.current = targetTime;
      lastSeekRef.current = currentFrame;
      return;
    }

    // Perform the seek
    isSeekingRef.current = true;
    video.currentTime = targetTime;
    lastSeekRef.current = currentFrame;

    // Handle seek completion
    const handleSeeked = () => {
      isSeekingRef.current = false;

      // If there's a pending seek, perform it
      if (pendingSeekRef.current !== null) {
        const pendingTime = pendingSeekRef.current;
        pendingSeekRef.current = null;
        isSeekingRef.current = true;
        video.currentTime = pendingTime;
      }
    };

    video.addEventListener('seeked', handleSeeked, { once: true });

    return () => {
      video.removeEventListener('seeked', handleSeeked);
    };
  }, [clip?.videoUrl, clipTime, currentFrame, fps]);

  // Handle play/pause
  // useEffect is required here to call imperative video.play() and video.pause()
  // methods which are DOM side effects that cannot be performed during render
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !clip?.videoUrl) return;

    if (isPlaying) {
      video.play().catch(() => {
        // Ignore autoplay errors
      });
    } else {
      video.pause();
    }
  }, [isPlaying, clip?.videoUrl]);

  // Handle video ended
  const handleVideoEnded = useCallback(() => {
    const video = videoRef.current;
    if (video) {
      video.currentTime = 0;
    }
  }, []);

  // No clip at current position
  if (!clip) {
    return (
      <div
        className={cn(
          'flex h-full w-full items-center justify-center bg-black',
          className,
        )}
      >
        <div className="text-muted-foreground flex flex-col items-center gap-2">
          <ImageOff className="h-12 w-12" />
          <span className="text-sm">No video at current position</span>
        </div>
      </div>
    );
  }

  // Clip without video URL
  if (!clip.videoUrl) {
    return (
      <div
        className={cn(
          'flex h-full w-full items-center justify-center bg-black',
          className,
        )}
      >
        {clip.thumbnailUrl ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={clip.thumbnailUrl}
            alt={clip.name}
            className="max-h-full max-w-full object-contain"
          />
        ) : (
          <div className="text-muted-foreground flex flex-col items-center gap-2">
            <Film className="h-12 w-12" />
            <span className="text-sm">{clip.name}</span>
          </div>
        )}
      </div>
    );
  }

  return (
    <div
      className={cn(
        'relative flex h-full w-full items-center justify-center bg-black',
        className,
      )}
    >
      <video
        ref={videoRef}
        src={clip.videoUrl}
        className="max-h-full max-w-full object-contain"
        onEnded={handleVideoEnded}
        playsInline
        muted
      />

      {/* Clip info overlay */}
      <div className="absolute bottom-4 left-4 rounded bg-black/60 px-3 py-1 text-sm text-white">
        {clip.name}
      </div>
    </div>
  );
}
