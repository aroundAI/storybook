import { z } from 'zod';

import type {
    KeyframeEasing,
    KeyframeProperty,
    RenderStatus,
    TrackType,
    TransitionType,
} from './schemas';
import {
    KeyframeEasingEnum,
    KeyframePropertyEnum,
    RenderStatusEnum,
    TrackTypeEnum,
    TransitionTypeEnum,
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

export interface EditProjectWithRelations extends EditProject {
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
// Zod row schemas for runtime validation
// ──────────────────────────────────────────
// These validate the raw DB rows at the boundary, catching
// type mismatches at runtime instead of silently casting.

const EditProjectRowSchema = z.object({
    id: z.string().uuid(),
    episode_id: z.string().uuid(),
    width: z.coerce.number().int(),
    height: z.coerce.number().int(),
    fps: z.coerce.number().int(),
    active_language: z.string(),
    render_status: RenderStatusEnum,
    render_url: z.string().nullable().default(null),
    render_error: z.string().nullable().default(null),
    render_started_at: z.string().nullable().default(null),
    render_completed_at: z.string().nullable().default(null),
    version: z.coerce.number().int(),
    created_at: z.string(),
    updated_at: z.string(),
});

const EditTrackRowSchema = z.object({
    id: z.string().uuid(),
    edit_project_id: z.string().uuid(),
    type: TrackTypeEnum,
    name: z.string(),
    sort_order: z.coerce.number().int(),
    volume: z.coerce.number(),
    is_muted: z.boolean(),
    is_solo: z.boolean(),
    is_locked: z.boolean(),
    height: z.coerce.number().int(),
    created_at: z.string(),
    updated_at: z.string(),
});

const EditClipRowSchema = z.object({
    id: z.string().uuid(),
    track_id: z.string().uuid(),
    source_shot_id: z.string().uuid().nullable().default(null),
    source_dialogue_id: z.string().uuid().nullable().default(null),
    source_dubbed_dialogue_id: z.string().uuid().nullable().default(null),
    source_audio_track_id: z.string().uuid().nullable().default(null),
    source_upload_url: z.string().nullable().default(null),
    media_url: z.string().nullable().default(null),
    thumbnail_url: z.string().nullable().default(null),
    start_ms: z.coerce.number().int(),
    end_ms: z.coerce.number().int(),
    in_point_ms: z.coerce.number().int(),
    out_point_ms: z.coerce.number().int(),
    volume: z.coerce.number(),
    speed: z.coerce.number(),
    fade_in_ms: z.coerce.number().int(),
    fade_out_ms: z.coerce.number().int(),
    sort_order: z.coerce.number().int(),
    sync_group_id: z.string().uuid().nullable().default(null),
    language: z.string().nullable().default(null),
    is_active: z.boolean(),
    created_at: z.string(),
    updated_at: z.string(),
});

const EditTransitionRowSchema = z.object({
    id: z.string().uuid(),
    from_clip_id: z.string().uuid(),
    to_clip_id: z.string().uuid(),
    type: TransitionTypeEnum,
    duration_ms: z.coerce.number().int(),
    params: z.record(z.unknown()).default({}),
    created_at: z.string(),
});

const EditKeyframeRowSchema = z.object({
    id: z.string().uuid(),
    clip_id: z.string().uuid(),
    property: KeyframePropertyEnum,
    offset_ms: z.coerce.number().int(),
    value: z.coerce.number(),
    easing: KeyframeEasingEnum,
    bezier_cp1_x: z.coerce.number().nullable().default(null),
    bezier_cp1_y: z.coerce.number().nullable().default(null),
    bezier_cp2_x: z.coerce.number().nullable().default(null),
    bezier_cp2_y: z.coerce.number().nullable().default(null),
    created_at: z.string(),
});

const DialogueSyncGroupRowSchema = z.object({
    id: z.string().uuid(),
    edit_project_id: z.string().uuid(),
    anchor_dialogue_id: z.string().uuid(),
    primary_clip_id: z.string().uuid().nullable().default(null),
    created_at: z.string(),
});

// ──────────────────────────────────────────
// Row mappers (snake_case DB → camelCase TS)
// Uses Zod .parse() for runtime validation.
// ──────────────────────────────────────────

export function mapEditProjectRow(row: Record<string, unknown>): EditProject {
    const r = EditProjectRowSchema.parse(row);
    return {
        id: r.id,
        episodeId: r.episode_id,
        width: r.width,
        height: r.height,
        fps: r.fps,
        activeLanguage: r.active_language,
        renderStatus: r.render_status,
        renderUrl: r.render_url,
        renderError: r.render_error,
        renderStartedAt: r.render_started_at,
        renderCompletedAt: r.render_completed_at,
        version: r.version,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
    };
}

export function mapEditTrackRow(row: Record<string, unknown>): EditTrack {
    const r = EditTrackRowSchema.parse(row);
    return {
        id: r.id,
        editProjectId: r.edit_project_id,
        type: r.type,
        name: r.name,
        sortOrder: r.sort_order,
        volume: r.volume,
        isMuted: r.is_muted,
        isSolo: r.is_solo,
        isLocked: r.is_locked,
        height: r.height,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
    };
}

export function mapEditClipRow(row: Record<string, unknown>): EditClip {
    const r = EditClipRowSchema.parse(row);
    return {
        id: r.id,
        trackId: r.track_id,
        sourceShotId: r.source_shot_id,
        sourceDialogueId: r.source_dialogue_id,
        sourceDubbedDialogueId: r.source_dubbed_dialogue_id,
        sourceAudioTrackId: r.source_audio_track_id,
        sourceUploadUrl: r.source_upload_url,
        mediaUrl: r.media_url,
        thumbnailUrl: r.thumbnail_url,
        startMs: r.start_ms,
        endMs: r.end_ms,
        inPointMs: r.in_point_ms,
        outPointMs: r.out_point_ms,
        volume: r.volume,
        speed: r.speed,
        fadeInMs: r.fade_in_ms,
        fadeOutMs: r.fade_out_ms,
        sortOrder: r.sort_order,
        syncGroupId: r.sync_group_id,
        language: r.language,
        isActive: r.is_active,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
    };
}

export function mapEditTransitionRow(
    row: Record<string, unknown>,
): EditTransition {
    const r = EditTransitionRowSchema.parse(row);
    return {
        id: r.id,
        fromClipId: r.from_clip_id,
        toClipId: r.to_clip_id,
        type: r.type,
        durationMs: r.duration_ms,
        params: r.params,
        createdAt: r.created_at,
    };
}

export function mapEditKeyframeRow(
    row: Record<string, unknown>,
): EditKeyframe {
    const r = EditKeyframeRowSchema.parse(row);
    return {
        id: r.id,
        clipId: r.clip_id,
        property: r.property,
        offsetMs: r.offset_ms,
        value: r.value,
        easing: r.easing,
        bezierCp1X: r.bezier_cp1_x,
        bezierCp1Y: r.bezier_cp1_y,
        bezierCp2X: r.bezier_cp2_x,
        bezierCp2Y: r.bezier_cp2_y,
        createdAt: r.created_at,
    };
}

export function mapSyncGroupRow(
    row: Record<string, unknown>,
): DialogueSyncGroup {
    const r = DialogueSyncGroupRowSchema.parse(row);
    return {
        id: r.id,
        editProjectId: r.edit_project_id,
        anchorDialogueId: r.anchor_dialogue_id,
        primaryClipId: r.primary_clip_id,
        createdAt: r.created_at,
    };
}

