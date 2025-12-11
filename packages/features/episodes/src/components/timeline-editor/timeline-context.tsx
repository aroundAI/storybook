'use client';

/**
 * Timeline context for sharing state across timeline editor components
 */
import {
  type Dispatch,
  type RefObject,
  createContext,
  useContext,
} from 'react';

import type { TimelineAction, TimelineState } from './types';

// ============================================================================
// Context Type
// ============================================================================

export interface TimelineContextValue {
  /** Current timeline state */
  state: TimelineState;
  /** Dispatch function for state updates */
  dispatch: Dispatch<TimelineAction>;
  /** Pixels per frame based on current zoom */
  pixelsPerFrame: number;
  /** Pixels per second (zoom level) */
  pixelsPerSecond: number;
  /** Reference to the timeline container */
  containerRef: RefObject<HTMLDivElement | null>;
}

// ============================================================================
// Context
// ============================================================================

export const TimelineContext = createContext<TimelineContextValue | null>(null);

// ============================================================================
// Hook
// ============================================================================

/**
 * Hook to access timeline context
 * @throws Error if used outside TimelineProvider
 */
export function useTimelineContext(): TimelineContextValue {
  const context = useContext(TimelineContext);

  if (!context) {
    throw new Error(
      'useTimelineContext must be used within a TimelineEditor component',
    );
  }

  return context;
}
