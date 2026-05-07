'use client';

/**
 * ThumbnailStrip — canvas strip of video frames on video clip blocks.
 *
 * Extracts frames at regular intervals from the clip's media URL
 * using a hidden <video> + <canvas>, then renders as a horizontal strip.
 * Thumbnails are cached per mediaUrl at the module level.
 */
import { useEffect, useMemo, useRef, useState } from 'react';

// ──────────────────────────────────────────
// Module-level cache
// ──────────────────────────────────────────

/** Cache of extracted thumbnails per mediaUrl → array of ImageBitmap */
const thumbnailCache = new Map<string, ImageBitmap[]>();
const THUMBNAIL_HEIGHT = 40;
const THUMBNAIL_INTERVAL_SEC = 2; // Extract one frame every N seconds

// ──────────────────────────────────────────
// Component
// ──────────────────────────────────────────

interface ThumbnailStripProps {
  /** URL of the video source */
  mediaUrl: string;
  /** Clip in-point in ms */
  inPointMs: number;
  /** Clip out-point in ms */
  outPointMs: number;
  /** Rendered width in px */
  widthPx: number;
  /** Playback speed (affects visible region) */
  speed: number;
}

export function ThumbnailStrip({
  mediaUrl,
  inPointMs,
  outPointMs,
  widthPx,
  speed,
}: ThumbnailStripProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [thumbnails, setThumbnails] = useState<ImageBitmap[] | null>(null);

  // Total source duration of the clip
  const sourceDurationSec = useMemo(
    () => (outPointMs - inPointMs) / 1000,
    [inPointMs, outPointMs],
  );

  // Number of thumbnails to extract for the entire source
  const thumbCount = useMemo(
    () => Math.max(1, Math.ceil(sourceDurationSec / THUMBNAIL_INTERVAL_SEC)),
    [sourceDurationSec],
  );

  // Extract thumbnails
  useEffect(() => {
    if (!mediaUrl || widthPx < 10) return;

    // Check cache
    const cached = thumbnailCache.get(mediaUrl);
    if (cached) {
      setThumbnails(cached);
      return;
    }

    let cancelled = false;

    const extractThumbnails = async () => {
      const video = document.createElement('video');
      video.crossOrigin = 'anonymous';
      video.preload = 'auto';
      video.muted = true;

      const loadPromise = new Promise<void>((resolve, reject) => {
        video.onloadeddata = () => resolve();
        video.onerror = () => reject(new Error('Video load failed'));
      });

      video.src = mediaUrl;

      try {
        await loadPromise;
      } catch {
        return;
      }

      if (cancelled) return;

      const vw = video.videoWidth;
      const vh = video.videoHeight;
      if (vw === 0 || vh === 0) return;

      // Calculate thumbnail width maintaining aspect ratio
      const thumbW = Math.round((vw / vh) * THUMBNAIL_HEIGHT);

      const offscreen = document.createElement('canvas');
      offscreen.width = thumbW;
      offscreen.height = THUMBNAIL_HEIGHT;
      const ctx = offscreen.getContext('2d');
      if (!ctx) return;

      const bitmaps: ImageBitmap[] = [];

      // Extract frames at intervals across the source
      const totalDuration = video.duration;
      const interval = totalDuration / Math.max(1, thumbCount);

      for (let i = 0; i < thumbCount && !cancelled; i++) {
        const seekTime = Math.min(i * interval, totalDuration - 0.01);

        await new Promise<void>((resolve) => {
          video.onseeked = () => resolve();
          video.currentTime = seekTime;
        });

        if (cancelled) break;

        ctx.drawImage(video, 0, 0, thumbW, THUMBNAIL_HEIGHT);

        try {
          const bitmap = await createImageBitmap(offscreen);
          bitmaps.push(bitmap);
        } catch {
          // createImageBitmap not supported or failed
          break;
        }
      }

      if (!cancelled && bitmaps.length > 0) {
        thumbnailCache.set(mediaUrl, bitmaps);
        setThumbnails(bitmaps);
      }

      // Cleanup
      video.removeAttribute('src');
      video.load();
    };

    void extractThumbnails();

    return () => {
      cancelled = true;
    };
  }, [mediaUrl, widthPx, thumbCount]);

  // Draw thumbnails on canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !thumbnails || thumbnails.length === 0) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = typeof window !== 'undefined' ? window.devicePixelRatio : 1;
    const h = THUMBNAIL_HEIGHT;

    canvas.width = widthPx * dpr;
    canvas.height = h * dpr;
    ctx.scale(dpr, dpr);

    ctx.clearRect(0, 0, widthPx, h);

    // Calculate how many thumbnails fit in the visible width
    if (thumbnails.length === 0) return;

    const thumbW = thumbnails[0]!.width * (h / thumbnails[0]!.height);
    const thumbsInView = Math.ceil(widthPx / thumbW) + 1;

    // Map inPoint to thumbnail index using source duration fraction
    const startFraction = inPointMs / 1000 / sourceDurationSec;
    const startThumbIdx = Math.floor(startFraction * thumbnails.length);

    for (let i = 0; i < thumbsInView; i++) {
      let idx = (startThumbIdx + i) % thumbnails.length;
      if (idx < 0) idx += thumbnails.length;
      if (idx >= thumbnails.length) continue;

      const bitmap = thumbnails[idx]!;
      const x = i * thumbW;

      if (x >= widthPx) break;

      const drawW = Math.min(thumbW, widthPx - x);
      ctx.drawImage(bitmap, 0, 0, bitmap.width, bitmap.height, x, 0, drawW, h);
    }
  }, [thumbnails, widthPx, inPointMs, sourceDurationSec, speed]);

  if (widthPx < 20) return null;

  return (
    <canvas
      ref={canvasRef}
      className="pointer-events-none absolute inset-0 opacity-50"
      style={{
        width: `${widthPx}px`,
        height: `${THUMBNAIL_HEIGHT}px`,
      }}
    />
  );
}
