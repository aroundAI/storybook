'use client';

import { useCallback, useEffect } from 'react';

import {
  getNextGridIndex,
  type NavigationDirection,
} from '../lib/interaction-patterns';

// ============================================================================
// Shot Grid Keyboard Navigation
// ============================================================================

export interface ShotGridKeyboardOptions {
  /** Array of shot IDs in display order */
  shotIds: string[];
  /** Currently selected shot IDs */
  selectedIds: Set<string>;
  /** Number of columns in the grid */
  columns: number;
  /** Callback when selection changes */
  onSelectionChange: (ids: Set<string>) => void;
  /** Callback when preview is toggled */
  onPreviewToggle?: () => void;
  /** Callback when editor is opened */
  onOpenEditor?: () => void;
  /** Callback when shots are deleted */
  onDelete?: (ids: string[]) => void;
  /** Whether the grid is focused/active */
  enabled?: boolean;
}

/**
 * Hook for keyboard navigation in shot grid
 *
 * Supports:
 * - Arrow keys for navigation
 * - Space for preview toggle
 * - Enter to open editor
 * - Delete/Backspace to remove
 * - Cmd/Ctrl+A to select all
 * - Escape to deselect
 * - Shift+Click for range select (handled separately)
 */
export function useShotGridKeyboard({
  shotIds,
  selectedIds,
  columns,
  onSelectionChange,
  onPreviewToggle,
  onOpenEditor,
  onDelete,
  enabled = true,
}: ShotGridKeyboardOptions) {
  const moveSelection = useCallback(
    (direction: NavigationDirection) => {
      if (selectedIds.size === 0 && shotIds.length > 0) {
        // No selection, select first item
        onSelectionChange(new Set([shotIds[0]!]));
        return;
      }

      // Get the last selected item as anchor
      const selectedArray = Array.from(selectedIds);
      const lastSelected = selectedArray[selectedArray.length - 1];
      const currentIndex = shotIds.indexOf(lastSelected!);

      if (currentIndex === -1) return;

      const nextIndex = getNextGridIndex(
        currentIndex,
        direction,
        shotIds.length,
        columns,
      );

      if (nextIndex !== null) {
        onSelectionChange(new Set([shotIds[nextIndex]!]));
      }
    },
    [shotIds, selectedIds, columns, onSelectionChange],
  );

  const selectAll = useCallback(() => {
    onSelectionChange(new Set(shotIds));
  }, [shotIds, onSelectionChange]);

  const deselectAll = useCallback(() => {
    onSelectionChange(new Set());
  }, [onSelectionChange]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (!enabled) return;

      // Check for meta/ctrl key combinations
      const isMeta = e.metaKey || e.ctrlKey;

      switch (e.key) {
        case 'ArrowRight':
          e.preventDefault();
          moveSelection('next');
          break;
        case 'ArrowLeft':
          e.preventDefault();
          moveSelection('prev');
          break;
        case 'ArrowDown':
          e.preventDefault();
          moveSelection('down');
          break;
        case 'ArrowUp':
          e.preventDefault();
          moveSelection('up');
          break;
        case ' ':
          e.preventDefault();
          onPreviewToggle?.();
          break;
        case 'Enter':
          e.preventDefault();
          onOpenEditor?.();
          break;
        case 'Delete':
        case 'Backspace':
          if (selectedIds.size > 0) {
            e.preventDefault();
            onDelete?.(Array.from(selectedIds));
          }
          break;
        case 'Escape':
          e.preventDefault();
          deselectAll();
          break;
        case 'a':
          if (isMeta) {
            e.preventDefault();
            selectAll();
          }
          break;
      }
    },
    [
      enabled,
      moveSelection,
      onPreviewToggle,
      onOpenEditor,
      onDelete,
      selectAll,
      deselectAll,
      selectedIds,
    ],
  );

  // useEffect is required here to attach global keyboard event listeners to the document.
  // This enables keyboard navigation when the grid is focused, regardless of which
  // specific element has focus. The cleanup function ensures proper listener removal.
  useEffect(() => {
    if (!enabled) return;

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [enabled, handleKeyDown]);

  return {
    moveSelection,
    selectAll,
    deselectAll,
  };
}

// ============================================================================
// Timeline Keyboard Navigation
// ============================================================================

export interface TimelineKeyboardOptions {
  /** Current playhead position in frames */
  playhead: number;
  /** Frames per second */
  fps: number;
  /** Total duration in frames */
  totalFrames: number;
  /** Current zoom level (1 = 100%) */
  zoom: number;
  /** Whether playback is active */
  isPlaying: boolean;
  /** In-point position (or null if not set) */
  inPoint: number | null;
  /** Out-point position (or null if not set) */
  outPoint: number | null;
  /** Callback to update playhead */
  onPlayheadChange: (frame: number) => void;
  /** Callback to toggle play/pause */
  onPlayToggle: () => void;
  /** Callback to update zoom */
  onZoomChange: (zoom: number) => void;
  /** Callback to set in-point */
  onInPointSet?: (frame: number) => void;
  /** Callback to set out-point */
  onOutPointSet?: (frame: number) => void;
  /** Callback for undo */
  onUndo?: () => void;
  /** Callback for redo */
  onRedo?: () => void;
  /** Whether the timeline is focused/active */
  enabled?: boolean;
}

/**
 * Hook for keyboard navigation in timeline editor
 *
 * Supports:
 * - Space for play/pause
 * - Arrow keys for frame-by-frame scrubbing
 * - Shift+Arrow for 1-second scrubbing
 * - [ and ] for in/out points
 * - Home/End to go to start/end
 * - +/- for zoom
 * - Cmd/Ctrl+Z for undo
 * - Cmd/Ctrl+Shift+Z for redo
 */
export function useTimelineKeyboard({
  playhead,
  fps,
  totalFrames,
  zoom,
  onPlayheadChange,
  onPlayToggle,
  onZoomChange,
  onInPointSet,
  onOutPointSet,
  onUndo,
  onRedo,
  enabled = true,
}: TimelineKeyboardOptions) {
  const scrubPlayhead = useCallback(
    (frames: number) => {
      const newPosition = Math.max(0, Math.min(totalFrames, playhead + frames));
      onPlayheadChange(newPosition);
    },
    [playhead, totalFrames, onPlayheadChange],
  );

  const goToStart = useCallback(() => {
    onPlayheadChange(0);
  }, [onPlayheadChange]);

  const goToEnd = useCallback(() => {
    onPlayheadChange(totalFrames);
  }, [totalFrames, onPlayheadChange]);

  const zoomIn = useCallback(() => {
    const newZoom = Math.min(4, zoom * 1.25);
    onZoomChange(newZoom);
  }, [zoom, onZoomChange]);

  const zoomOut = useCallback(() => {
    const newZoom = Math.max(0.25, zoom / 1.25);
    onZoomChange(newZoom);
  }, [zoom, onZoomChange]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (!enabled) return;

      const isMeta = e.metaKey || e.ctrlKey;
      const isShift = e.shiftKey;

      switch (e.key) {
        case ' ':
          e.preventDefault();
          onPlayToggle();
          break;
        case 'ArrowLeft':
          e.preventDefault();
          scrubPlayhead(isShift ? -fps : -1);
          break;
        case 'ArrowRight':
          e.preventDefault();
          scrubPlayhead(isShift ? fps : 1);
          break;
        case '[':
          e.preventDefault();
          onInPointSet?.(playhead);
          break;
        case ']':
          e.preventDefault();
          onOutPointSet?.(playhead);
          break;
        case 'Home':
          e.preventDefault();
          goToStart();
          break;
        case 'End':
          e.preventDefault();
          goToEnd();
          break;
        case '+':
        case '=':
          e.preventDefault();
          zoomIn();
          break;
        case '-':
          e.preventDefault();
          zoomOut();
          break;
        case 'z':
          if (isMeta) {
            e.preventDefault();
            if (isShift) {
              onRedo?.();
            } else {
              onUndo?.();
            }
          }
          break;
      }
    },
    [
      enabled,
      fps,
      playhead,
      scrubPlayhead,
      onPlayToggle,
      onInPointSet,
      onOutPointSet,
      goToStart,
      goToEnd,
      zoomIn,
      zoomOut,
      onUndo,
      onRedo,
    ],
  );

  // useEffect is required here to attach global keyboard event listeners to the document.
  // This enables timeline shortcuts (playback, scrubbing, zoom) when the timeline is focused,
  // regardless of which specific element has focus. The cleanup function ensures proper listener removal.
  useEffect(() => {
    if (!enabled) return;

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [enabled, handleKeyDown]);

  return {
    scrubPlayhead,
    goToStart,
    goToEnd,
    zoomIn,
    zoomOut,
  };
}
