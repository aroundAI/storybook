'use client';

import * as React from 'react';
import { useCallback, useEffect, useRef } from 'react';

import { cn } from '@kit/ui/utils';

import type { WaveformData } from '../lib/audio';

export interface WaveformProps {
  /** Waveform amplitude data */
  waveformData: WaveformData | null;
  /** Current playback time in seconds */
  currentTime: number;
  /** Total audio duration in seconds */
  duration: number;
  /** Callback when user clicks to seek */
  onSeek: (time: number) => void;
  /** Whether waveform data is loading */
  isLoading?: boolean;
  /** Additional CSS classes */
  className?: string;
}

const BAR_WIDTH = 2;
const BAR_GAP = 1;
const BAR_RADIUS = 1;

/**
 * Waveform visualization component with click-to-seek functionality
 *
 * Renders audio waveform as vertical bars on a canvas element.
 * Played portion is shown in primary color, unplayed in muted color.
 */
export const Waveform = React.forwardRef<HTMLDivElement, WaveformProps>(
  (
    { waveformData, currentTime, duration, onSeek, isLoading, className },
    ref,
  ) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);

    // Calculate progress percentage
    const progress = duration > 0 ? currentTime / duration : 0;

    // Draw waveform on canvas
    const drawWaveform = useCallback(() => {
      const canvas = canvasRef.current;
      const container = containerRef.current;
      if (!canvas || !container) return;

      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      // Get device pixel ratio for sharp rendering
      const dpr = window.devicePixelRatio || 1;
      const rect = container.getBoundingClientRect();

      // Set canvas size accounting for device pixel ratio
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;
      ctx.scale(dpr, dpr);

      const width = rect.width;
      const height = rect.height;

      // Clear canvas
      ctx.clearRect(0, 0, width, height);

      // Get computed colors from CSS variables
      const styles = getComputedStyle(container);
      const playedColor =
        styles.getPropertyValue('--primary').trim() || '221.2 83.2% 53.3%';
      const unplayedColor =
        styles.getPropertyValue('--muted').trim() || '210 40% 96.1%';

      if (!waveformData?.amplitudes) {
        // Draw placeholder bars if no data
        drawPlaceholder(ctx, width, height, unplayedColor);
        return;
      }

      const amplitudes = waveformData.amplitudes;
      const totalBars = amplitudes.length;
      const totalWidth = totalBars * (BAR_WIDTH + BAR_GAP) - BAR_GAP;
      const startX = (width - totalWidth) / 2;

      // Draw each bar
      for (let i = 0; i < totalBars; i++) {
        const amplitude = amplitudes[i] ?? 0;
        const barHeight = Math.max(2, amplitude * height * 0.8);
        const x = startX + i * (BAR_WIDTH + BAR_GAP);
        const y = (height - barHeight) / 2;

        // Determine if this bar is in the played portion
        const barProgress = (i + 0.5) / totalBars;
        const isPlayed = barProgress <= progress;

        ctx.fillStyle = isPlayed
          ? `hsl(${playedColor})`
          : `hsl(${unplayedColor})`;

        // Draw rounded bar
        drawRoundedRect(ctx, x, y, BAR_WIDTH, barHeight, BAR_RADIUS);
      }
    }, [waveformData, progress]);

    // Handle canvas resize
    useEffect(() => {
      const container = containerRef.current;
      if (!container) return;

      const resizeObserver = new ResizeObserver(() => {
        drawWaveform();
      });

      resizeObserver.observe(container);
      drawWaveform();

      return () => {
        resizeObserver.disconnect();
      };
    }, [drawWaveform]);

    // Handle click to seek
    const handleClick = useCallback(
      (event: React.MouseEvent<HTMLCanvasElement>) => {
        const canvas = canvasRef.current;
        if (!canvas || duration <= 0) return;

        const rect = canvas.getBoundingClientRect();
        const clickX = event.clientX - rect.left;
        const clickProgress = clickX / rect.width;
        const seekTime = clickProgress * duration;

        onSeek(Math.max(0, Math.min(seekTime, duration)));
      },
      [duration, onSeek],
    );

    // Handle keyboard seek
    const handleKeyDown = useCallback(
      (event: React.KeyboardEvent<HTMLCanvasElement>) => {
        if (duration <= 0) return;

        const seekAmount = event.shiftKey ? 10 : 5;

        switch (event.key) {
          case 'ArrowLeft':
            event.preventDefault();
            onSeek(Math.max(0, currentTime - seekAmount));
            break;
          case 'ArrowRight':
            event.preventDefault();
            onSeek(Math.min(duration, currentTime + seekAmount));
            break;
        }
      },
      [currentTime, duration, onSeek],
    );

    return (
      <div
        ref={(node) => {
          containerRef.current = node;
          if (typeof ref === 'function') {
            ref(node);
          } else if (ref) {
            ref.current = node;
          }
        }}
        className={cn('relative h-[100px] w-full', className)}
        data-test="waveform-container"
      >
        {isLoading ? (
          <div
            className="absolute inset-0 flex animate-pulse items-center justify-center rounded bg-muted/50"
            aria-label="Loading waveform"
          >
            <div className="h-1/2 w-full rounded bg-muted" />
          </div>
        ) : (
          <canvas
            ref={canvasRef}
            className="h-full w-full cursor-pointer"
            onClick={handleClick}
            onKeyDown={handleKeyDown}
            tabIndex={0}
            role="slider"
            aria-label="Audio waveform"
            aria-valuemin={0}
            aria-valuemax={duration}
            aria-valuenow={currentTime}
            aria-valuetext={`${Math.floor(currentTime)} of ${Math.floor(duration)} seconds`}
            data-test="waveform-canvas"
          />
        )}
      </div>
    );
  },
);

Waveform.displayName = 'Waveform';

/**
 * Draws a rounded rectangle on the canvas
 */
function drawRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + width - radius, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
  ctx.lineTo(x + width, y + height - radius);
  ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  ctx.lineTo(x + radius, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
  ctx.fill();
}

/**
 * Draws placeholder bars when no waveform data is available
 */
function drawPlaceholder(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  color: string,
): void {
  const placeholderBars = 50;
  const totalWidth = placeholderBars * (BAR_WIDTH + BAR_GAP) - BAR_GAP;
  const startX = (width - totalWidth) / 2;

  ctx.fillStyle = `hsl(${color})`;

  for (let i = 0; i < placeholderBars; i++) {
    // Create a simple pattern
    const amplitude = 0.3 + Math.sin((i / placeholderBars) * Math.PI) * 0.2;
    const barHeight = amplitude * height * 0.6;
    const x = startX + i * (BAR_WIDTH + BAR_GAP);
    const y = (height - barHeight) / 2;

    drawRoundedRect(ctx, x, y, BAR_WIDTH, barHeight, BAR_RADIUS);
  }
}
