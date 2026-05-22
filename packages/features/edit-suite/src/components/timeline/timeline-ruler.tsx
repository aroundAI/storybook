'use client';

/**
 * TimelineRuler — time markers at the top of the timeline.
 *
 * Renders adaptive tick marks based on zoom level.
 * Click to jump playhead to that position.
 */
import type { Dispatch } from 'react';

import type { EditAction } from '../../state/types';

interface TimelineRulerProps {
  durationMs: number;
  zoom: number; // px per second
  dispatch: Dispatch<EditAction>;
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

/**
 * Choose tick interval (in seconds) based on zoom level to avoid
 * overcrowding or underpopulating the ruler.
 */
function getTickInterval(zoom: number): number {
  if (zoom >= 200) return 0.5;
  if (zoom >= 100) return 1;
  if (zoom >= 50) return 2;
  if (zoom >= 25) return 5;
  if (zoom >= 10) return 10;
  return 30;
}

export function TimelineRuler({
  durationMs,
  zoom,
  dispatch,
}: TimelineRulerProps) {
  const durationSeconds = durationMs / 1000;
  const tickInterval = getTickInterval(zoom);
  const totalWidthPx = durationSeconds * zoom;

  // Generate ticks
  const ticks: Array<{ seconds: number; isMajor: boolean }> = [];
  for (let s = 0; s <= durationSeconds; s += tickInterval) {
    // Major ticks every 5× the interval (e.g., if interval=1s, major every 5s)
    const majorMultiple = tickInterval < 5 ? 5 : tickInterval < 30 ? 10 : 60;
    const isMajor = s % majorMultiple === 0;
    ticks.push({ seconds: s, isMajor });
  }

  const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const offsetX = e.clientX - rect.left;
    const ms = Math.max(0, Math.round((offsetX / zoom) * 1000));
    dispatch({ type: 'SET_PLAYHEAD', payload: { ms } });
  };

  return (
    <div
      className="relative h-6 cursor-pointer border-b border-zinc-700 bg-zinc-900/50"
      style={{ width: `${totalWidthPx}px` }}
      onClick={handleClick}
    >
      {ticks.map((tick) => {
        const leftPx = tick.seconds * zoom;
        return (
          <div
            key={tick.seconds}
            className="absolute top-0"
            style={{ left: `${leftPx}px` }}
          >
            {/* Tick line */}
            <div
              className={`border-l ${tick.isMajor ? 'h-4 border-zinc-500' : 'h-2 border-zinc-700'}`}
            />
            {/* Label (major ticks only) */}
            {tick.isMajor && (
              <span className="absolute left-0.5 top-2.5 select-none whitespace-nowrap text-[9px] text-zinc-500">
                {formatTime(tick.seconds)}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
