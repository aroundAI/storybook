'use server';

import 'server-only';

import { getSupabaseServerClient } from '@kit/supabase/server-client';
import { requireUser } from '@kit/supabase/require-user';

/**
 * Media Bin server query — fetches all episode assets needed for the
 * Media Bin sidebar in a single server action.
 *
 * Returns shots, dialogue lines, dubbed versions, and audio tracks.
 */

// ──────────────────────────────────────────
// Result types
// ──────────────────────────────────────────

export interface MediaBinShot {
    id: string;
    sceneNumber: number;
    shotNumber: number;
    sequenceNumber: number;
    videoUrl: string | null;
    thumbnailUrl: string | null;
    durationSeconds: number;
    status: string;
}

export interface MediaBinDialogueLine {
    id: string;
    text: string;
    characterName: string | null;
    characterAssetId: string | null;
    sceneNumber: number;
    audioUrl: string | null;
    estimatedDurationSeconds: number;
}

export interface MediaBinDubbedVersion {
    id: string;
    dialogueLineId: string;
    language: string;
    text: string;
    audioUrl: string | null;
    estimatedDurationSeconds: number;
}

export interface MediaBinAudioTrack {
    id: string;
    type: string;
    name: string | null;
    fileUrl: string | null;
    durationSeconds: number | null;
    timelineStartSeconds: number;
    status: string;
}

export interface MediaBinQueryResult {
    shots: MediaBinShot[];
    dialogueLines: MediaBinDialogueLine[];
    dubbedVersions: MediaBinDubbedVersion[];
    audioTracks: MediaBinAudioTrack[];
}

// ──────────────────────────────────────────
// Server action
// ──────────────────────────────────────────

export async function getMediaBinDataAction(params: {
    episodeId: string;
}): Promise<MediaBinQueryResult> {
    const client = getSupabaseServerClient();
    const { data: user, error: authError } = await requireUser(client);

    if (authError || !user) {
        throw new Error('Authentication required');
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = client as any;

    // Fetch all data in parallel
    const [shotsRes, dialogueRes, dubbedRes, audioRes] = await Promise.all([
        // Shots
        db
            .from('shots')
            .select('id, scene_number, shot_number, sequence_number, video_url, thumbnail_url, first_frame_url, duration_seconds, status')
            .eq('episode_id', params.episodeId)
            .is('deleted_at', null)
            .order('sequence_number', { ascending: true }),

        // Dialogue lines with character name join
        db
            .from('dialogue_lines')
            .select(`
                id, text, character_asset_id, scene_number, sequence_number,
                audio_url, estimated_duration_seconds,
                character_assets!dialogue_lines_character_asset_id_fkey(name)
            `)
            .eq('episode_id', params.episodeId)
            .order('sequence_number', { ascending: true }),

        // Dubbed dialogue versions
        db
            .from('dubbed_dialogue_versions')
            .select('id, dialogue_line_id, language, translated_text, audio_url, estimated_duration_seconds')
            .eq('episode_id', params.episodeId)
            .order('language', { ascending: true }),

        // Audio tracks
        db
            .from('audio_tracks')
            .select('id, type, name, file_url, duration_seconds, timeline_start_seconds, metadata')
            .eq('episode_id', params.episodeId)
            .order('created_at', { ascending: false }),
    ]);

    // Transform shots
    const shots: MediaBinShot[] = (shotsRes.data ?? []).map((row: Record<string, unknown>) => ({
        id: row.id as string,
        sceneNumber: row.scene_number as number,
        shotNumber: row.shot_number as number,
        sequenceNumber: row.sequence_number as number,
        videoUrl: row.video_url as string | null,
        thumbnailUrl: (row.thumbnail_url ?? row.first_frame_url) as string | null,
        durationSeconds: row.duration_seconds as number,
        status: row.status as string,
    }));

    // Transform dialogue lines
    const dialogueLines: MediaBinDialogueLine[] = (dialogueRes.data ?? []).map((row: Record<string, unknown>) => {
        const charAsset = row.character_assets as Record<string, unknown> | null;
        return {
            id: row.id as string,
            text: row.text as string,
            characterName: charAsset?.name as string | null ?? null,
            characterAssetId: row.character_asset_id as string | null,
            sceneNumber: row.scene_number as number,
            audioUrl: row.audio_url as string | null,
            estimatedDurationSeconds: (row.estimated_duration_seconds as number) || 2,
        };
    });

    // Transform dubbed versions
    const dubbedVersions: MediaBinDubbedVersion[] = (dubbedRes.data ?? []).map((row: Record<string, unknown>) => ({
        id: row.id as string,
        dialogueLineId: row.dialogue_line_id as string,
        language: row.language as string,
        text: row.translated_text as string,
        audioUrl: row.audio_url as string | null,
        estimatedDurationSeconds: (row.estimated_duration_seconds as number) || 2,
    }));

    // Transform audio tracks
    const audioTracks: MediaBinAudioTrack[] = (audioRes.data ?? []).map((row: Record<string, unknown>) => {
        const metadata = row.metadata as Record<string, unknown> | null;
        const hasFile = !!(row.file_url);
        return {
            id: row.id as string,
            type: row.type as string,
            name: row.name as string | null,
            fileUrl: row.file_url as string | null,
            durationSeconds: row.duration_seconds as number | null,
            timelineStartSeconds: row.timeline_start_seconds as number,
            status: (metadata?.status as string) ?? (hasFile ? 'completed' : 'pending'),
        };
    });

    return { shots, dialogueLines, dubbedVersions, audioTracks };
}
