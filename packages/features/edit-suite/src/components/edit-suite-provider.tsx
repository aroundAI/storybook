'use client';

/**
 * EditSuiteProvider — React context wrapping the edit suite state.
 *
 * Provides:
 * - useReducer-based state management
 * - UndoManager for undo/redo
 * - Auto-save (debounced 2s after last dirty change)
 * - Keyboard shortcuts (Cmd+Z, Cmd+Shift+Z, Cmd+S)
 */

import {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useMemo,
    useReducer,
    useRef,
} from 'react';

import type { Dispatch, ReactNode } from 'react';

import { editReducer } from '../state/edit-reducer';
import type { EditAction, EditSuiteState } from '../state/types';
import { createInitialState } from '../state/types';
import { UndoManager } from '../state/edit-commands';
import type { EditCommand } from '../state/edit-commands';

// ──────────────────────────────────────────
// Context shape
// ──────────────────────────────────────────

interface EditSuiteContextValue {
    state: EditSuiteState;
    dispatch: Dispatch<EditAction>;

    /** Execute a command with undo/redo support */
    executeCommand: (command: EditCommand) => void;

    /** Undo the last command */
    undo: () => void;

    /** Redo the last undone command */
    redo: () => void;

    /** Whether undo is available */
    canUndo: boolean;

    /** Whether redo is available */
    canRedo: boolean;

    /** Force an immediate save */
    forceSave: () => void;
}

const EditSuiteContext = createContext<EditSuiteContextValue | null>(null);

// ──────────────────────────────────────────
// Provider
// ──────────────────────────────────────────

const AUTO_SAVE_DELAY_MS = 2000;

interface EditSuiteProviderProps {
    children: ReactNode;
}

export function EditSuiteProvider({ children }: EditSuiteProviderProps) {
    const [state, dispatch] = useReducer(editReducer, undefined, createInitialState);
    const undoManagerRef = useRef(new UndoManager());
    const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    // ── Undo / Redo ──

    const executeCommand = useCallback(
        (command: EditCommand) => {
            undoManagerRef.current.execute(command, dispatch);
        },
        [],
    );

    const undo = useCallback(() => {
        undoManagerRef.current.undo(dispatch);
    }, []);

    const redo = useCallback(() => {
        undoManagerRef.current.redo(dispatch);
    }, []);

    // ── Auto-save ──

    const performSave = useCallback(async () => {
        if (state.saveStatus !== 'dirty' || !state.project) return;

        dispatch({ type: 'MARK_SAVING' });

        try {
            // Import server action lazily to avoid SSR issues
            const { batchSaveAction } = await import('../server/batch-actions');

            await batchSaveAction({
                editProjectId: state.project.id,
                dirtyTracks: state.tracks
                    .filter((t) => state.dirtyTrackIds.has(t.id))
                    .map((t) => ({
                        id: t.id,
                        name: t.name,
                        sortOrder: t.sortOrder,
                        volume: t.volume,
                        isMuted: t.isMuted,
                        isSolo: t.isSolo,
                        isLocked: t.isLocked,
                        height: t.height,
                    })),
                dirtyClips: state.clips
                    .filter((c) => state.dirtyClipIds.has(c.id))
                    .map((c) => ({
                        id: c.id,
                        startMs: c.startMs,
                        endMs: c.endMs,
                        inPointMs: c.inPointMs,
                        outPointMs: c.outPointMs,
                        volume: c.volume,
                        speed: c.speed,
                        fadeInMs: c.fadeInMs,
                        fadeOutMs: c.fadeOutMs,
                        sortOrder: c.sortOrder,
                        isActive: c.isActive,
                    })),
                dirtyKeyframes: state.keyframes
                    .filter((k) => state.dirtyKeyframeIds.has(k.id))
                    .map((k) => ({
                        id: k.id,
                        offsetMs: k.offsetMs,
                        value: k.value,
                        easing: k.easing,
                        ...(k.bezierCp1X !== null ? { bezierCp1X: k.bezierCp1X } : {}),
                        ...(k.bezierCp1Y !== null ? { bezierCp1Y: k.bezierCp1Y } : {}),
                        ...(k.bezierCp2X !== null ? { bezierCp2X: k.bezierCp2X } : {}),
                        ...(k.bezierCp2Y !== null ? { bezierCp2Y: k.bezierCp2Y } : {}),
                    })),
                deletedClipIds: [],
                deletedKeyframeIds: [],
                newClips: [],
                newKeyframes: [],
            });

            dispatch({ type: 'MARK_SAVED' });
        } catch {
            dispatch({ type: 'MARK_SAVE_ERROR' });
        }
    }, [state.saveStatus, state.project, state.tracks, state.clips, state.keyframes, state.dirtyClipIds, state.dirtyTrackIds, state.dirtyKeyframeIds]);

    // Debounced auto-save effect
    useEffect(() => {
        if (state.saveStatus !== 'dirty') return;

        saveTimerRef.current = setTimeout(() => {
            void performSave();
        }, AUTO_SAVE_DELAY_MS);

        return () => {
            if (saveTimerRef.current) {
                clearTimeout(saveTimerRef.current);
            }
        };
    }, [state.saveStatus, performSave]);

    // ── Keyboard shortcuts ──

    useEffect(() => {
        function handleKeyDown(e: KeyboardEvent) {
            const isMeta = e.metaKey || e.ctrlKey;

            // Cmd+Z: Undo
            if (isMeta && !e.shiftKey && e.key === 'z') {
                e.preventDefault();
                undo();
                return;
            }

            // Cmd+Shift+Z: Redo
            if (isMeta && e.shiftKey && e.key === 'z') {
                e.preventDefault();
                redo();
                return;
            }

            // Cmd+S: Force save
            if (isMeta && e.key === 's') {
                e.preventDefault();
                void performSave();
                return;
            }
        }

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [undo, redo, performSave]);

    // ── Context value ──

    const value = useMemo<EditSuiteContextValue>(
        () => ({
            state,
            dispatch,
            executeCommand,
            undo,
            redo,
            canUndo: undoManagerRef.current.canUndo,
            canRedo: undoManagerRef.current.canRedo,
            forceSave: performSave,
        }),
        [state, executeCommand, undo, redo, performSave],
    );

    return (
        <EditSuiteContext.Provider value={value}>
            {children}
        </EditSuiteContext.Provider>
    );
}

// ──────────────────────────────────────────
// Hook
// ──────────────────────────────────────────

export function useEditSuite(): EditSuiteContextValue {
    const ctx = useContext(EditSuiteContext);
    if (!ctx) {
        throw new Error('useEditSuite must be used within EditSuiteProvider');
    }
    return ctx;
}
