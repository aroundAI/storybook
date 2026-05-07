'use client';

/**
 * TransitionPicker — dropdown grid to select transition type and duration.
 *
 * Rendered from TransitionHandle when clicked.
 * Shows a grid of transition type cards + a duration slider.
 */
import { useEffect, useRef, useState } from 'react';

import type { TransitionType } from '../../lib/schemas';

// ──────────────────────────────────────────
// Constants
// ──────────────────────────────────────────

const TRANSITION_OPTIONS: {
  type: TransitionType;
  label: string;
  icon: string;
}[] = [
  { type: 'cut', label: 'Cut', icon: '✂' },
  { type: 'crossfade', label: 'Crossfade', icon: '✕' },
  { type: 'fade_black', label: 'Fade Black', icon: '◼' },
  { type: 'fade_white', label: 'Fade White', icon: '◻' },
  { type: 'dissolve', label: 'Dissolve', icon: '◈' },
  { type: 'wipe_left', label: 'Wipe Left', icon: '◀' },
  { type: 'wipe_right', label: 'Wipe Right', icon: '▶' },
];

const MIN_DURATION_MS = 100;
const MAX_DURATION_MS = 3000;
const STEP_MS = 50;

// ──────────────────────────────────────────
// Component
// ──────────────────────────────────────────

interface TransitionPickerProps {
  currentType: TransitionType;
  currentDurationMs: number;
  onApply: (type: TransitionType, durationMs: number) => void;
  onClose: () => void;
}

export function TransitionPicker({
  currentType,
  currentDurationMs,
  onApply,
  onClose,
}: TransitionPickerProps) {
  const [selectedType, setSelectedType] = useState<TransitionType>(currentType);
  const [durationMs, setDurationMs] = useState(currentDurationMs);
  const containerRef = useRef<HTMLDivElement>(null);

  // Close on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        onClose();
      }
    };

    // Delay to avoid immediate close from the click that opened the picker
    const timer = setTimeout(() => {
      document.addEventListener('mousedown', handleClickOutside);
    }, 100);

    return () => {
      clearTimeout(timer);
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [onClose]);

  // Close on Escape
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose]);

  const handleApply = () => {
    onApply(selectedType, durationMs);
  };

  return (
    <div
      ref={containerRef}
      className="w-56 rounded-lg border border-zinc-700 bg-zinc-900 p-3 shadow-xl"
      onClick={(e) => e.stopPropagation()}
    >
      {/* Header */}
      <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
        Transition
      </div>

      {/* Type grid */}
      <div className="mb-3 grid grid-cols-4 gap-1">
        {TRANSITION_OPTIONS.map(({ type, label, icon }) => (
          <button
            key={type}
            className={`flex flex-col items-center gap-0.5 rounded-md p-1.5 text-[10px] transition-colors ${
              selectedType === type
                ? 'bg-violet-600/40 text-violet-200 ring-1 ring-violet-500/60'
                : 'text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200'
            }`}
            onClick={() => setSelectedType(type)}
            title={label}
          >
            <span className="text-sm">{icon}</span>
            <span className="truncate">{label}</span>
          </button>
        ))}
      </div>

      {/* Duration slider (hidden for 'cut') */}
      {selectedType !== 'cut' && (
        <div className="mb-3">
          <div className="mb-1 flex items-center justify-between text-[10px] text-zinc-400">
            <span>Duration</span>
            <span className="font-mono">{(durationMs / 1000).toFixed(1)}s</span>
          </div>
          <input
            type="range"
            min={MIN_DURATION_MS}
            max={MAX_DURATION_MS}
            step={STEP_MS}
            value={durationMs}
            onChange={(e) => setDurationMs(parseInt(e.target.value, 10))}
            className="h-1 w-full cursor-pointer accent-violet-500"
          />
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-1.5">
        <button
          className="flex-1 rounded-md bg-violet-600 px-2 py-1 text-[10px] font-medium text-white transition-colors hover:bg-violet-500"
          onClick={handleApply}
        >
          Apply
        </button>
        <button
          className="rounded-md bg-zinc-800 px-2 py-1 text-[10px] text-zinc-400 transition-colors hover:bg-zinc-700 hover:text-zinc-200"
          onClick={onClose}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
