/**
 * Auto-Save Hook (FILM-205)
 *
 * Hook for auto-saving form data to localStorage periodically.
 * Used by CharacterEditor to save drafts.
 */

'use client';

import { useCallback, useEffect, useRef } from 'react';

/**
 * Auto-Save Hook (FILM-205)
 *
 * Hook for auto-saving form data to localStorage periodically.
 * Used by CharacterEditor to save drafts.
 */

/**
 * Auto-Save Hook (FILM-205)
 *
 * Hook for auto-saving form data to localStorage periodically.
 * Used by CharacterEditor to save drafts.
 */

/**
 * Auto-Save Hook (FILM-205)
 *
 * Hook for auto-saving form data to localStorage periodically.
 * Used by CharacterEditor to save drafts.
 */

/**
 * Auto-Save Hook (FILM-205)
 *
 * Hook for auto-saving form data to localStorage periodically.
 * Used by CharacterEditor to save drafts.
 */

interface UseAutoSaveOptions<T> {
  /** Unique key for localStorage */
  storageKey: string;
  /** Data to save */
  data: T;
  /** Auto-save interval in milliseconds (default: 30000 = 30s) */
  interval?: number;
  /** Whether auto-save is enabled */
  enabled?: boolean;
}

interface AutoSaveResult<T> {
  /** Restore saved data from localStorage */
  restore: () => T | null;
  /** Clear saved data from localStorage */
  clear: () => void;
  /** Check if there is saved data */
  hasSavedData: () => boolean;
  /** Manually trigger a save */
  save: () => void;
  /** Get the timestamp of last save */
  getLastSaveTime: () => number | null;
}

function isBrowser(): boolean {
  return typeof window !== 'undefined';
}

/**
 * Hook for auto-saving form data to localStorage
 *
 * @example
 * const { restore, clear, hasSavedData } = useAutoSave({
 *   storageKey: `character-draft-${characterId}`,
 *   data: form.getValues(),
 *   interval: 30000, // 30 seconds
 *   enabled: !isSubmitting,
 * });
 */
export function useAutoSave<T>(
  options: UseAutoSaveOptions<T>,
): AutoSaveResult<T> {
  const { storageKey, data, interval = 30000, enabled = true } = options;
  const lastSaveRef = useRef<number | null>(null);
  const dataRef = useRef<T>(data);
  const enabledRef = useRef(enabled);

  // Keep refs updated
  useEffect(() => {
    dataRef.current = data;
  }, [data]);

  useEffect(() => {
    enabledRef.current = enabled;
  }, [enabled]);

  const getFullKey = useCallback(() => {
    return `auto-save:${storageKey}`;
  }, [storageKey]);

  const getMetaKey = useCallback(() => {
    return `auto-save:${storageKey}:meta`;
  }, [storageKey]);

  const save = useCallback(() => {
    if (!isBrowser() || !enabled) return;

    try {
      const timestamp = Date.now();
      localStorage.setItem(getFullKey(), JSON.stringify(dataRef.current));
      localStorage.setItem(getMetaKey(), JSON.stringify({ timestamp }));
      lastSaveRef.current = timestamp;
    } catch (error) {
      console.warn('Failed to auto-save:', error);
    }
  }, [enabled, getFullKey, getMetaKey]);

  const restore = useCallback((): T | null => {
    if (!isBrowser()) return null;

    try {
      const saved = localStorage.getItem(getFullKey());
      if (!saved) return null;

      const parsed = JSON.parse(saved) as T;
      return parsed;
    } catch (error) {
      console.warn('Failed to restore auto-save:', error);
      return null;
    }
  }, [getFullKey]);

  const clear = useCallback(() => {
    if (!isBrowser()) return;

    try {
      localStorage.removeItem(getFullKey());
      localStorage.removeItem(getMetaKey());
      lastSaveRef.current = null;
    } catch (error) {
      console.warn('Failed to clear auto-save:', error);
    }
  }, [getFullKey, getMetaKey]);

  const hasSavedData = useCallback((): boolean => {
    if (!isBrowser()) return false;

    try {
      const saved = localStorage.getItem(getFullKey());
      return saved !== null;
    } catch {
      return false;
    }
  }, [getFullKey]);

  const getLastSaveTime = useCallback((): number | null => {
    if (!isBrowser()) return null;

    try {
      const meta = localStorage.getItem(getMetaKey());
      if (!meta) return null;

      const { timestamp } = JSON.parse(meta) as { timestamp: number };
      return timestamp;
    } catch {
      return null;
    }
  }, [getMetaKey]);

  // Set up auto-save interval
  useEffect(() => {
    if (!enabled || !isBrowser()) return;

    const intervalId = setInterval(() => {
      save();
    }, interval);

    return () => {
      clearInterval(intervalId);
    };
  }, [enabled, interval, save]);

  // Save on unmount if enabled (using refs to avoid stale closures)
  useEffect(() => {
    const fullKey = `auto-save:${storageKey}`;
    const metaKey = `auto-save:${storageKey}:meta`;

    return () => {
      if (enabledRef.current && isBrowser()) {
        try {
          const timestamp = Date.now();
          localStorage.setItem(fullKey, JSON.stringify(dataRef.current));
          localStorage.setItem(metaKey, JSON.stringify({ timestamp }));
        } catch (error) {
          console.warn('Failed to auto-save on unmount:', error);
        }
      }
    };
  }, [storageKey]);

  return {
    restore,
    clear,
    hasSavedData,
    save,
    getLastSaveTime,
  };
}
