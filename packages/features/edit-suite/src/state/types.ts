'use client';

import type { UserPresence } from '../lib/operational-transforms';
import type { EditOperation } from '../lib/operational-transforms';

/**
 * State types for the Edit Suite v2.
 *
 * Defines the shape of the global editor state managed by useReducer,
 * the discriminated union of all dispatch-able actions, and related enums.
 */

import type {
    DialogueSyncGroup,
    EditClip,
    EditKeyframe,
    EditProject,
    EditTrack,
    EditTransition,
} from '../lib/types';

// ──────────────────────────────────────────
// Save status
// ──────────────────────────────────────────

export type SaveStatus = 'saved' | 'dirty' | 'saving' | 'error';

// ──────────────────────────────────────────
// State shape
// ──────────────────────────────────────────

export interface EditSuiteState {
    /** The edit project metadata (null if not yet loaded) */
    project: EditProject | null;

    /** Tracks indexed by ID for fast lookup */
    tracks: EditTrack[];

    /** All clips across all tracks */
    clips: EditClip[];

    /** Keyframes for all clips */
    keyframes: EditKeyframe[];

    /** Transitions between clips */
    transitions: EditTransition[];

    /** Dialogue sync groups */
    syncGroups: DialogueSyncGroup[];

    // ── Playback ──

    /** Current playhead position in milliseconds */
    playheadMs: number;

    /** Whether the timeline is currently playing */
    isPlaying: boolean;

    // ── Selection ──

    /** IDs of currently selected clips */
    selectedClipIds: Set<string>;

    /** ID of the currently selected track (for track-level operations) */
    selectedTrackId: string | null;

    // ── View ──

    /** Zoom level: pixels per second (10 = zoomed out, 500 = zoomed in) */
    zoom: number;

    /** Horizontal scroll offset in pixels */
    scrollLeft: number;

    /** Whether snap-to-grid/edges is enabled */
    snapEnabled: boolean;

    // ── Persistence ──

    /** Current save status */
    saveStatus: SaveStatus;

    /** IDs of clips modified since last save */
    dirtyClipIds: Set<string>;

    /** IDs of tracks modified since last save */
    dirtyTrackIds: Set<string>;

    /** IDs of keyframes modified since last save */
    dirtyKeyframeIds: Set<string>;

    /** IDs of clips deleted since last save (for server-side sync) */
    deletedClipIds: Set<string>;

    /** IDs of keyframes deleted since last save */
    deletedKeyframeIds: Set<string>;

    /** IDs of tracks deleted since last save */
    deletedTrackIds: Set<string>;

    /** IDs of clips that were newly added (not yet in DB) */
    newClipIds: Set<string>;

    /** IDs of keyframes that were newly added (not yet in DB) */
    newKeyframeIds: Set<string>;

    // ── Active language ──

    /** The currently active language for preview */
    activeLanguage: string;

    // ── Render status (WebSocket-driven) ──

    /** Current render pipeline status */
    renderStatus: 'idle' | 'queued' | 'rendering' | 'completed' | 'failed';

    /** URL of the rendered video (set on completion) */
    renderUrl: string | null;

    /** Error message if render failed */
    renderError: string | null;

    /** Render progress percentage (0-100) */
    renderProgress: number;

    // ── Collaborative editing ──

    /** Active editors on this project (userId → presence) */
    activeEditors: Map<string, UserPresence>;

    /** Remote user cursor positions (userId → cursorMs) */
    remoteCursors: Map<string, { userId: string; displayName: string; color: string; cursorPositionMs: number; activeClipId: string | null }>;
}

// ──────────────────────────────────────────
// Initial state factory
// ──────────────────────────────────────────

export function createInitialState(): EditSuiteState {
    return {
        project: null,
        tracks: [],
        clips: [],
        keyframes: [],
        transitions: [],
        syncGroups: [],
        playheadMs: 0,
        isPlaying: false,
        selectedClipIds: new Set(),
        selectedTrackId: null,
        zoom: 50, // 50px per second default
        scrollLeft: 0,
        snapEnabled: true,
        saveStatus: 'saved',
        dirtyClipIds: new Set(),
        dirtyTrackIds: new Set(),
        dirtyKeyframeIds: new Set(),
        deletedClipIds: new Set(),
        deletedKeyframeIds: new Set(),
        deletedTrackIds: new Set(),
        newClipIds: new Set(),
        newKeyframeIds: new Set(),
        activeLanguage: 'en',
        renderStatus: 'idle',
        renderUrl: null,
        renderError: null,
        renderProgress: 0,
        activeEditors: new Map(),
        remoteCursors: new Map(),
    };
}

// ──────────────────────────────────────────
// Action types (discriminated union)
// ──────────────────────────────────────────

export type EditAction =
    // ── Project lifecycle ──
    | { type: 'LOAD_PROJECT'; payload: { project: EditProject; tracks: EditTrack[]; clips: EditClip[]; keyframes: EditKeyframe[]; transitions: EditTransition[]; syncGroups: DialogueSyncGroup[] } }

    // ── Playback ──
    | { type: 'SET_PLAYHEAD'; payload: { ms: number } }
    | { type: 'SET_PLAYING'; payload: { isPlaying: boolean } }
    | { type: 'STOP_PLAYBACK' }

    // ── View controls ──
    | { type: 'SET_ZOOM'; payload: { zoom: number } }
    | { type: 'SET_SCROLL_LEFT'; payload: { scrollLeft: number } }
    | { type: 'TOGGLE_SNAP' }

    // ── Selection ──
    | { type: 'SELECT_CLIP'; payload: { clipId: string; addToSelection?: boolean } }
    | { type: 'SELECT_CLIPS'; payload: { clipIds: string[] } }
    | { type: 'DESELECT_ALL' }
    | { type: 'SELECT_TRACK'; payload: { trackId: string | null } }

    // ── Clips ──
    | { type: 'ADD_CLIP'; payload: { clip: EditClip } }
    | { type: 'UPDATE_CLIP'; payload: { clipId: string; changes: Partial<EditClip> } }
    | { type: 'REMOVE_CLIP'; payload: { clipId: string } }
    | { type: 'MOVE_CLIP'; payload: { clipId: string; startMs: number; endMs: number; trackId?: string } }

    // ── Tracks ──
    | { type: 'ADD_TRACK'; payload: { track: EditTrack } }
    | { type: 'UPDATE_TRACK'; payload: { trackId: string; changes: Partial<EditTrack> } }
    | { type: 'REMOVE_TRACK'; payload: { trackId: string } }

    // ── Keyframes ──
    | { type: 'ADD_KEYFRAME'; payload: { keyframe: EditKeyframe } }
    | { type: 'UPDATE_KEYFRAME'; payload: { keyframeId: string; changes: Partial<EditKeyframe> } }
    | { type: 'REMOVE_KEYFRAME'; payload: { keyframeId: string } }

    // ── Transitions ──
    | { type: 'ADD_TRANSITION'; payload: { transition: EditTransition } }
    | { type: 'UPDATE_TRANSITION'; payload: { transitionId: string; changes: Partial<EditTransition> } }
    | { type: 'REMOVE_TRANSITION'; payload: { transitionId: string } }

    // ── Language ──
    | { type: 'SET_LANGUAGE'; payload: { language: string } }

    // ── Persistence ──
    | { type: 'MARK_SAVING' }
    | { type: 'MARK_SAVED' }
    | { type: 'MARK_SAVE_ERROR' }

    // ── Render status (WebSocket) ──
    | { type: 'SET_RENDER_STATUS'; payload: { status: 'queued' | 'rendering' | 'completed' | 'failed'; renderUrl?: string | null; renderError?: string | null; progress?: number } }

    // ── Collaborative editing ──
    | { type: 'APPLY_REMOTE_OPERATION'; payload: { operation: EditOperation; senderId: string } }
    | { type: 'UPDATE_PRESENCE'; payload: { userId: string; presence: UserPresence } }
    | { type: 'REMOVE_PRESENCE'; payload: { userId: string } }
    | { type: 'UPDATE_REMOTE_CURSOR'; payload: { userId: string; displayName: string; color: string; cursorPositionMs: number; activeClipId: string | null } };
