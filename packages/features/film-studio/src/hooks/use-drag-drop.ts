'use client';

import { useCallback, useState } from 'react';

import type { AssetType } from '../lib/design-tokens';
import {
  type ClipDragState,
  type DragState,
  dropZoneStyles,
  getDropZoneStyle,
  initialDragState,
  isAssetAccepted,
  SNAP_THRESHOLD_PX,
  snapToGrid,
} from '../lib/interaction-patterns';

// ============================================================================
// Generic Drag and Drop Hook
// ============================================================================

export interface UseDragDropOptions<T> {
  /** Items that can be dragged */
  items: T[];
  /** Function to get unique ID from item */
  getId: (item: T) => string;
  /** Callback when drag starts */
  onDragStart?: (id: string) => void;
  /** Callback when drag ends (with optional target) */
  onDragEnd?: (sourceId: string, targetId: string | null) => void;
  /** Callback when item is dropped on valid target */
  onDrop?: (sourceId: string, targetId: string) => void;
  /** Function to validate if drop is allowed */
  canDrop?: (sourceId: string, targetId: string) => boolean;
}

export interface UseDragDropResult {
  /** Current drag state */
  dragState: DragState;
  /** Start dragging an item */
  startDrag: (id: string) => void;
  /** Update current drop target */
  setDropTarget: (id: string | null) => void;
  /** End drag operation */
  endDrag: () => void;
  /** Drop on current target */
  drop: () => void;
  /** Get drag props for an item */
  getDragProps: (id: string) => {
    draggable: boolean;
    onDragStart: () => void;
    onDragEnd: () => void;
    'data-dragging': boolean;
  };
  /** Get drop props for a target */
  getDropProps: (id: string) => {
    onDragOver: (e: React.DragEvent) => void;
    onDragLeave: () => void;
    onDrop: (e: React.DragEvent) => void;
    'data-drop-target': boolean;
  };
}

/**
 * Generic hook for drag and drop state management
 */
export function useDragDrop<T>({
  onDragStart,
  onDragEnd,
  onDrop,
  canDrop,
}: UseDragDropOptions<T>): UseDragDropResult {
  const [dragState, setDragState] = useState<DragState>(initialDragState);

  const startDrag = useCallback(
    (id: string) => {
      setDragState({
        isDragging: true,
        draggedId: id,
        dropTargetId: null,
      });
      onDragStart?.(id);
    },
    [onDragStart],
  );

  const setDropTarget = useCallback(
    (id: string | null) => {
      if (!dragState.isDragging) return;

      // Validate drop if canDrop is provided
      if (
        id &&
        dragState.draggedId &&
        canDrop &&
        !canDrop(dragState.draggedId, id)
      ) {
        return;
      }

      setDragState((prev) => ({
        ...prev,
        dropTargetId: id,
      }));
    },
    [dragState.isDragging, dragState.draggedId, canDrop],
  );

  const endDrag = useCallback(() => {
    if (dragState.draggedId) {
      onDragEnd?.(dragState.draggedId, dragState.dropTargetId);
    }
    setDragState(initialDragState);
  }, [dragState.draggedId, dragState.dropTargetId, onDragEnd]);

  const drop = useCallback(() => {
    if (dragState.draggedId && dragState.dropTargetId) {
      onDrop?.(dragState.draggedId, dragState.dropTargetId);
    }
    setDragState(initialDragState);
  }, [dragState.draggedId, dragState.dropTargetId, onDrop]);

  const getDragProps = useCallback(
    (id: string) => ({
      draggable: true,
      onDragStart: () => startDrag(id),
      onDragEnd: endDrag,
      'data-dragging': dragState.draggedId === id,
    }),
    [startDrag, endDrag, dragState.draggedId],
  );

  const getDropProps = useCallback(
    (id: string) => ({
      onDragOver: (e: React.DragEvent) => {
        e.preventDefault();
        setDropTarget(id);
      },
      onDragLeave: () => {
        if (dragState.dropTargetId === id) {
          setDropTarget(null);
        }
      },
      onDrop: (e: React.DragEvent) => {
        e.preventDefault();
        drop();
      },
      'data-drop-target': dragState.dropTargetId === id,
    }),
    [setDropTarget, drop, dragState.dropTargetId],
  );

  return {
    dragState,
    startDrag,
    setDropTarget,
    endDrag,
    drop,
    getDragProps,
    getDropProps,
  };
}

// ============================================================================
// Timeline Clip Drag Hook
// ============================================================================

export interface UseClipDragOptions {
  /** Frame rate for snap calculations */
  fps: number;
  /** Pixels per frame at current zoom */
  pixelsPerFrame: number;
  /** Grid size in frames for snapping */
  gridSizeFrames?: number;
  /** Callback when clip position changes */
  onPositionChange: (clipId: string, newStart: number) => void;
  /** Callback when clip is resized */
  onResize?: (
    clipId: string,
    newStart: number,
    newDuration: number,
    edge: 'left' | 'right',
  ) => void;
}

export interface UseClipDragResult {
  /** Current clip drag state (or null if not dragging) */
  clipDragState: ClipDragState | null;
  /** Start dragging a clip */
  startClipDrag: (clipId: string, startFrame: number) => void;
  /** Start resizing a clip */
  startClipResize: (
    clipId: string,
    startFrame: number,
    edge: 'left' | 'right',
  ) => void;
  /** Update clip position during drag */
  updateClipPosition: (deltaX: number) => void;
  /** End clip drag/resize */
  endClipDrag: () => void;
  /** Check if a specific clip is being dragged */
  isClipDragging: (clipId: string) => boolean;
}

/**
 * Hook for timeline clip manipulation with snapping
 */
export function useClipDrag({
  pixelsPerFrame,
  gridSizeFrames = 1,
  onPositionChange,
  onResize,
}: UseClipDragOptions): UseClipDragResult {
  const [clipDragState, setClipDragState] = useState<ClipDragState | null>(
    null,
  );

  const startClipDrag = useCallback((clipId: string, startFrame: number) => {
    setClipDragState({
      clipId,
      originalStart: startFrame,
      currentStart: startFrame,
      isResizing: null,
    });
  }, []);

  const startClipResize = useCallback(
    (clipId: string, startFrame: number, edge: 'left' | 'right') => {
      setClipDragState({
        clipId,
        originalStart: startFrame,
        currentStart: startFrame,
        isResizing: edge,
      });
    },
    [],
  );

  const updateClipPosition = useCallback(
    (deltaX: number) => {
      if (!clipDragState) return;

      const deltaFrames = Math.round(deltaX / pixelsPerFrame);
      const newPosition = clipDragState.originalStart + deltaFrames;

      // Apply snapping
      const snappedPosition = snapToGrid(
        newPosition,
        gridSizeFrames,
        SNAP_THRESHOLD_PX / pixelsPerFrame,
      );

      setClipDragState((prev) =>
        prev
          ? {
              ...prev,
              currentStart: Math.max(0, snappedPosition),
            }
          : null,
      );

      if (clipDragState.isResizing) {
        // Handle resize - this would need duration info in real implementation
        onResize?.(
          clipDragState.clipId,
          snappedPosition,
          0, // Duration would be calculated based on resize direction
          clipDragState.isResizing,
        );
      } else {
        onPositionChange(clipDragState.clipId, Math.max(0, snappedPosition));
      }
    },
    [clipDragState, pixelsPerFrame, gridSizeFrames, onPositionChange, onResize],
  );

  const endClipDrag = useCallback(() => {
    setClipDragState(null);
  }, []);

  const isClipDragging = useCallback(
    (clipId: string) => {
      return clipDragState?.clipId === clipId;
    },
    [clipDragState],
  );

  return {
    clipDragState,
    startClipDrag,
    startClipResize,
    updateClipPosition,
    endClipDrag,
    isClipDragging,
  };
}

// ============================================================================
// Drop Zone Hook
// ============================================================================

export interface UseDropZoneOptions {
  /** Asset types accepted by this drop zone */
  accepts: AssetType[];
  /** Callback when an asset is dropped */
  onDrop: (assetId: string, assetType: AssetType) => void;
  /** Whether the zone already has content */
  hasContent?: boolean;
  /** Whether the drop zone is disabled */
  disabled?: boolean;
}

export interface UseDropZoneResult {
  /** Current drop zone visual style class */
  dropZoneClassName: string;
  /** Whether an item is being dragged over */
  isOver: boolean;
  /** Whether the dragged item is accepted */
  isAccepted: boolean;
  /** Props to spread on the drop zone element */
  dropZoneProps: {
    onDragOver: (e: React.DragEvent) => void;
    onDragEnter: (e: React.DragEvent) => void;
    onDragLeave: (e: React.DragEvent) => void;
    onDrop: (e: React.DragEvent) => void;
    'aria-dropeffect': 'copy' | 'move' | 'none';
  };
}

/**
 * Hook for asset drop zone state management
 */
export function useDropZone({
  accepts,
  onDrop,
  hasContent = false,
  disabled = false,
}: UseDropZoneOptions): UseDropZoneResult {
  const [isOver, setIsOver] = useState(false);
  const [draggedType, setDraggedType] = useState<AssetType | null>(null);

  const isAccepted =
    draggedType !== null &&
    isAssetAccepted({ accepts, onDrop: () => {} }, draggedType);

  const dropZoneClassName = disabled
    ? dropZoneStyles.idle
    : getDropZoneStyle(draggedType !== null, isOver, isAccepted, hasContent);

  const handleDragOver = useCallback(
    (e: React.DragEvent) => {
      if (disabled) return;
      e.preventDefault();

      // Try to get asset type from drag data
      const assetType = e.dataTransfer.getData(
        'application/x-asset-type',
      ) as AssetType;
      if (assetType && assetType !== draggedType) {
        setDraggedType(assetType);
      }
    },
    [disabled, draggedType],
  );

  const handleDragEnter = useCallback(
    (e: React.DragEvent) => {
      if (disabled) return;
      e.preventDefault();
      setIsOver(true);
    },
    [disabled],
  );

  const handleDragLeave = useCallback(
    (e: React.DragEvent) => {
      if (disabled) return;
      // Only set isOver to false if we're actually leaving the drop zone
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      const { clientX, clientY } = e;
      if (
        clientX < rect.left ||
        clientX > rect.right ||
        clientY < rect.top ||
        clientY > rect.bottom
      ) {
        setIsOver(false);
        setDraggedType(null);
      }
    },
    [disabled],
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      if (disabled) return;
      e.preventDefault();
      setIsOver(false);
      setDraggedType(null);

      const assetId = e.dataTransfer.getData('application/x-asset-id');
      const assetType = e.dataTransfer.getData(
        'application/x-asset-type',
      ) as AssetType;

      if (
        assetId &&
        assetType &&
        isAssetAccepted({ accepts, onDrop: () => {} }, assetType)
      ) {
        onDrop(assetId, assetType);
      }
    },
    [disabled, accepts, onDrop],
  );

  return {
    dropZoneClassName,
    isOver,
    isAccepted,
    dropZoneProps: {
      onDragOver: handleDragOver,
      onDragEnter: handleDragEnter,
      onDragLeave: handleDragLeave,
      onDrop: handleDrop,
      'aria-dropeffect': disabled ? 'none' : isAccepted ? 'copy' : 'none',
    },
  };
}
