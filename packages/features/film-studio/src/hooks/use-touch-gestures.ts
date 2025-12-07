'use client';

import type { RefObject } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Supported gesture types for the Film Studio
 */
export type GestureType =
  | 'swipe-left'
  | 'swipe-right'
  | 'swipe-up'
  | 'swipe-down'
  | 'pinch-in'
  | 'pinch-out'
  | 'long-press'
  | 'tap'
  | 'double-tap'
  | null;

/**
 * Gesture event data with additional context
 */
export interface GestureEvent {
  type: GestureType;
  deltaX: number;
  deltaY: number;
  velocity: number;
  scale?: number;
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  duration: number;
}

/**
 * Configuration options for touch gestures
 */
export interface TouchGestureOptions {
  swipeThreshold?: number;
  longPressDelay?: number;
  doubleTapDelay?: number;
  onGesture?: (event: GestureEvent) => void;
  onSwipeLeft?: (event: GestureEvent) => void;
  onSwipeRight?: (event: GestureEvent) => void;
  onSwipeUp?: (event: GestureEvent) => void;
  onSwipeDown?: (event: GestureEvent) => void;
  onPinchIn?: (event: GestureEvent) => void;
  onPinchOut?: (event: GestureEvent) => void;
  onLongPress?: (event: GestureEvent) => void;
  onDoubleTap?: (event: GestureEvent) => void;
  disabled?: boolean;
}

const DEFAULT_OPTIONS: Required<
  Pick<
    TouchGestureOptions,
    'swipeThreshold' | 'longPressDelay' | 'doubleTapDelay' | 'disabled'
  >
> = {
  swipeThreshold: 50,
  longPressDelay: 500,
  doubleTapDelay: 300,
  disabled: false,
};

/**
 * Hook to detect touch gestures on a target element
 *
 * Supports swipe (all directions), pinch, long press, and double tap gestures.
 *
 * @param ref - Reference to the target element
 * @param options - Configuration options and event handlers
 * @returns Current detected gesture type (or null)
 *
 * @example
 * ```tsx
 * function ShotNavigator({ shots }: Props) {
 *   const containerRef = useRef<HTMLDivElement>(null);
 *   const [currentIndex, setCurrentIndex] = useState(0);
 *
 *   useTouchGestures(containerRef, {
 *     onSwipeLeft: () => setCurrentIndex(i => Math.min(i + 1, shots.length - 1)),
 *     onSwipeRight: () => setCurrentIndex(i => Math.max(i - 1, 0)),
 *   });
 *
 *   return (
 *     <div ref={containerRef}>
 *       <ShotCard shot={shots[currentIndex]} />
 *     </div>
 *   );
 * }
 * ```
 */
export function useTouchGestures(
  ref: RefObject<HTMLElement | null>,
  options: TouchGestureOptions = {},
): GestureType {
  const [gesture, setGesture] = useState<GestureType>(null);

  const config = { ...DEFAULT_OPTIONS, ...options };

  const touchStartRef = useRef<{
    x: number;
    y: number;
    time: number;
    initialDistance: number | null;
  } | null>(null);

  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastTapRef = useRef<number>(0);

  const clearLongPressTimer = useCallback(() => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  }, []);

  const getDistance = useCallback((touches: TouchList): number => {
    if (touches.length < 2) return 0;
    const touch0 = touches[0];
    const touch1 = touches[1];
    if (!touch0 || !touch1) return 0;
    const dx = touch0.clientX - touch1.clientX;
    const dy = touch0.clientY - touch1.clientY;
    return Math.sqrt(dx * dx + dy * dy);
  }, []);

  const createGestureEvent = useCallback(
    (
      type: GestureType,
      endX: number,
      endY: number,
      scale?: number,
    ): GestureEvent => {
      const start = touchStartRef.current;
      const startX = start?.x ?? 0;
      const startY = start?.y ?? 0;
      const startTime = start?.time ?? Date.now();
      const duration = Date.now() - startTime;
      const deltaX = endX - startX;
      const deltaY = endY - startY;
      const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
      const velocity = duration > 0 ? distance / duration : 0;

      return {
        type,
        deltaX,
        deltaY,
        velocity,
        scale,
        startX,
        startY,
        endX,
        endY,
        duration,
      };
    },
    [],
  );

  const handleGesture = useCallback(
    (type: GestureType, event: GestureEvent) => {
      setGesture(type);
      options.onGesture?.(event);

      switch (type) {
        case 'swipe-left':
          options.onSwipeLeft?.(event);
          break;
        case 'swipe-right':
          options.onSwipeRight?.(event);
          break;
        case 'swipe-up':
          options.onSwipeUp?.(event);
          break;
        case 'swipe-down':
          options.onSwipeDown?.(event);
          break;
        case 'pinch-in':
          options.onPinchIn?.(event);
          break;
        case 'pinch-out':
          options.onPinchOut?.(event);
          break;
        case 'long-press':
          options.onLongPress?.(event);
          break;
        case 'double-tap':
          options.onDoubleTap?.(event);
          break;
      }

      setTimeout(() => setGesture(null), 100);
    },
    [options],
  );

  useEffect(() => {
    const element = ref.current;
    if (!element || config.disabled) return;

    const handleTouchStart = (e: TouchEvent) => {
      const touch = e.touches[0];
      if (!touch) return;
      const now = Date.now();
      const touchX = touch.clientX;
      const touchY = touch.clientY;

      touchStartRef.current = {
        x: touchX,
        y: touchY,
        time: now,
        initialDistance: e.touches.length >= 2 ? getDistance(e.touches) : null,
      };

      // Long press detection
      clearLongPressTimer();
      longPressTimerRef.current = setTimeout(() => {
        const event = createGestureEvent('long-press', touchX, touchY);
        handleGesture('long-press', event);
      }, config.longPressDelay);
    };

    const handleTouchMove = (e: TouchEvent) => {
      clearLongPressTimer();

      // Handle pinch gesture
      if (e.touches.length >= 2 && touchStartRef.current?.initialDistance) {
        const touch0 = e.touches[0];
        const touch1 = e.touches[1];
        if (!touch0 || !touch1) return;

        const currentDistance = getDistance(e.touches);
        const scale = currentDistance / touchStartRef.current.initialDistance;

        if (Math.abs(scale - 1) > 0.1) {
          const type = scale > 1 ? 'pinch-out' : 'pinch-in';
          const centerX = (touch0.clientX + touch1.clientX) / 2;
          const centerY = (touch0.clientY + touch1.clientY) / 2;
          const event = createGestureEvent(type, centerX, centerY, scale);
          handleGesture(type, event);
        }
      }
    };

    const handleTouchEnd = (e: TouchEvent) => {
      clearLongPressTimer();

      if (!touchStartRef.current) return;

      const touch = e.changedTouches[0];
      if (!touch) return;
      const endX = touch.clientX;
      const endY = touch.clientY;
      const deltaX = endX - touchStartRef.current.x;
      const deltaY = endY - touchStartRef.current.y;
      const absDeltaX = Math.abs(deltaX);
      const absDeltaY = Math.abs(deltaY);
      const now = Date.now();
      const duration = now - touchStartRef.current.time;

      // Double tap detection
      if (absDeltaX < 10 && absDeltaY < 10 && duration < 200) {
        if (now - lastTapRef.current < config.doubleTapDelay) {
          const event = createGestureEvent('double-tap', endX, endY);
          handleGesture('double-tap', event);
          lastTapRef.current = 0;
        } else {
          lastTapRef.current = now;
        }
      }

      // Swipe detection
      if (
        absDeltaX > config.swipeThreshold ||
        absDeltaY > config.swipeThreshold
      ) {
        let type: GestureType = null;

        if (absDeltaX > absDeltaY) {
          type = deltaX > 0 ? 'swipe-right' : 'swipe-left';
        } else {
          type = deltaY > 0 ? 'swipe-down' : 'swipe-up';
        }

        const event = createGestureEvent(type, endX, endY);
        handleGesture(type, event);
      }

      touchStartRef.current = null;
    };

    const handleTouchCancel = () => {
      clearLongPressTimer();
      touchStartRef.current = null;
    };

    element.addEventListener('touchstart', handleTouchStart, { passive: true });
    element.addEventListener('touchmove', handleTouchMove, { passive: true });
    element.addEventListener('touchend', handleTouchEnd, { passive: true });
    element.addEventListener('touchcancel', handleTouchCancel, {
      passive: true,
    });

    return () => {
      clearLongPressTimer();
      element.removeEventListener('touchstart', handleTouchStart);
      element.removeEventListener('touchmove', handleTouchMove);
      element.removeEventListener('touchend', handleTouchEnd);
      element.removeEventListener('touchcancel', handleTouchCancel);
    };
  }, [
    ref,
    config.disabled,
    config.swipeThreshold,
    config.longPressDelay,
    config.doubleTapDelay,
    clearLongPressTimer,
    getDistance,
    createGestureEvent,
    handleGesture,
  ]);

  return gesture;
}

/**
 * Hook for swipe navigation between items (e.g., shots, episodes)
 *
 * @param currentIndex - Current item index
 * @param maxIndex - Maximum index (items.length - 1)
 * @param onIndexChange - Callback when index changes
 * @returns Object with ref to attach and current gesture
 *
 * @example
 * ```tsx
 * function ShotCarousel({ shots }: Props) {
 *   const [index, setIndex] = useState(0);
 *   const { ref, gesture } = useSwipeNavigation(index, shots.length - 1, setIndex);
 *
 *   return (
 *     <div ref={ref} className="relative">
 *       <ShotCard shot={shots[index]} />
 *       {gesture && <div className="swipe-indicator">{gesture}</div>}
 *     </div>
 *   );
 * }
 * ```
 */
export function useSwipeNavigation(
  currentIndex: number,
  maxIndex: number,
  onIndexChange: (index: number) => void,
): { ref: RefObject<HTMLDivElement | null>; gesture: GestureType } {
  const ref = useRef<HTMLDivElement>(null);

  const gesture = useTouchGestures(ref, {
    onSwipeLeft: () => {
      if (currentIndex < maxIndex) {
        onIndexChange(currentIndex + 1);
      }
    },
    onSwipeRight: () => {
      if (currentIndex > 0) {
        onIndexChange(currentIndex - 1);
      }
    },
  });

  return { ref, gesture };
}

/**
 * Hook for pull-to-refresh functionality
 *
 * @param onRefresh - Async function to call when refreshing
 * @returns Object with ref, isRefreshing state, and pull progress
 *
 * @example
 * ```tsx
 * function EpisodeList() {
 *   const { ref, isRefreshing, progress } = usePullToRefresh(async () => {
 *     await refetchEpisodes();
 *   });
 *
 *   return (
 *     <div ref={ref}>
 *       {isRefreshing && <RefreshIndicator progress={progress} />}
 *       <EpisodeCards />
 *     </div>
 *   );
 * }
 * ```
 */
export function usePullToRefresh(onRefresh: () => Promise<void>): {
  ref: RefObject<HTMLDivElement | null>;
  isRefreshing: boolean;
  progress: number;
} {
  const ref = useRef<HTMLDivElement>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [progress, setProgress] = useState(0);
  const pullStartRef = useRef<number | null>(null);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    const handleTouchStart = (e: TouchEvent) => {
      const touch = e.touches[0];
      if (element.scrollTop === 0 && touch) {
        pullStartRef.current = touch.clientY;
      }
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (pullStartRef.current === null || isRefreshing) return;

      const touch = e.touches[0];
      if (!touch) return;
      const delta = touch.clientY - pullStartRef.current;
      if (delta > 0) {
        const pullProgress = Math.min(delta / 100, 1);
        setProgress(pullProgress);
      }
    };

    const handleTouchEnd = async () => {
      if (progress >= 1 && !isRefreshing) {
        setIsRefreshing(true);
        try {
          await onRefresh();
        } finally {
          setIsRefreshing(false);
        }
      }
      setProgress(0);
      pullStartRef.current = null;
    };

    element.addEventListener('touchstart', handleTouchStart, { passive: true });
    element.addEventListener('touchmove', handleTouchMove, { passive: true });
    element.addEventListener('touchend', handleTouchEnd, { passive: true });

    return () => {
      element.removeEventListener('touchstart', handleTouchStart);
      element.removeEventListener('touchmove', handleTouchMove);
      element.removeEventListener('touchend', handleTouchEnd);
    };
  }, [isRefreshing, onRefresh, progress]);

  return { ref, isRefreshing, progress };
}
