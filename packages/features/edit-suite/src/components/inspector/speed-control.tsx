'use client';

/**
 * SpeedControl — inspector widget to adjust the playback speed of the selected clip.
 *
 * Includes a slider (0.25×–4×) with preset buttons.
 * When speed changes, recalculates clip endMs to maintain visual duration on timeline.
 */
import { useCallback } from 'react';
import type { Dispatch } from 'react';

import type { EditClip } from '../../lib/types';
import type { EditAction } from '../../state/types';

// ──────────────────────────────────────────
// Constants
// ──────────────────────────────────────────

const SPEED_PRESETS = [0.25, 0.5, 1, 1.5, 2, 4];
const MIN_SPEED = 0.25;
const MAX_SPEED = 4;
const SPEED_STEP = 0.05;

// ──────────────────────────────────────────
// Component
// ──────────────────────────────────────────

interface SpeedControlProps {
  clip: EditClip;
  dispatch: Dispatch<EditAction>;
}

export function SpeedControl({ clip, dispatch }: SpeedControlProps) {
  const handleSpeedChange = useCallback(
    (newSpeed: number) => {
      const clampedSpeed = Math.max(MIN_SPEED, Math.min(MAX_SPEED, newSpeed));

      // Recalculate endMs based on the new speed
      // Original source duration stays the same (outPointMs - inPointMs)
      const sourceDurationMs = clip.outPointMs - clip.inPointMs;
      const newTimelineDurationMs = sourceDurationMs / clampedSpeed;
      const newEndMs = clip.startMs + newTimelineDurationMs;

      dispatch({
        type: 'UPDATE_CLIP',
        payload: {
          clipId: clip.id,
          changes: {
            speed: clampedSpeed,
            endMs: Math.round(newEndMs),
          },
        },
      });
    },
    [clip.id, clip.startMs, clip.inPointMs, clip.outPointMs, dispatch],
  );

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between text-[10px] text-zinc-400">
        <span className="font-medium">Speed</span>
        <span className="font-mono text-zinc-300">
          {clip.speed.toFixed(2)}×
        </span>
      </div>

      {/* Slider */}
      <input
        type="range"
        min={MIN_SPEED}
        max={MAX_SPEED}
        step={SPEED_STEP}
        value={clip.speed}
        onChange={(e) => handleSpeedChange(parseFloat(e.target.value))}
        className="h-1 w-full cursor-pointer accent-violet-500"
      />

      {/* Preset buttons */}
      <div className="flex gap-1">
        {SPEED_PRESETS.map((speed) => (
          <button
            key={speed}
            className={`flex-1 rounded px-1 py-0.5 text-[9px] font-medium transition-colors ${
              Math.abs(clip.speed - speed) < 0.01
                ? 'bg-violet-600/50 text-violet-200'
                : 'bg-zinc-800 text-zinc-500 hover:bg-zinc-700 hover:text-zinc-300'
            }`}
            onClick={() => handleSpeedChange(speed)}
          >
            {speed}×
          </button>
        ))}
      </div>
    </div>
  );
}
