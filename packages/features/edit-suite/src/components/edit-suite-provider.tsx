'use client';

/**
 * EditSuiteProvider — React context wrapping the edit suite state.
 *
 * Provides:
 * - useReducer-based state management
 * - UndoManager for undo/redo
 * - Auto-save (debounced 2s after last dirty change)
 * - Auto-assembly (one-click project creation from episode assets)
 * - Keyboard shortcuts (Cmd+Z, Cmd+Shift+Z, Cmd+S, Space, J/K/L, ←/→, I/O)
 */

import {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useMemo,
    useReducer,
    useRef,
    useState,
} from 'react';

import type { Dispatch, MutableRefObject, ReactNode } from 'react';

import type { AudioEngine } from '../lib/audio-engine';
import type { PlaybackEngine } from '../lib/playback-engine';
import { editReducer } from '../state/edit-reducer';
import type { EditAction, EditSuiteState } from '../state/types';
import { createInitialState } from '../state/types';
import { UndoManager, DeleteClipCommand, SplitClipCommand } from '../state/edit-commands';
import type { EditCommand } from '../state/edit-commands';

// ──────────────────────────────────────────
// Context shape
// ──────────────────────────────────────────

export type AssemblyStatus = 'idle' | 'assembling' | 'done' | 'error';

interface EditSuiteContextValue {
    state: EditSuiteState;
    dispatch: Dispatch<EditAction>;

    /** Execute a command with undo/redo support */
    executeCommand: (command: EditCommand) => void;

    /** Record a command for undo without executing it (state was already applied via dispatches) */
    recordCommand: (command: EditCommand) => void;

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

    /** Auto-assembly status */
    assemblyStatus: AssemblyStatus;

    /** Run auto-assembly for an episode */
    runAutoAssembly: (episodeId: string) => void;

    /** Episode ID from route context (available before project creation) */
    episodeId: string | undefined;

    /** Ref for PlaybackEngine — set by PreviewPanel, read by keyboard shortcuts */
    playbackEngineRef: MutableRefObject<PlaybackEngine | null>;

    /** Ref for AudioEngine — set by PreviewPanel, shared for waveform rendering */
    audioEngineRef: MutableRefObject<AudioEngine | null>;
}

const EditSuiteContext = createContext<EditSuiteContextValue | null>(null);

// ──────────────────────────────────────────
// Provider
// ──────────────────────────────────────────

const AUTO_SAVE_DELAY_MS = 2000;

interface EditSuiteProviderProps {
    children: ReactNode;
    episodeId?: string;
}

export function EditSuiteProvider({ children, episodeId: episodeIdProp }: EditSuiteProviderProps) {
    const [state, dispatch] = useReducer(editReducer, undefined, createInitialState);
    const undoManagerRef = useRef(new UndoManager());
    const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const [assemblyStatus, setAssemblyStatus] = useState<AssemblyStatus>('idle');
    const playbackEngineRef = useRef<PlaybackEngine | null>(null);
    const audioEngineRef = useRef<AudioEngine | null>(null);

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

    const recordCommand = useCallback((command: EditCommand) => {
        undoManagerRef.current.record(command);
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
                        type: t.type,
                        name: t.name,
                        sortOrder: t.sortOrder,
                        volume: t.volume,
                        isMuted: t.isMuted,
                        isSolo: t.isSolo,
                        isLocked: t.isLocked,
                        height: t.height,
                    })),
                dirtyClips: state.clips
                    .filter((c) => state.dirtyClipIds.has(c.id) && !state.newClipIds.has(c.id))
                    .map((c) => ({
                        id: c.id,
                        trackId: c.trackId,
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
                    .filter((k) => state.dirtyKeyframeIds.has(k.id) && !state.newKeyframeIds.has(k.id))
                    .map((k) => ({
                        id: k.id,
                        clipId: k.clipId,
                        property: k.property,
                        offsetMs: k.offsetMs,
                        value: k.value,
                        easing: k.easing,
                        ...(k.bezierCp1X !== null && { bezierCp1X: k.bezierCp1X }),
                        ...(k.bezierCp1Y !== null && { bezierCp1Y: k.bezierCp1Y }),
                        ...(k.bezierCp2X !== null && { bezierCp2X: k.bezierCp2X }),
                        ...(k.bezierCp2Y !== null && { bezierCp2Y: k.bezierCp2Y }),
                    })),
                deletedClipIds: [...state.deletedClipIds],
                deletedKeyframeIds: [...state.deletedKeyframeIds],
                newClips: state.clips
                    .filter((c) => state.newClipIds.has(c.id))
                    .map((c) => ({
                        id: c.id,
                        trackId: c.trackId,
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
                        ...(c.sourceShotId && { sourceShotId: c.sourceShotId }),
                        ...(c.sourceDialogueId && { sourceDialogueId: c.sourceDialogueId }),
                        ...(c.sourceDubbedDialogueId && { sourceDubbedDialogueId: c.sourceDubbedDialogueId }),
                        ...(c.sourceAudioTrackId && { sourceAudioTrackId: c.sourceAudioTrackId }),
                        ...(c.sourceUploadUrl && { sourceUploadUrl: c.sourceUploadUrl }),
                    })),
                newKeyframes: state.keyframes
                    .filter((k) => state.newKeyframeIds.has(k.id))
                    .map((k) => ({
                        id: k.id,
                        clipId: k.clipId,
                        property: k.property,
                        offsetMs: k.offsetMs,
                        value: k.value,
                        easing: k.easing,
                        ...(k.bezierCp1X !== null && { bezierCp1X: k.bezierCp1X }),
                        ...(k.bezierCp1Y !== null && { bezierCp1Y: k.bezierCp1Y }),
                        ...(k.bezierCp2X !== null && { bezierCp2X: k.bezierCp2X }),
                        ...(k.bezierCp2Y !== null && { bezierCp2Y: k.bezierCp2Y }),
                    })),
            });

            dispatch({ type: 'MARK_SAVED' });
        } catch (error) {
            console.error('Failed to save edit project:', error);
            dispatch({ type: 'MARK_SAVE_ERROR' });
        }
    }, [state.saveStatus, state.project, state.tracks, state.clips, state.keyframes, state.dirtyClipIds, state.dirtyTrackIds, state.dirtyKeyframeIds, state.deletedClipIds, state.deletedKeyframeIds]);

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
            // Skip if typing in an input/textarea
            const tag = (e.target as HTMLElement)?.tagName;
            if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

            const isMeta = e.metaKey || e.ctrlKey;

            // Cmd+Z: Undo
            if (isMeta && !e.shiftKey && e.key.toLowerCase() === 'z') {
                e.preventDefault();
                undo();
                return;
            }

            // Cmd+Shift+Z: Redo
            if (isMeta && e.shiftKey && e.key.toLowerCase() === 'z') {
                e.preventDefault();
                redo();
                return;
            }

            // Cmd+S: Force save
            if (isMeta && e.key.toLowerCase() === 's') {
                e.preventDefault();
                void performSave();
                return;
            }

            // Delete / Backspace: Delete selected clips
            if (e.key === 'Delete' || e.key === 'Backspace') {
                if (state.selectedClipIds.size === 0) return;
                e.preventDefault();

                const clipsMap = new Map(state.clips.map((c) => [c.id, c]));
                for (const clipId of state.selectedClipIds) {
                    const clip = clipsMap.get(clipId);
                    if (clip) {
                        executeCommand(new DeleteClipCommand(clip));
                    }
                }
                dispatch({ type: 'DESELECT_ALL' });
                return;
            }

            // S: Split clip at playhead
            if (e.key.toLowerCase() === 's' && !isMeta) {
                // Find clips that overlap the playhead
                const clipsAtPlayhead = state.clips.filter(
                    (c) => c.startMs < state.playheadMs && c.endMs > state.playheadMs,
                );

                if (clipsAtPlayhead.length === 0) return;
                e.preventDefault();

                // If we have selected clips, only split those at the playhead
                const toSplit = state.selectedClipIds.size > 0
                    ? clipsAtPlayhead.filter((c) => state.selectedClipIds.has(c.id))
                    : clipsAtPlayhead;

                for (const clip of toSplit) {
                    executeCommand(new SplitClipCommand(clip, state.playheadMs));
                }
                return;
            }

            // Space: Toggle play/pause
            if (e.key === ' ') {
                e.preventDefault();
                playbackEngineRef.current?.togglePlayPause();
                return;
            }

            // J: Shuttle reverse
            if (e.key.toLowerCase() === 'j') {
                e.preventDefault();
                playbackEngineRef.current?.shuttleReverse();
                return;
            }

            // K: Shuttle pause
            if (e.key.toLowerCase() === 'k') {
                e.preventDefault();
                playbackEngineRef.current?.shuttlePause();
                return;
            }

            // L: Shuttle forward
            if (e.key.toLowerCase() === 'l') {
                e.preventDefault();
                playbackEngineRef.current?.shuttleForward();
                return;
            }

            // Left arrow: Frame step backward
            if (e.key === 'ArrowLeft' && !isMeta) {
                e.preventDefault();
                playbackEngineRef.current?.stepBackward();
                return;
            }

            // Right arrow: Frame step forward
            if (e.key === 'ArrowRight' && !isMeta) {
                e.preventDefault();
                playbackEngineRef.current?.stepForward();
                return;
            }

            // I: Set in-point on selected clip
            if (e.key.toLowerCase() === 'i' && !isMeta) {
                if (state.selectedClipIds.size === 0) return;
                e.preventDefault();
                for (const clipId of state.selectedClipIds) {
                    const clip = state.clips.find((c) => c.id === clipId);
                    if (clip && state.playheadMs >= clip.startMs && state.playheadMs < clip.endMs) {
                        const trimDelta = state.playheadMs - clip.startMs;
                        dispatch({
                            type: 'UPDATE_CLIP',
                            payload: {
                                clipId: clip.id,
                                changes: {
                                    startMs: state.playheadMs,
                                    inPointMs: clip.inPointMs + trimDelta,
                                },
                            },
                        });
                    }
                }
                return;
            }

            // O: Set out-point on selected clip
            if (e.key.toLowerCase() === 'o' && !isMeta) {
                if (state.selectedClipIds.size === 0) return;
                e.preventDefault();
                for (const clipId of state.selectedClipIds) {
                    const clip = state.clips.find((c) => c.id === clipId);
                    if (clip && state.playheadMs > clip.startMs && state.playheadMs <= clip.endMs) {
                        const trimDelta = state.playheadMs - clip.endMs;
                        dispatch({
                            type: 'UPDATE_CLIP',
                            payload: {
                                clipId: clip.id,
                                changes: {
                                    endMs: state.playheadMs,
                                    outPointMs: clip.outPointMs + trimDelta,
                                },
                            },
                        });
                    }
                }
                return;
            }
        }

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [undo, redo, performSave, executeCommand, dispatch, state.selectedClipIds, state.clips, state.playheadMs, playbackEngineRef]);

    // ── Auto-assembly ──

    const runAutoAssembly = useCallback(
        async (episodeId: string) => {
            if (assemblyStatus === 'assembling') return;

            setAssemblyStatus('assembling');

            try {
                // Import and run the assembly algorithm
                const { autoAssemble } = await import('../lib/auto-assemble');
                const result = await autoAssemble({ episodeId });

                // Load the created project into state
                const { getEditProjectAction } = await import('../server/edit-project-actions');
                const projectData = await getEditProjectAction({ editProjectId: result.result.project.id });

                if (projectData.success) {
                    const { tracks, clips, keyframes, transitions, syncGroups, ...project } = projectData.project;
                    dispatch({
                        type: 'LOAD_PROJECT',
                        payload: { project, tracks, clips, keyframes, transitions, syncGroups },
                    });
                } else {
                    throw new Error('Failed to load project after assembly');
                }

                setAssemblyStatus('done');
            } catch (error) {
                console.error('Auto-assembly failed:', error);
                setAssemblyStatus('error');
            }
        },
        [assemblyStatus, dispatch],
    );

    // ── Context value ──

    const value = useMemo<EditSuiteContextValue>(
        () => ({
            state,
            dispatch,
            executeCommand,
            recordCommand,
            undo,
            redo,
            canUndo: undoManagerRef.current.canUndo,
            canRedo: undoManagerRef.current.canRedo,
            forceSave: performSave,
            assemblyStatus,
            runAutoAssembly,
            episodeId: episodeIdProp,
            playbackEngineRef,
            audioEngineRef,
        }),
        [state, executeCommand, recordCommand, undo, redo, performSave, assemblyStatus, runAutoAssembly, episodeIdProp],
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
