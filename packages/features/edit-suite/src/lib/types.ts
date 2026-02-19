import type {
    KeyframeEasing,
    KeyframeProperty,
    RenderStatus,
    TrackType,
    TransitionType,
} from './schemas';

// ──────────────────────────────────────────
// Domain types matching database rows
// ──────────────────────────────────────────

export interface EditProject {
    id: string;
    episodeId: string;
    width: number;
    height: number;
    fps: number;
    activeLanguage: string;
    renderStatus: RenderStatus;
    renderUrl: string | null;
    renderError: string | null;
    renderStartedAt: string | null;
    renderCompletedAt: string | null;
    version: number;
    createdAt: string;
    updatedAt: string;
}

export interface EditTrack {
    id: string;
    editProjectId: string;
    type: TrackType;
    name: string;
    sortOrder: number;
    volume: number;
    isMuted: boolean;
    isSolo: boolean;
    isLocked: boolean;
    height: number;
    createdAt: string;
    updatedAt: string;
}

export interface EditClip {
    id: string;
    trackId: string;
    sourceShotId: string | null;
    sourceDialogueId: string | null;
    sourceDubbedDialogueId: string | null;
    sourceAudioTrackId: string | null;
    sourceUploadUrl: string | null;
    mediaUrl: string | null;
    thumbnailUrl: string | null;
    startMs: number;
    endMs: number;
    inPointMs: number;
    outPointMs: number;
    volume: number;
    speed: number;
    fadeInMs: number;
    fadeOutMs: number;
    sortOrder: number;
    syncGroupId: string | null;
    language: string | null;
    isActive: boolean;
    createdAt: string;
    updatedAt: string;
}

export interface EditTransition {
    id: string;
    fromClipId: string;
    toClipId: string;
    type: TransitionType;
    durationMs: number;
    params: Record<string, unknown>;
    createdAt: string;
}

export interface EditKeyframe {
    id: string;
    clipId: string;
    property: KeyframeProperty;
    offsetMs: number;
    value: number;
    easing: KeyframeEasing;
    bezierCp1X: number | null;
    bezierCp1Y: number | null;
    bezierCp2X: number | null;
    bezierCp2Y: number | null;
    createdAt: string;
}

export interface DialogueSyncGroup {
    id: string;
    editProjectId: string;
    anchorDialogueId: string;
    primaryClipId: string | null;
    createdAt: string;
}

// ──────────────────────────────────────────
// Composite / response types
// ──────────────────────────────────────────

export interface EditProjectFull {
    project: EditProject;
    tracks: EditTrack[];
    clips: EditClip[];
    transitions: EditTransition[];
    keyframes: EditKeyframe[];
    syncGroups: DialogueSyncGroup[];
}

export interface BatchAssembleResult {
    project: EditProject;
    trackCount: number;
    clipCount: number;
    keyframeCount: number;
    syncGroupCount: number;
}

export interface BatchSaveResult {
    updatedClips: number;
    updatedTracks: number;
    updatedKeyframes: number;
    deletedClips: number;
    deletedKeyframes: number;
    createdClips: number;
    createdKeyframes: number;
}

export interface SplitClipResult {
    firstClip: EditClip;
    secondClip: EditClip;
}

// ──────────────────────────────────────────
// Row mappers (snake_case DB → camelCase TS)
// ──────────────────────────────────────────

export function mapEditProjectRow(row: Record<string, unknown>): EditProject {
    return {
        id: row.id as string,
        episodeId: row.episode_id as string,
        width: row.width as number,
        height: row.height as number,
        fps: row.fps as number,
        activeLanguage: row.active_language as string,
        renderStatus: row.render_status as RenderStatus,
        renderUrl: (row.render_url as string) ?? null,
        renderError: (row.render_error as string) ?? null,
        renderStartedAt: (row.render_started_at as string) ?? null,
        renderCompletedAt: (row.render_completed_at as string) ?? null,
        version: row.version as number,
        createdAt: row.created_at as string,
        updatedAt: row.updated_at as string,
    };
}

export function mapEditTrackRow(row: Record<string, unknown>): EditTrack {
    return {
        id: row.id as string,
        editProjectId: row.edit_project_id as string,
        type: row.type as TrackType,
        name: row.name as string,
        sortOrder: row.sort_order as number,
        volume: Number(row.volume),
        isMuted: row.is_muted as boolean,
        isSolo: row.is_solo as boolean,
        isLocked: row.is_locked as boolean,
        height: row.height as number,
        createdAt: row.created_at as string,
        updatedAt: row.updated_at as string,
    };
}

export function mapEditClipRow(row: Record<string, unknown>): EditClip {
    return {
        id: row.id as string,
        trackId: row.track_id as string,
        sourceShotId: (row.source_shot_id as string) ?? null,
        sourceDialogueId: (row.source_dialogue_id as string) ?? null,
        sourceDubbedDialogueId: (row.source_dubbed_dialogue_id as string) ?? null,
        sourceAudioTrackId: (row.source_audio_track_id as string) ?? null,
        sourceUploadUrl: (row.source_upload_url as string) ?? null,
        mediaUrl: (row.media_url as string) ?? null,
        thumbnailUrl: (row.thumbnail_url as string) ?? null,
        startMs: row.start_ms as number,
        endMs: row.end_ms as number,
        inPointMs: row.in_point_ms as number,
        outPointMs: row.out_point_ms as number,
        volume: Number(row.volume),
        speed: Number(row.speed),
        fadeInMs: row.fade_in_ms as number,
        fadeOutMs: row.fade_out_ms as number,
        sortOrder: row.sort_order as number,
        syncGroupId: (row.sync_group_id as string) ?? null,
        language: (row.language as string) ?? null,
        isActive: row.is_active as boolean,
        createdAt: row.created_at as string,
        updatedAt: row.updated_at as string,
    };
}

export function mapEditTransitionRow(
    row: Record<string, unknown>,
): EditTransition {
    return {
        id: row.id as string,
        fromClipId: row.from_clip_id as string,
        toClipId: row.to_clip_id as string,
        type: row.type as TransitionType,
        durationMs: row.duration_ms as number,
        params: (row.params as Record<string, unknown>) ?? {},
        createdAt: row.created_at as string,
    };
}

export function mapEditKeyframeRow(
    row: Record<string, unknown>,
): EditKeyframe {
    return {
        id: row.id as string,
        clipId: row.clip_id as string,
        property: row.property as KeyframeProperty,
        offsetMs: row.offset_ms as number,
        value: Number(row.value),
        easing: row.easing as KeyframeEasing,
        bezierCp1X: row.bezier_cp1_x != null ? Number(row.bezier_cp1_x) : null,
        bezierCp1Y: row.bezier_cp1_y != null ? Number(row.bezier_cp1_y) : null,
        bezierCp2X: row.bezier_cp2_x != null ? Number(row.bezier_cp2_x) : null,
        bezierCp2Y: row.bezier_cp2_y != null ? Number(row.bezier_cp2_y) : null,
        createdAt: row.created_at as string,
    };
}

export function mapDialogueSyncGroupRow(
    row: Record<string, unknown>,
): DialogueSyncGroup {
    return {
        id: row.id as string,
        editProjectId: row.edit_project_id as string,
        anchorDialogueId: row.anchor_dialogue_id as string,
        primaryClipId: (row.primary_clip_id as string) ?? null,
        createdAt: row.created_at as string,
    };
}
