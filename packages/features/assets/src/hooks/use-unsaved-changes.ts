/**
 * Unsaved Changes Hook (FILM-205)
 *
 * Hook to warn users before leaving a page with unsaved changes.
 * Used by CharacterEditor to prevent accidental data loss.
 */

'use client';

import { useCallback, useEffect, useRef } from 'react';

/**
 * Unsaved Changes Hook (FILM-205)
 *
 * Hook to warn users before leaving a page with unsaved changes.
 * Used by CharacterEditor to prevent accidental data loss.
 */

/**
 * Unsaved Changes Hook (FILM-205)
 *
 * Hook to warn users before leaving a page with unsaved changes.
 * Used by CharacterEditor to prevent accidental data loss.
 */

/**
 * Unsaved Changes Hook (FILM-205)
 *
 * Hook to warn users before leaving a page with unsaved changes.
 * Used by CharacterEditor to prevent accidental data loss.
 */

/**
 * Unsaved Changes Hook (FILM-205)
 *
 * Hook to warn users before leaving a page with unsaved changes.
 * Used by CharacterEditor to prevent accidental data loss.
 */

/**
 * Unsaved Changes Hook (FILM-205)
 *
 * Hook to warn users before leaving a page with unsaved changes.
 * Used by CharacterEditor to prevent accidental data loss.
 */

/**
 * Unsaved Changes Hook (FILM-205)
 *
 * Hook to warn users before leaving a page with unsaved changes.
 * Used by CharacterEditor to prevent accidental data loss.
 */

/**
 * Unsaved Changes Hook (FILM-205)
 *
 * Hook to warn users before leaving a page with unsaved changes.
 * Used by CharacterEditor to prevent accidental data loss.
 */

/**
 * Unsaved Changes Hook (FILM-205)
 *
 * Hook to warn users before leaving a page with unsaved changes.
 * Used by CharacterEditor to prevent accidental data loss.
 */

/**
 * Unsaved Changes Hook (FILM-205)
 *
 * Hook to warn users before leaving a page with unsaved changes.
 * Used by CharacterEditor to prevent accidental data loss.
 */

interface UseUnsavedChangesOptions {
  /** Whether there are unsaved changes */
  hasChanges: boolean;
  /** Custom warning message (note: modern browsers ignore custom messages) */
  message?: string;
  /** Whether the warning is enabled */
  enabled?: boolean;
}

function isBrowser(): boolean {
  return typeof window !== 'undefined';
}

/**
 * Hook to warn users before leaving a page with unsaved changes
 *
 * @example
 * useUnsavedChanges({
 *   hasChanges: form.formState.isDirty,
 *   message: 'You have unsaved changes. Are you sure you want to leave?',
 *   enabled: !isSubmitting,
 * });
 */
export function useUnsavedChanges(options: UseUnsavedChangesOptions): void {
  const {
    hasChanges,
    message = 'You have unsaved changes. Are you sure you want to leave?',
    enabled = true,
  } = options;

  const hasChangesRef = useRef(hasChanges);

  // Keep ref updated
  useEffect(() => {
    hasChangesRef.current = hasChanges;
  }, [hasChanges]);

  const handleBeforeUnload = useCallback(
    (event: BeforeUnloadEvent) => {
      if (!enabled || !hasChangesRef.current) return;

      event.preventDefault();
      // Modern browsers ignore custom messages, but we set it anyway
      event.returnValue = message;
      return message;
    },
    [enabled, message],
  );

  useEffect(() => {
    if (!isBrowser() || !enabled) return;

    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [enabled, handleBeforeUnload]);
}

/**
 * Utility to check if form has meaningful changes
 * (ignores empty string to null/undefined changes)
 */
export function hasFormChanges<T extends Record<string, unknown>>(
  original: T,
  current: T,
): boolean {
  const keys = new Set([...Object.keys(original), ...Object.keys(current)]);

  for (const key of keys) {
    const origValue = original[key];
    const currValue = current[key];

    // Treat empty string, null, undefined as equivalent
    const origEmpty =
      origValue === '' || origValue === null || origValue === undefined;
    const currEmpty =
      currValue === '' || currValue === null || currValue === undefined;

    if (origEmpty && currEmpty) continue;
    if (origEmpty !== currEmpty) return true;

    // Deep compare for objects/arrays
    if (typeof origValue === 'object' && typeof currValue === 'object') {
      if (JSON.stringify(origValue) !== JSON.stringify(currValue)) return true;
    } else if (origValue !== currValue) {
      return true;
    }
  }

  return false;
}
