'use client';

/**
 * useMediaBin — fetches all episode assets for the Media Bin sidebar.
 *
 * Uses a single server action (`getMediaBinDataAction`) that fetches
 * shots, dialogue lines, dubbed versions, and audio tracks in parallel.
 */

import { useCallback, useEffect, useState } from 'react';

import type { EditSuiteState } from '../state/types';
import type { MediaBinQueryResult } from '../server/media-bin-queries';

// ──────────────────────────────────────────
// Types
// ──────────────────────────────────────────

export interface MediaAsset {
    id: string;
    type: 'shot' | 'dialogue' | 'dubbed' | 'music' | 'sfx' | 'ambient' | 'upload';
    name: string;
    thumbnailUrl: string | null;
    mediaUrl: string | null;
    durationSeconds: number;
    /** Extra metadata for drag-to-timeline */
    meta: Record<string, unknown>;
    /** Whether this asset already has a corresponding edit_clip */
    isOnTimeline: boolean;
}

export interface MediaBinSection {
    key: string;
    icon: string;
    label: string;
    assets: MediaAsset[];
}

export interface MediaBinData {
    sections: MediaBinSection[];
    isLoading: boolean;
    error: string | null;
}

/** Data transferred when dragging an asset to the timeline */
export interface DragClipData {
    assetId: string;
    type: MediaAsset['type'];
    name: string;
    mediaUrl: string | null;
    thumbnailUrl: string | null;
    durationMs: number;
    meta: Record<string, unknown>;
}

// ──────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────

function buildSections(data: MediaBinQueryResult, onTimelineIds: Set<string>): MediaBinSection[] {
    const sections: MediaBinSection[] = [];

    // Shots (completed only)
    const completedShots = data.shots.filter((s) => s.status === 'completed' && s.videoUrl);
    if (completedShots.length > 0) {
        sections.push({
            key: 'shots',
            icon: '🎬',
            label: 'Shots',
            assets: completedShots.map((s) => ({
                id: s.id,
                type: 'shot' as const,
                name: `S${s.sceneNumber}.${s.shotNumber}`,
                thumbnailUrl: s.thumbnailUrl,
                mediaUrl: s.videoUrl,
                durationSeconds: s.durationSeconds,
                meta: { sceneNumber: s.sceneNumber, shotNumber: s.shotNumber, sequenceNumber: s.sequenceNumber },
                isOnTimeline: onTimelineIds.has(s.id),
            })),
        });
    }

    // Dialogue
    if (data.dialogueLines.length > 0) {
        sections.push({
            key: 'dialogue',
            icon: '🗣',
            label: 'Dialogue',
            assets: data.dialogueLines.map((d) => ({
                id: d.id,
                type: 'dialogue' as const,
                name: d.characterName
                    ? `${d.characterName}: "${d.text.slice(0, 30)}…"`
                    : `"${d.text.slice(0, 40)}…"`,
                thumbnailUrl: null,
                mediaUrl: d.audioUrl,
                durationSeconds: d.estimatedDurationSeconds,
                meta: { text: d.text, characterAssetId: d.characterAssetId, sceneNumber: d.sceneNumber },
                isOnTimeline: onTimelineIds.has(d.id),
            })),
        });
    }

    // Dubbed versions
    if (data.dubbedVersions.length > 0) {
        sections.push({
            key: 'dubbed',
            icon: '🌐',
            label: 'Dubbed',
            assets: data.dubbedVersions.map((d) => ({
                id: d.id,
                type: 'dubbed' as const,
                name: `[${d.language.toUpperCase()}] ${d.text.slice(0, 30)}…`,
                thumbnailUrl: null,
                mediaUrl: d.audioUrl,
                durationSeconds: d.estimatedDurationSeconds,
                meta: { language: d.language, dialogueLineId: d.dialogueLineId },
                isOnTimeline: onTimelineIds.has(d.id),
            })),
        });
    }

    // Audio tracks grouped by type
    const audioByType: Record<string, { icon: string; label: string; assets: MediaAsset[] }> = {
        music: { icon: '🎵', label: 'Music', assets: [] },
        sfx: { icon: '🔊', label: 'SFX', assets: [] },
        ambient: { icon: '🌿', label: 'Ambient', assets: [] },
    };

    for (const track of data.audioTracks) {
        if (track.status !== 'completed' || !track.fileUrl) continue;
        const bucket = audioByType[track.type];
        if (!bucket) continue;

        bucket.assets.push({
            id: track.id,
            type: track.type as MediaAsset['type'],
            name: track.name ?? `${track.type} track`,
            thumbnailUrl: null,
            mediaUrl: track.fileUrl,
            durationSeconds: track.durationSeconds ?? 0,
            meta: { timelineStartSeconds: track.timelineStartSeconds },
            isOnTimeline: onTimelineIds.has(track.id),
        });
    }

    for (const [key, data] of Object.entries(audioByType)) {
        if (data.assets.length > 0) {
            sections.push({ key, icon: data.icon, label: data.label, assets: data.assets });
        }
    }

    return sections;
}

// ──────────────────────────────────────────
// Hook
// ──────────────────────────────────────────

export function useMediaBin(
    episodeId: string | undefined,
    state: EditSuiteState,
): MediaBinData & { refetch: () => void } {
    const [sections, setSections] = useState<MediaBinSection[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Derive "on timeline" set from current clips
    const onTimelineIds = new Set<string>();
    for (const clip of state.clips) {
        if (clip.sourceShotId) onTimelineIds.add(clip.sourceShotId);
        if (clip.sourceDialogueId) onTimelineIds.add(clip.sourceDialogueId);
        if (clip.sourceDubbedDialogueId) onTimelineIds.add(clip.sourceDubbedDialogueId);
        if (clip.sourceAudioTrackId) onTimelineIds.add(clip.sourceAudioTrackId);
    }

    const fetchData = useCallback(async () => {
        if (!episodeId) return;

        setIsLoading(true);
        setError(null);

        try {
            const { getMediaBinDataAction } = await import('../server/media-bin-queries');
            const result = await getMediaBinDataAction({ episodeId });
            setSections(buildSections(result, onTimelineIds));
        } catch (err) {
            console.error('Failed to fetch media bin data:', err);
            setError(err instanceof Error ? err.message : 'Failed to load media');
        } finally {
            setIsLoading(false);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [episodeId]);

    useEffect(() => {
        void fetchData();
    }, [fetchData]);

    return { sections, isLoading, error, refetch: fetchData };
}
