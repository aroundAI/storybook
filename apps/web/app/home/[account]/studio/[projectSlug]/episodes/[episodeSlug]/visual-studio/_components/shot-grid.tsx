'use client';

import { useState } from 'react';

import { PlusCircle } from 'lucide-react';

import type { Shot } from '@kit/episodes/types';

import { ShotCard } from './shot-card';
import {
  type SelectionModifiers,
  isNavigationKey,
  nextFocusIndex,
} from './shot-selection';
import { getShotSize } from './visual-studio-utils';

interface ShotGridProps {
  shotsByScene: Record<number, Shot[]>;
  selectedShotIds: ReadonlySet<string>;
  onShotSelect: (shot: Shot, modifiers: SelectionModifiers) => void;
  onClearSelection: () => void;
}

export function ShotGrid({
  shotsByScene,
  selectedShotIds,
  onShotSelect,
  onClearSelection,
}: ShotGridProps) {
  const [focusedShotId, setFocusedShotId] = useState<string | null>(null);

  const sceneEntries = Object.entries(shotsByScene).sort(
    ([a], [b]) => parseInt(a) - parseInt(b),
  );

  if (sceneEntries.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-gray-500 dark:text-gray-400">
        No shots match the current filters
      </div>
    );
  }

  const allShots = sceneEntries.flatMap(([, sceneShots]) => sceneShots);
  const tabStopId = allShots.some((shot) => shot.id === focusedShotId)
    ? focusedShotId
    : allShots[0]?.id;

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      onClearSelection();
      return;
    }

    if (!isNavigationKey(event.key)) return;

    const cards = Array.from(
      event.currentTarget.querySelectorAll<HTMLElement>('[role="option"]'),
    );
    const index = cards.indexOf(event.target as HTMLElement);
    if (index === -1) return;

    const grid = (event.target as HTMLElement).closest('[role="listbox"]');
    const columns = grid
      ? getComputedStyle(grid).gridTemplateColumns.split(' ').length
      : 1;

    event.preventDefault();
    cards[
      nextFocusIndex({
        key: event.key,
        index,
        sceneLengths: sceneEntries.map(([, sceneShots]) => sceneShots.length),
        columns,
      })
    ]?.focus();
  };

  return (
    <div className="space-y-12" onKeyDown={handleKeyDown}>
      {sceneEntries.map(([sceneNum, sceneShots]) => (
        <div key={sceneNum} className="flex items-start gap-6">
          {/* Rotated Scene Title */}
          <div className="scene-title-rotator sticky top-8 flex h-[250px] min-w-[40px] items-center justify-center">
            Scene {sceneNum}
          </div>

          {/* Comic Strip Grid */}
          <div
            role="listbox"
            aria-multiselectable="true"
            aria-label={`Scene ${sceneNum} shots`}
            data-test="shot-grid"
            className="grid flex-1 auto-rows-min grid-cols-1 gap-8 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6"
          >
            {sceneShots.map((shot, index) => (
              <ShotCard
                key={shot.id}
                shot={shot}
                size={getShotSize(index)}
                isSelected={selectedShotIds.has(shot.id)}
                tabIndex={shot.id === tabStopId ? 0 : -1}
                onFocus={() => setFocusedShotId(shot.id)}
                onSelect={(modifiers) => onShotSelect(shot, modifiers)}
              />
            ))}

            {/* Add New Shot Card */}
            <div
              role="presentation"
              className="liquid-card flex min-h-[200px] cursor-pointer flex-col items-center justify-center border border-dashed border-gray-300 bg-gray-50/50 p-4 text-gray-500 transition-colors hover:bg-gray-100/50 dark:border-white/10 dark:bg-[#1A1A1A] dark:text-[#A3A3A3] dark:hover:bg-[#252525]"
            >
              <PlusCircle className="mb-2 h-10 w-10" />
              <span className="text-sm font-medium">Add New Shot</span>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
