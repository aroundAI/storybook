'use client';

/**
 * Edit Suite reducer — pure function managing all editor state transitions.
 *
 * Every edit operation dispatches an action through this reducer.
 * Side effects (server persistence) are handled by the context provider.
 */

import type { EditAction, EditSuiteState } from './types';

export function editReducer(state: EditSuiteState, action: EditAction): EditSuiteState {
    switch (action.type) {
        // ── Project lifecycle ──

        case 'LOAD_PROJECT':
            return {
                ...state,
                project: action.payload.project,
                tracks: action.payload.tracks,
                clips: action.payload.clips,
                keyframes: action.payload.keyframes,
                transitions: action.payload.transitions,
                syncGroups: action.payload.syncGroups,
                activeLanguage: action.payload.project.activeLanguage,
                saveStatus: 'saved',
                dirtyClipIds: new Set(),
                dirtyTrackIds: new Set(),
                dirtyKeyframeIds: new Set(),
            };

        // ── Playback ──

        case 'SET_PLAYHEAD':
            return { ...state, playheadMs: Math.max(0, action.payload.ms) };

        case 'SET_PLAYING':
            return { ...state, isPlaying: action.payload.isPlaying };

        case 'STOP_PLAYBACK':
            return { ...state, isPlaying: false, playheadMs: 0 };

        // ── View controls ──

        case 'SET_ZOOM':
            return {
                ...state,
                zoom: Math.min(500, Math.max(10, action.payload.zoom)),
            };

        case 'SET_SCROLL_LEFT':
            return { ...state, scrollLeft: Math.max(0, action.payload.scrollLeft) };

        case 'TOGGLE_SNAP':
            return { ...state, snapEnabled: !state.snapEnabled };

        // ── Selection ──

        case 'SELECT_CLIP': {
            const next = action.payload.addToSelection
                ? new Set(state.selectedClipIds)
                : new Set<string>();
            next.add(action.payload.clipId);
            return { ...state, selectedClipIds: next };
        }

        case 'SELECT_CLIPS':
            return {
                ...state,
                selectedClipIds: new Set(action.payload.clipIds),
            };

        case 'DESELECT_ALL':
            return {
                ...state,
                selectedClipIds: new Set(),
                selectedTrackId: null,
            };

        case 'SELECT_TRACK':
            return { ...state, selectedTrackId: action.payload.trackId };

        // ── Clips ──

        case 'ADD_CLIP': {
            const dirtyClipIds = new Set(state.dirtyClipIds);
            dirtyClipIds.add(action.payload.clip.id);
            const newClipIds = new Set(state.newClipIds);
            newClipIds.add(action.payload.clip.id);
            return {
                ...state,
                clips: [...state.clips, action.payload.clip],
                dirtyClipIds,
                newClipIds,
                saveStatus: 'dirty',
            };
        }

        case 'UPDATE_CLIP': {
            const dirtyClipIds = new Set(state.dirtyClipIds);
            dirtyClipIds.add(action.payload.clipId);
            return {
                ...state,
                clips: state.clips.map((c) =>
                    c.id === action.payload.clipId
                        ? { ...c, ...action.payload.changes }
                        : c,
                ),
                dirtyClipIds,
                saveStatus: 'dirty',
            };
        }

        case 'REMOVE_CLIP': {
            const removedId = action.payload.clipId;
            const deletedClipIds = new Set(state.deletedClipIds);
            deletedClipIds.add(removedId);
            // Clean dirty tracking for deleted clip
            const dirtyClipIds = new Set(state.dirtyClipIds);
            dirtyClipIds.delete(removedId);
            const newClipIds = new Set(state.newClipIds);
            newClipIds.delete(removedId);
            // Also track keyframes belonging to the removed clip
            const deletedKeyframeIds = new Set(state.deletedKeyframeIds);
            const dirtyKeyframeIds = new Set(state.dirtyKeyframeIds);
            const newKeyframeIds = new Set(state.newKeyframeIds);
            state.keyframes
                .filter((k) => k.clipId === removedId)
                .forEach((k) => {
                    deletedKeyframeIds.add(k.id);
                    dirtyKeyframeIds.delete(k.id);
                    newKeyframeIds.delete(k.id);
                });
            return {
                ...state,
                clips: state.clips.filter((c) => c.id !== removedId),
                keyframes: state.keyframes.filter((k) => k.clipId !== removedId),
                transitions: state.transitions.filter(
                    (t) => t.fromClipId !== removedId && t.toClipId !== removedId,
                ),
                selectedClipIds: (() => {
                    const next = new Set(state.selectedClipIds);
                    next.delete(removedId);
                    return next;
                })(),
                deletedClipIds,
                dirtyClipIds,
                newClipIds,
                deletedKeyframeIds,
                dirtyKeyframeIds,
                newKeyframeIds,
                saveStatus: 'dirty',
            };
        }

        case 'MOVE_CLIP': {
            const dirtyClipIds = new Set(state.dirtyClipIds);
            dirtyClipIds.add(action.payload.clipId);
            return {
                ...state,
                clips: state.clips.map((c) =>
                    c.id === action.payload.clipId
                        ? {
                            ...c,
                            startMs: action.payload.startMs,
                            endMs: action.payload.endMs,
                            ...(action.payload.trackId ? { trackId: action.payload.trackId } : {}),
                        }
                        : c,
                ),
                dirtyClipIds,
                saveStatus: 'dirty',
            };
        }

        // ── Tracks ──

        case 'ADD_TRACK': {
            const dirtyTrackIds = new Set(state.dirtyTrackIds);
            dirtyTrackIds.add(action.payload.track.id);
            return {
                ...state,
                tracks: [...state.tracks, action.payload.track],
                dirtyTrackIds,
                saveStatus: 'dirty',
            };
        }

        case 'UPDATE_TRACK': {
            const dirtyTrackIds = new Set(state.dirtyTrackIds);
            dirtyTrackIds.add(action.payload.trackId);
            return {
                ...state,
                tracks: state.tracks.map((t) =>
                    t.id === action.payload.trackId
                        ? { ...t, ...action.payload.changes }
                        : t,
                ),
                dirtyTrackIds,
                saveStatus: 'dirty',
            };
        }

        case 'REMOVE_TRACK': {
            const removedId = action.payload.trackId;
            const removedClipIds = new Set(
                state.clips.filter((c) => c.trackId === removedId).map((c) => c.id),
            );
            const deletedTrackIds = new Set(state.deletedTrackIds);
            deletedTrackIds.add(removedId);
            const deletedClipIds = new Set(state.deletedClipIds);
            removedClipIds.forEach((id) => deletedClipIds.add(id));
            const deletedKeyframeIds = new Set(state.deletedKeyframeIds);
            state.keyframes
                .filter((k) => removedClipIds.has(k.clipId))
                .forEach((k) => deletedKeyframeIds.add(k.id));
            return {
                ...state,
                tracks: state.tracks.filter((t) => t.id !== removedId),
                clips: state.clips.filter((c) => c.trackId !== removedId),
                keyframes: state.keyframes.filter(
                    (k) => !removedClipIds.has(k.clipId),
                ),
                transitions: state.transitions.filter(
                    (t) =>
                        !removedClipIds.has(t.fromClipId) &&
                        !removedClipIds.has(t.toClipId),
                ),
                deletedTrackIds,
                deletedClipIds,
                deletedKeyframeIds,
                saveStatus: 'dirty',
            };
        }

        // ── Keyframes ──

        case 'ADD_KEYFRAME': {
            const dirtyKeyframeIds = new Set(state.dirtyKeyframeIds);
            dirtyKeyframeIds.add(action.payload.keyframe.id);
            const newKeyframeIds = new Set(state.newKeyframeIds);
            newKeyframeIds.add(action.payload.keyframe.id);
            return {
                ...state,
                keyframes: [...state.keyframes, action.payload.keyframe],
                dirtyKeyframeIds,
                newKeyframeIds,
                saveStatus: 'dirty',
            };
        }

        case 'UPDATE_KEYFRAME': {
            const dirtyKeyframeIds = new Set(state.dirtyKeyframeIds);
            dirtyKeyframeIds.add(action.payload.keyframeId);
            return {
                ...state,
                keyframes: state.keyframes.map((k) =>
                    k.id === action.payload.keyframeId
                        ? { ...k, ...action.payload.changes }
                        : k,
                ),
                dirtyKeyframeIds,
                saveStatus: 'dirty',
            };
        }

        case 'REMOVE_KEYFRAME': {
            const deletedKeyframeIds = new Set(state.deletedKeyframeIds);
            deletedKeyframeIds.add(action.payload.keyframeId);
            const dirtyKeyframeIds = new Set(state.dirtyKeyframeIds);
            dirtyKeyframeIds.delete(action.payload.keyframeId);
            const newKeyframeIds = new Set(state.newKeyframeIds);
            newKeyframeIds.delete(action.payload.keyframeId);
            return {
                ...state,
                keyframes: state.keyframes.filter(
                    (k) => k.id !== action.payload.keyframeId,
                ),
                deletedKeyframeIds,
                saveStatus: 'dirty',
            };
        }

        // ── Transitions ──

        case 'ADD_TRANSITION':
            return {
                ...state,
                transitions: [...state.transitions, action.payload.transition],
                saveStatus: 'dirty',
            };

        case 'UPDATE_TRANSITION':
            return {
                ...state,
                transitions: state.transitions.map((t) =>
                    t.id === action.payload.transitionId
                        ? { ...t, ...action.payload.changes }
                        : t,
                ),
                saveStatus: 'dirty',
            };

        case 'REMOVE_TRANSITION':
            return {
                ...state,
                transitions: state.transitions.filter(
                    (t) => t.id !== action.payload.transitionId,
                ),
                saveStatus: 'dirty',
            };

        // ── Language ──

        case 'SET_LANGUAGE':
            return {
                ...state,
                activeLanguage: action.payload.language,
                clips: state.clips.map((c) => {
                    if (!c.syncGroupId || !c.language) return c;
                    return {
                        ...c,
                        isActive: c.language === action.payload.language,
                    };
                }),
                saveStatus: 'dirty',
            };

        // ── Persistence ──

        case 'MARK_SAVING':
            return { ...state, saveStatus: 'saving' };

        case 'MARK_SAVED':
            return {
                ...state,
                saveStatus: 'saved',
                dirtyClipIds: new Set(),
                dirtyTrackIds: new Set(),
                dirtyKeyframeIds: new Set(),
                deletedClipIds: new Set(),
                deletedKeyframeIds: new Set(),
                deletedTrackIds: new Set(),
                newClipIds: new Set(),
                newKeyframeIds: new Set(),
            };

        case 'MARK_SAVE_ERROR':
            return { ...state, saveStatus: 'error' };

        // ── Render status (WebSocket) ──

        case 'SET_RENDER_STATUS':
            return {
                ...state,
                renderStatus: action.payload.status,
                renderUrl: action.payload.renderUrl ?? state.renderUrl,
                renderError: action.payload.renderError ?? state.renderError,
                renderProgress: action.payload.progress ?? state.renderProgress,
            };

        // ── Collaborative editing ──

        case 'APPLY_REMOTE_OPERATION': {
            const { operation } = action.payload;

            switch (operation.type) {
                case 'move-clip': {
                    const clip = state.clips.find(c => c.id === operation.clipId);
                    if (!clip) return state;
                    const durationMs = clip.endMs - clip.startMs;
                    return {
                        ...state,
                        clips: state.clips.map(c =>
                            c.id === operation.clipId
                                ? { ...c, startMs: operation.toStartMs, endMs: operation.toStartMs + durationMs, trackId: operation.toTrackId }
                                : c,
                        ),
                    };
                }
                case 'resize-clip':
                    return {
                        ...state,
                        clips: state.clips.map(c =>
                            c.id === operation.clipId
                                ? { ...c, startMs: operation.toStartMs, endMs: operation.toEndMs }
                                : c,
                        ),
                    };
                case 'delete-clip':
                    return {
                        ...state,
                        clips: state.clips.filter(c => c.id !== operation.clipId),
                        selectedClipIds: state.selectedClipIds.has(operation.clipId)
                            ? new Set([...state.selectedClipIds].filter(id => id !== operation.clipId))
                            : state.selectedClipIds,
                    };
                case 'update-clip-property':
                    return {
                        ...state,
                        clips: state.clips.map(c =>
                            c.id === operation.clipId
                                ? { ...c, [operation.property]: operation.newValue }
                                : c,
                        ),
                    };
                case 'delete-track':
                    return {
                        ...state,
                        tracks: state.tracks.filter(t => t.id !== operation.trackId),
                        clips: state.clips.filter(c => c.trackId !== operation.trackId),
                    };
                case 'reorder-track': {
                    const reorderedTracks = [...state.tracks];
                    const trackIdx = reorderedTracks.findIndex(t => t.id === operation.trackId);
                    if (trackIdx === -1) return state;
                    const [moved] = reorderedTracks.splice(trackIdx, 1);
                    reorderedTracks.splice(operation.toIndex, 0, moved!);
                    return { ...state, tracks: reorderedTracks };
                }
                default:
                    return state;
            }
        }

        case 'UPDATE_PRESENCE': {
            const newEditors = new Map(state.activeEditors);
            newEditors.set(action.payload.userId, action.payload.presence);
            return { ...state, activeEditors: newEditors };
        }

        case 'REMOVE_PRESENCE': {
            const newEditors = new Map(state.activeEditors);
            newEditors.delete(action.payload.userId);
            const newCursors = new Map(state.remoteCursors);
            newCursors.delete(action.payload.userId);
            return { ...state, activeEditors: newEditors, remoteCursors: newCursors };
        }

        case 'UPDATE_REMOTE_CURSOR': {
            const newCursors = new Map(state.remoteCursors);
            newCursors.set(action.payload.userId, action.payload);
            return { ...state, remoteCursors: newCursors };
        }

        default:
            return state;
    }
}
