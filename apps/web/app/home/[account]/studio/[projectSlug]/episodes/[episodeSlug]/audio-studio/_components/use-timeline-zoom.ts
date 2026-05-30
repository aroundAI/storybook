'use client';

import { useCallback, useRef, useState } from 'react';

const ZOOM_LEVELS = [2, 5, 10, 20, 40, 60, 80, 120, 160, 200];

export interface TimelineZoomControls {
  pixelsPerSecond: number;
  timelineContainerRef: React.RefObject<HTMLDivElement | null>;
  zoomIn: () => void;
  zoomOut: () => void;
  fitToWindow: (totalDuration: number) => void;
}

export function useTimelineZoom(): TimelineZoomControls {
  const [pixelsPerSecond, setPixelsPerSecond] = useState(2);
  const timelineContainerRef = useRef<HTMLDivElement>(null);

  const zoomIn = useCallback(() => {
    const idx = ZOOM_LEVELS.findIndex((z) => z >= pixelsPerSecond);
    if (idx < ZOOM_LEVELS.length - 1) {
      setPixelsPerSecond(ZOOM_LEVELS[idx + 1]!);
    }
  }, [pixelsPerSecond]);

  const zoomOut = useCallback(() => {
    const idx = ZOOM_LEVELS.findIndex((z) => z >= pixelsPerSecond);
    if (idx > 0) {
      setPixelsPerSecond(ZOOM_LEVELS[idx - 1]!);
    }
  }, [pixelsPerSecond]);

  const fitToWindow = useCallback((totalDuration: number) => {
    const containerWidth = timelineContainerRef.current?.clientWidth ?? 800;
    // Leave some padding (280px for sidebar, 60px for margins)
    const availableWidth = containerWidth - 60;
    const newPPS = Math.floor(availableWidth / totalDuration);
    setPixelsPerSecond(Math.max(20, Math.min(200, newPPS)));
  }, []);

  return {
    pixelsPerSecond,
    timelineContainerRef,
    zoomIn,
    zoomOut,
    fitToWindow,
  };
}
