'use client';

/**
 * Waveform — canvas-based audio waveform visualization for clip blocks.
 *
 * Decodes audio via AudioEngine's buffer cache, downsamples to peaks,
 * and draws a filled waveform at the clip's zoom level.
 * Peaks are cached per mediaUrl to avoid redundant processing.
 */
import { useEffect, useRef, useState } from 'react';

import { useWaveformWorker } from '../../hooks/use-waveform-worker';

// ──────────────────────────────────────────
// Component
// ──────────────────────────────────────────

interface WaveformProps {
  /** URL of the audio source */
  mediaUrl: string;
  /** Clip in-point in ms (start of visible region in source) */
  inPointMs: number;
  /** Clip out-point in ms (end of visible region in source) */
  outPointMs: number;
  /** Rendered width of the clip block in px */
  widthPx: number;
  /** Height of the waveform canvas */
  heightPx: number;
  /** Color for the waveform fill (CSS color string) */
  color?: string;
  /** @deprecated — no longer needed, Worker handles decoding */
  getBuffer?: (url: string) => Promise<AudioBuffer | null>;
}

export function Waveform({
  mediaUrl,
  inPointMs,
  outPointMs,
  widthPx,
  heightPx,
  color = 'rgba(255, 255, 255, 0.35)',
}: WaveformProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [peaks, setPeaks] = useState<Float32Array | null>(null);
  const { requestPeaks } = useWaveformWorker();

  // Decode and extract peaks via Worker
  useEffect(() => {
    if (!mediaUrl || widthPx < 2) return;

    let cancelled = false;

    const loadPeaks = async () => {
      const result = await requestPeaks(mediaUrl);
      if (!result || cancelled) return;

      // Slice the full-resolution peaks to the visible region
      setPeaks(slicePeaks(result.peaks, inPointMs, outPointMs, widthPx));
    };

    void loadPeaks();

    return () => {
      cancelled = true;
    };
  }, [mediaUrl, inPointMs, outPointMs, widthPx, requestPeaks]);

  // Draw waveform when peaks change or dimensions change
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !peaks || peaks.length === 0) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const w = widthPx;
    const h = heightPx;
    const dpr = typeof window !== 'undefined' ? window.devicePixelRatio : 1;

    canvas.width = w * dpr;
    canvas.height = h * dpr;
    ctx.scale(dpr, dpr);

    ctx.clearRect(0, 0, w, h);

    // Draw filled waveform (mirrored around center)
    const centerY = h / 2;
    ctx.fillStyle = color;
    ctx.beginPath();

    // Top half
    ctx.moveTo(0, centerY);
    for (let i = 0; i < peaks.length; i++) {
      const x = (i / peaks.length) * w;
      const amp = peaks[i]! * centerY;
      ctx.lineTo(x, centerY - amp);
    }
    ctx.lineTo(w, centerY);

    // Bottom half (mirror)
    for (let i = peaks.length - 1; i >= 0; i--) {
      const x = (i / peaks.length) * w;
      const amp = peaks[i]! * centerY;
      ctx.lineTo(x, centerY + amp);
    }

    ctx.closePath();
    ctx.fill();
  }, [peaks, widthPx, heightPx, color]);

  if (widthPx < 4) return null;

  return (
    <canvas
      ref={canvasRef}
      className="pointer-events-none absolute inset-0"
      style={{
        width: `${widthPx}px`,
        height: `${heightPx}px`,
      }}
    />
  );
}

// ──────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────

/**
 * Slice a high-res peaks array to the visible region [inPointMs..outPointMs]
 * and resample to the target bucket width.
 */
function slicePeaks(
  fullPeaks: Float32Array,
  inPointMs: number,
  outPointMs: number,
  targetBuckets: number,
): Float32Array {
  if (fullPeaks.length === 0 || targetBuckets < 1) return new Float32Array(0);

  const msPerPeak = 1; // fullPeaks is ~1 peak per ms
  const totalDurationMs = fullPeaks.length * msPerPeak;

  // Map in/out points to indices in the full peaks array
  const startIdx = Math.max(
    0,
    Math.floor((inPointMs / totalDurationMs) * fullPeaks.length),
  );
  const endIdx = Math.min(
    fullPeaks.length,
    Math.ceil((outPointMs / totalDurationMs) * fullPeaks.length),
  );

  const sliceLength = endIdx - startIdx;
  if (sliceLength <= 0) return new Float32Array(targetBuckets);

  const result = new Float32Array(targetBuckets);
  const samplesPerBucket = sliceLength / targetBuckets;

  for (let i = 0; i < targetBuckets; i++) {
    const bStart = startIdx + Math.floor(i * samplesPerBucket);
    const bEnd = startIdx + Math.floor((i + 1) * samplesPerBucket);
    let max = 0;
    for (let j = bStart; j < Math.min(bEnd, endIdx); j++) {
      const abs = Math.abs(fullPeaks[j]!);
      if (abs > max) max = abs;
    }
    result[i] = max;
  }

  return result;
}
