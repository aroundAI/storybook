'use client';

import { type RefObject, useCallback, useEffect } from 'react';
import { useState } from 'react';

import { getFocusableElements } from '../lib/a11y-utils';

/**
 * Options for the focus trap hook
 */
export interface UseFocusTrapOptions {
  /** Whether the focus trap is active */
  isActive: boolean;
  /** Whether to auto-focus the first element when activated */
  autoFocus?: boolean;
  /** Element to return focus to when deactivated */
  returnFocusTo?: HTMLElement | null;
  /** Callback when escape key is pressed */
  onEscape?: () => void;
}

/**
 * Hook for trapping focus within a container element
 *
 * Used for modals, dialogs, and other overlay components to ensure
 * keyboard users can't tab outside the container.
 *
 * @example
 * ```tsx
 * function Modal({ isOpen, onClose }) {
 *   const containerRef = useRef<HTMLDivElement>(null);
 *
 *   useFocusTrap(containerRef, {
 *     isActive: isOpen,
 *     onEscape: onClose,
 *   });
 *
 *   return (
 *     <div ref={containerRef} role="dialog">
 *       <button>First focusable</button>
 *       <button onClick={onClose}>Close</button>
 *     </div>
 *   );
 * }
 * ```
 */
export function useFocusTrap(
  containerRef: RefObject<HTMLElement | null>,
  options: UseFocusTrapOptions,
): void {
  const { isActive, autoFocus = true, returnFocusTo, onEscape } = options;

  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (!containerRef.current) return;

      // Handle Escape key
      if (event.key === 'Escape' && onEscape) {
        event.preventDefault();
        onEscape();
        return;
      }

      // Only handle Tab key for focus trapping
      if (event.key !== 'Tab') return;

      const focusableElements = getFocusableElements(containerRef.current);
      if (focusableElements.length === 0) return;

      const firstElement = focusableElements[0];
      const lastElement = focusableElements[focusableElements.length - 1];

      // Shift+Tab from first element -> go to last
      if (event.shiftKey && document.activeElement === firstElement) {
        event.preventDefault();
        lastElement?.focus();
        return;
      }

      // Tab from last element -> go to first
      if (!event.shiftKey && document.activeElement === lastElement) {
        event.preventDefault();
        firstElement?.focus();
        return;
      }

      // If focus is outside the container, bring it back
      if (
        containerRef.current &&
        !containerRef.current.contains(document.activeElement)
      ) {
        event.preventDefault();
        firstElement?.focus();
      }
    },
    [containerRef, onEscape],
  );

  // Set up focus trap when activated
  useEffect(() => {
    if (!isActive || !containerRef.current) return;

    const container = containerRef.current;
    const previouslyFocused = document.activeElement as HTMLElement | null;

    // Auto-focus first element
    if (autoFocus) {
      const focusableElements = getFocusableElements(container);
      if (focusableElements.length > 0) {
        // Small delay to ensure DOM is ready
        requestAnimationFrame(() => {
          focusableElements[0]?.focus();
        });
      }
    }

    // Add event listener
    container.addEventListener('keydown', handleKeyDown);

    return () => {
      container.removeEventListener('keydown', handleKeyDown);

      // Return focus to previous element or specified element
      const returnTarget = returnFocusTo ?? previouslyFocused;
      if (returnTarget && typeof returnTarget.focus === 'function') {
        returnTarget.focus();
      }
    };
  }, [isActive, containerRef, autoFocus, returnFocusTo, handleKeyDown]);
}

/**
 * Hook for managing roving tabindex navigation within a group
 *
 * Useful for toolbars, menus, and other grouped interactive elements
 * where only one item should be tabbable at a time.
 *
 * @example
 * ```tsx
 * function Toolbar() {
 *   const { currentIndex, handleKeyDown, getTabIndex } = useRovingTabIndex(3);
 *
 *   return (
 *     <div role="toolbar" onKeyDown={handleKeyDown}>
 *       {['Bold', 'Italic', 'Underline'].map((label, i) => (
 *         <button key={label} tabIndex={getTabIndex(i)}>
 *           {label}
 *         </button>
 *       ))}
 *     </div>
 *   );
 * }
 * ```
 */
export interface UseRovingTabIndexReturn {
  currentIndex: number;
  setCurrentIndex: (index: number) => void;
  handleKeyDown: (event: React.KeyboardEvent) => void;
  getTabIndex: (index: number) => 0 | -1;
}

export function useRovingTabIndex(
  itemCount: number,
  options?: {
    /** Initial focused index */
    initialIndex?: number;
    /** Whether navigation wraps around */
    wrap?: boolean;
    /** Orientation for arrow key handling */
    orientation?: 'horizontal' | 'vertical' | 'both';
  },
): UseRovingTabIndexReturn {
  const {
    initialIndex = 0,
    wrap = true,
    orientation = 'horizontal',
  } = options ?? {};

  const [currentIndex, setCurrentIndex] = useState(initialIndex);

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      const isHorizontal =
        orientation === 'horizontal' || orientation === 'both';
      const isVertical = orientation === 'vertical' || orientation === 'both';

      let newIndex = currentIndex;

      switch (event.key) {
        case 'ArrowRight':
          if (isHorizontal) {
            newIndex = wrap
              ? (currentIndex + 1) % itemCount
              : Math.min(currentIndex + 1, itemCount - 1);
          }
          break;
        case 'ArrowLeft':
          if (isHorizontal) {
            newIndex = wrap
              ? (currentIndex - 1 + itemCount) % itemCount
              : Math.max(currentIndex - 1, 0);
          }
          break;
        case 'ArrowDown':
          if (isVertical) {
            newIndex = wrap
              ? (currentIndex + 1) % itemCount
              : Math.min(currentIndex + 1, itemCount - 1);
          }
          break;
        case 'ArrowUp':
          if (isVertical) {
            newIndex = wrap
              ? (currentIndex - 1 + itemCount) % itemCount
              : Math.max(currentIndex - 1, 0);
          }
          break;
        case 'Home':
          newIndex = 0;
          break;
        case 'End':
          newIndex = itemCount - 1;
          break;
        default:
          return;
      }

      if (newIndex !== currentIndex) {
        event.preventDefault();
        setCurrentIndex(newIndex);
      }
    },
    [currentIndex, itemCount, wrap, orientation],
  );

  const getTabIndex = useCallback(
    (index: number): 0 | -1 => (index === currentIndex ? 0 : -1),
    [currentIndex],
  );

  return {
    currentIndex,
    setCurrentIndex,
    handleKeyDown,
    getTabIndex,
  };
}
