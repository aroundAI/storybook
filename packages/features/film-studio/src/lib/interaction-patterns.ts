/**
 * Interaction patterns for the Film Studio feature
 *
 * Provides standardized patterns for drag-and-drop, keyboard navigation,
 * loading states, empty states, and error states.
 */

import type { AssetType } from './design-tokens';

// ============================================================================
// 1. Drag and Drop Patterns
// ============================================================================

/**
 * Generic drag state for draggable grid items
 */
export interface DragState {
  /** Whether a drag operation is currently in progress */
  isDragging: boolean;
  /** ID of the item being dragged */
  draggedId: string | null;
  /** ID of the current drop target */
  dropTargetId: string | null;
}

/**
 * Initial drag state for use with useState
 */
export const initialDragState: DragState = {
  isDragging: false,
  draggedId: null,
  dropTargetId: null,
};

/**
 * Timeline clip drag state for horizontal manipulation
 */
export interface ClipDragState {
  /** ID of the clip being manipulated */
  clipId: string;
  /** Original start position in frames */
  originalStart: number;
  /** Current start position during drag */
  currentStart: number;
  /** Resize mode if resizing, null if moving */
  isResizing: 'left' | 'right' | null;
}

/**
 * Visual feedback styles during drag operations
 */
export const dragStyles = {
  /** Style applied to the item being dragged */
  dragging: 'opacity-50 scale-105 shadow-lg z-50',
  /** Style applied to valid drop targets */
  dropTarget: 'ring-2 ring-primary ring-offset-2',
  /** Style applied to invalid drop targets */
  invalid: 'ring-2 ring-destructive',
} as const;

/**
 * Snap configuration for timeline operations
 */
export const SNAP_THRESHOLD_PX = 10;
export const SNAP_POINTS = ['clipEdges', 'playhead', 'gridLines'] as const;
export type SnapPoint = (typeof SNAP_POINTS)[number];

// ============================================================================
// 2. Drop Zone Patterns
// ============================================================================

/**
 * Configuration for asset drop zones
 */
export interface AssetDropZone {
  /** Asset types this zone accepts */
  accepts: AssetType[];
  /** Callback when an asset is dropped */
  onDrop: (assetId: string) => void;
}

/**
 * Drop zone visual states
 */
export const dropZoneStyles = {
  /** Default state when no drag is active */
  idle: 'border-dashed border-2 border-muted',
  /** State when dragging a compatible item over */
  active: 'border-primary bg-primary/5',
  /** State when dragging an incompatible item over */
  invalid: 'border-destructive bg-destructive/5',
  /** State when zone already has content */
  hasContent: 'border-solid border-border',
} as const;

export type DropZoneState = keyof typeof dropZoneStyles;

// ============================================================================
// 3. Keyboard Navigation
// ============================================================================

/**
 * Shot grid keyboard shortcuts
 */
export const shotGridKeyboardShortcuts = {
  ArrowLeft: 'Navigate to previous shot',
  ArrowRight: 'Navigate to next shot',
  ArrowUp: 'Navigate to shot above',
  ArrowDown: 'Navigate to shot below',
  Space: 'Play/pause preview',
  Enter: 'Open shot editor',
  Delete: 'Remove shot',
  Backspace: 'Remove shot',
  Escape: 'Deselect all',
  'Cmd/Ctrl+A': 'Select all',
  'Shift+Click': 'Multi-select range',
} as const;

/**
 * Timeline keyboard shortcuts
 */
export const timelineKeyboardShortcuts = {
  Space: 'Play/pause',
  ArrowLeft: 'Scrub playhead (1 frame)',
  ArrowRight: 'Scrub playhead (1 frame)',
  'Shift+ArrowLeft': 'Scrub playhead (1 second)',
  'Shift+ArrowRight': 'Scrub playhead (1 second)',
  '[': 'Set in-point',
  ']': 'Set out-point',
  Home: 'Go to start',
  End: 'Go to end',
  '+': 'Zoom in',
  '-': 'Zoom out',
  'Cmd/Ctrl+Z': 'Undo',
  'Cmd/Ctrl+Shift+Z': 'Redo',
} as const;

/**
 * Direction for grid navigation
 */
export type NavigationDirection = 'next' | 'prev' | 'up' | 'down';

/**
 * Calculate the next index in a grid based on navigation direction
 */
export function getNextGridIndex(
  currentIndex: number,
  direction: NavigationDirection,
  totalItems: number,
  columnsPerRow: number,
): number | null {
  switch (direction) {
    case 'next':
      return currentIndex < totalItems - 1 ? currentIndex + 1 : null;
    case 'prev':
      return currentIndex > 0 ? currentIndex - 1 : null;
    case 'down': {
      const nextIndex = currentIndex + columnsPerRow;
      return nextIndex < totalItems ? nextIndex : null;
    }
    case 'up': {
      const prevIndex = currentIndex - columnsPerRow;
      return prevIndex >= 0 ? prevIndex : null;
    }
  }
}

// ============================================================================
// 4. Empty States
// ============================================================================

/**
 * Props for empty state component
 * Note: `icon` is a Lucide icon name string (e.g., 'Film', 'Users')
 * The consuming component should import the actual icon from lucide-react
 */
export interface EmptyStateProps {
  /** Lucide icon name to display */
  icon: string;
  /** Main title */
  title: string;
  /** Description text */
  description: string;
  /** Optional action button */
  action?: {
    label: string;
    onClick: () => void;
  };
}

/**
 * Pre-defined empty state configurations
 */
export const emptyStates = {
  episodes: {
    title: 'No episodes yet',
    description: 'Create your first episode to start generating content',
    actionLabel: 'Create Episode',
  },
  characters: {
    title: 'No characters defined',
    description: 'Add characters to maintain visual consistency across shots',
    actionLabel: 'Add Character',
  },
  shots: {
    title: 'No shots generated',
    description: 'Generate shots from your storyboard to create video content',
    actionLabel: 'Generate Shots',
  },
  dialogue: {
    title: 'No dialogue lines',
    description: 'Add dialogue to bring your story to life with voice acting',
    actionLabel: 'Add Dialogue',
  },
  assets: {
    title: 'No assets uploaded',
    description: 'Upload images, audio, or reference materials for your project',
    actionLabel: 'Upload Asset',
  },
} as const;

// ============================================================================
// 5. Loading Skeleton Patterns
// ============================================================================

/**
 * Standard skeleton dimensions for different content types
 */
export const skeletonPatterns = {
  /** Video/shot aspect ratio */
  video: 'aspect-video',
  /** Square thumbnail */
  thumbnail: 'aspect-square',
  /** Title text */
  title: 'h-4 w-3/4',
  /** Subtitle/metadata text */
  subtitle: 'h-3 w-1/2',
  /** Badge/tag */
  badge: 'h-5 w-16 rounded-full',
  /** Avatar */
  avatar: 'h-10 w-10 rounded-full',
  /** Button */
  button: 'h-9 w-24 rounded-md',
} as const;

/**
 * Grid configuration for shot grid skeleton
 */
export const shotGridSkeletonConfig = {
  /** Number of skeleton items to show */
  defaultCount: 12,
  /** Responsive grid classes */
  gridClasses: 'grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4',
} as const;

// ============================================================================
// 6. Error States
// ============================================================================

/**
 * Error state configuration for generation failures
 */
export interface GenerationErrorState {
  /** Error message to display */
  message: string;
  /** Whether the operation can be retried */
  retryable: boolean;
  /** Optional error code for debugging */
  code?: string;
}

/**
 * Pre-defined error messages
 */
export const errorMessages = {
  generationFailed: {
    title: 'Generation Failed',
    defaultMessage: 'Unable to generate content. Please try again.',
    retryable: true,
  },
  providerUnavailable: {
    title: 'Provider Unavailable',
    message:
      'The generation service is experiencing issues. Your job has been queued and will retry automatically when service is restored.',
    retryable: false,
  },
  creditLimitReached: {
    title: 'Credit Limit Reached',
    message: "You've used all your generation credits this month.",
    retryable: false,
    actionLabel: 'Upgrade Plan',
    actionHref: '/settings/billing',
  },
  networkError: {
    title: 'Connection Error',
    message:
      'Unable to connect to the server. Please check your internet connection.',
    retryable: true,
  },
  contentModeration: {
    title: 'Content Policy Violation',
    message:
      'The content was flagged by our safety systems. Please modify your prompt and try again.',
    retryable: true,
  },
} as const;

// ============================================================================
// 7. Real-time Update Patterns
// ============================================================================

/**
 * Configuration for real-time subscription channels
 */
export interface RealtimeSubscriptionConfig {
  /** Supabase channel name pattern */
  channelPattern: string;
  /** Table to subscribe to */
  table: string;
  /** Filter column */
  filterColumn: string;
}

/**
 * Standard real-time channels for film studio
 */
export const realtimeChannels = {
  shots: {
    channelPattern: 'shots:{episodeId}',
    table: 'shots',
    filterColumn: 'episode_id',
  },
  jobs: {
    channelPattern: 'jobs:{accountId}',
    table: 'generation_jobs',
    filterColumn: 'account_id',
  },
  episodes: {
    channelPattern: 'episodes:{projectId}',
    table: 'episodes',
    filterColumn: 'project_id',
  },
} as const;

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Check if an asset type is accepted by a drop zone
 */
export function isAssetAccepted(
  dropZone: AssetDropZone,
  assetType: AssetType,
): boolean {
  return dropZone.accepts.includes(assetType);
}

/**
 * Get the appropriate drop zone style based on drag state
 */
export function getDropZoneStyle(
  isDragging: boolean,
  isOver: boolean,
  isAccepted: boolean,
  hasContent: boolean,
): string {
  if (hasContent && !isDragging) {
    return dropZoneStyles.hasContent;
  }
  if (!isDragging) {
    return dropZoneStyles.idle;
  }
  if (isOver) {
    return isAccepted ? dropZoneStyles.active : dropZoneStyles.invalid;
  }
  return dropZoneStyles.idle;
}

/**
 * Calculate snap position for timeline operations
 */
export function snapToGrid(
  position: number,
  gridSize: number,
  threshold: number = SNAP_THRESHOLD_PX,
): number {
  const nearestGridLine = Math.round(position / gridSize) * gridSize;
  const distance = Math.abs(position - nearestGridLine);
  return distance <= threshold ? nearestGridLine : position;
}

/**
 * Check if a keyboard shortcut uses the meta/ctrl key
 */
export function isMetaKeyShortcut(key: string): boolean {
  return key.startsWith('Cmd/Ctrl+') || key.startsWith('Meta+');
}

/**
 * Check if position is within snap threshold of target
 */
export function isWithinSnapThreshold(
  position: number,
  target: number,
  threshold: number = SNAP_THRESHOLD_PX,
): boolean {
  return Math.abs(position - target) <= threshold;
}
