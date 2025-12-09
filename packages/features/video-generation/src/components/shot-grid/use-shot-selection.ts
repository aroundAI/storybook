'use client';

import { useCallback, useEffect, useRef } from 'react';

import type { ShotGridShot } from './types';

interface UseShotSelectionOptions {
  shots: ShotGridShot[];
  selectedShotIds: string[];
  onSelectionChange: (shotIds: string[]) => void;
}

export function useShotSelection({
  shots,
  selectedShotIds,
  onSelectionChange,
}: UseShotSelectionOptions) {
  const lastSelectedIdRef = useRef<string | null>(null);

  // Sync the ref when selection is externally cleared
  // This prevents stale refs when parent clears selection without using handleClearSelection
  useEffect(() => {
    if (selectedShotIds.length === 0) {
      lastSelectedIdRef.current = null;
    }
  }, [selectedShotIds]);

  const handleShotClick = useCallback(
    (shotId: string, event: React.MouseEvent) => {
      const isMetaKey = event.metaKey || event.ctrlKey;
      const isShiftKey = event.shiftKey;

      if (isMetaKey) {
        // Multi-select: toggle the clicked shot
        if (selectedShotIds.includes(shotId)) {
          onSelectionChange(selectedShotIds.filter((id) => id !== shotId));
        } else {
          onSelectionChange([...selectedShotIds, shotId]);
          lastSelectedIdRef.current = shotId;
        }
      } else if (isShiftKey && lastSelectedIdRef.current) {
        // Range select: select all shots between last selected and current
        const lastIndex = shots.findIndex(
          (s) => s.id === lastSelectedIdRef.current,
        );
        const currentIndex = shots.findIndex((s) => s.id === shotId);

        if (lastIndex !== -1 && currentIndex !== -1) {
          const start = Math.min(lastIndex, currentIndex);
          const end = Math.max(lastIndex, currentIndex);
          const rangeIds = shots.slice(start, end + 1).map((s) => s.id);
          onSelectionChange(rangeIds);
        } else {
          // Fallback to single select if indices not found
          onSelectionChange([shotId]);
          lastSelectedIdRef.current = shotId;
        }
      } else {
        // Single select: replace selection with clicked shot
        onSelectionChange([shotId]);
        lastSelectedIdRef.current = shotId;
      }
    },
    [shots, selectedShotIds, onSelectionChange],
  );

  const handleSelectAll = useCallback(() => {
    onSelectionChange(shots.map((s) => s.id));
    if (shots.length > 0) {
      lastSelectedIdRef.current = shots[shots.length - 1]?.id ?? null;
    }
  }, [shots, onSelectionChange]);

  const handleClearSelection = useCallback(() => {
    onSelectionChange([]);
    lastSelectedIdRef.current = null;
  }, [onSelectionChange]);

  return {
    handleShotClick,
    handleSelectAll,
    handleClearSelection,
  };
}
