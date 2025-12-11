'use client';

/**
 * Waveform Display - Canvas-based audio waveform visualization
 */
import { useEffect, useRef } from 'react';

import { cn } from '@kit/ui/utils';

// ============================================================================
// Types
// ============================================================================

interface WaveformDisplayProps {
  /** Waveform data (normalized values 0-1) */
  data: number[];
  /** Width in pixels */
  width: number;
  /** Height in pixels */
  height: number;
  /** Waveform color */
  color?: string;
  /** Additional CSS classes */
  className?: string;
}

// ============================================================================
// Component
// ============================================================================

export function WaveformDisplay({
  data,
  width,
  height,
  color = 'rgba(255, 255, 255, 0.6)',
  className,
}: WaveformDisplayProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Draw waveform on canvas when data or dimensions change
  // useEffect is required here because canvas drawing is an imperative DOM
  // operation that cannot be performed during React's declarative render phase
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || data.length === 0 || width <= 0 || height <= 0) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Clear canvas
    ctx.clearRect(0, 0, width, height);

    // Set fill color
    ctx.fillStyle = color;

    // Calculate how many samples per pixel
    const samplesPerPixel = Math.max(1, Math.ceil(data.length / width));
    const midHeight = height / 2;

    // Draw waveform bars
    for (let x = 0; x < width; x++) {
      const startSample = Math.floor((x / width) * data.length);
      const endSample = Math.min(startSample + samplesPerPixel, data.length);

      // Find max amplitude in this range
      let maxAmplitude = 0;
      for (let i = startSample; i < endSample; i++) {
        const sample = data[i];
        if (sample !== undefined) {
          maxAmplitude = Math.max(maxAmplitude, Math.abs(sample));
        }
      }

      // Draw bar
      const barHeight = maxAmplitude * midHeight;
      if (barHeight > 0) {
        ctx.fillRect(x, midHeight - barHeight, 1, barHeight * 2);
      }
    }
  }, [data, width, height, color]);

  return (
    <canvas
      ref={canvasRef}
      width={width}
      height={height}
      className={cn('block', className)}
    />
  );
}
