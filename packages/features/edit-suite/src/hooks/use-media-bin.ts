'use client';

/**
 * useMediaBin — fetches all episode assets for the Media Bin sidebar.
 *
 * Uses a single server action (`getMediaBinDataAction`) that fetches
 * shots, dialogue lines, dubbed versions, and audio tracks in parallel.
 *
 * Data fetching and section building are separated to avoid stale
 * closures — raw data is stored in state, sections are computed via
 * useMemo whenever rawData or clips change.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';

import type { EditClip } from '../lib/types';
import type {
  MediaBinAudioTrack,
  MediaBinDialogueLine,
  MediaBinDubbedVersion,
  MediaBinQueryResult,
  MediaBinShot,
} from '../server/media-bin-queries';

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
// Section builder (pure function)
// ──────────────────────────────────────────

function buildSections(
  data: MediaBinQueryResult,
  onTimelineIds: Set<string>,
): MediaBinSection[] {
  const sections: MediaBinSection[] = [];

  // Shots (completed only)
  const completedShots = data.shots.filter(
    (s: MediaBinShot) => s.status === 'completed' && s.videoUrl,
  );
  if (completedShots.length > 0) {
    sections.push({
      key: 'shots',
      icon: '🎬',
      label: 'Shots',
      assets: completedShots.map((s: MediaBinShot) => ({
        id: s.id,
        type: 'shot' as const,
        name: `S${s.sceneNumber}.${s.shotNumber}`,
        thumbnailUrl: s.thumbnailUrl,
        mediaUrl: s.videoUrl,
        durationSeconds: s.durationSeconds,
        meta: {
          sceneNumber: s.sceneNumber,
          shotNumber: s.shotNumber,
          sequenceNumber: s.sequenceNumber,
        },
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
      assets: data.dialogueLines.map((d: MediaBinDialogueLine) => ({
        id: d.id,
        type: 'dialogue' as const,
        name: d.characterName
          ? `${d.characterName}: "${d.text.slice(0, 30)}…"`
          : `"${d.text.slice(0, 40)}…"`,
        thumbnailUrl: null,
        mediaUrl: d.audioUrl,
        durationSeconds: d.estimatedDurationSeconds,
        meta: {
          text: d.text,
          characterAssetId: d.characterAssetId,
          sceneNumber: d.sceneNumber,
        },
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
      assets: data.dubbedVersions.map((d: MediaBinDubbedVersion) => ({
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
  const audioByType: Record<
    string,
    { icon: string; label: string; assets: MediaAsset[] }
  > = {
    music: { icon: '🎵', label: 'Music', assets: [] },
    sfx: { icon: '🔊', label: 'SFX', assets: [] },
    ambient: { icon: '🌿', label: 'Ambient', assets: [] },
  };

  for (const track of data.audioTracks) {
    if (
      (track as MediaBinAudioTrack).status !== 'completed' ||
      !(track as MediaBinAudioTrack).fileUrl
    )
      continue;
    const bucket = audioByType[(track as MediaBinAudioTrack).type];
    if (!bucket) continue;

    bucket.assets.push({
      id: track.id,
      type: (track as MediaBinAudioTrack).type as MediaAsset['type'],
      name: track.name ?? `${(track as MediaBinAudioTrack).type} track`,
      thumbnailUrl: null,
      mediaUrl: track.fileUrl,
      durationSeconds: track.durationSeconds ?? 0,
      meta: { timelineStartSeconds: track.timelineStartSeconds },
      isOnTimeline: onTimelineIds.has(track.id),
    });
  }

  for (const [key, bucket] of Object.entries(audioByType)) {
    if (bucket.assets.length > 0) {
      sections.push({
        key,
        icon: bucket.icon,
        label: bucket.label,
        assets: bucket.assets,
      });
    }
  }

  return sections;
}

// ──────────────────────────────────────────
// Hook
// ──────────────────────────────────────────

export function useMediaBin(
  episodeId: string | undefined,
  clips: EditClip[],
): MediaBinData & { refetch: () => void } {
  const [rawData, setRawData] = useState<MediaBinQueryResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    if (!episodeId) return;

    setIsLoading(true);
    setError(null);

    try {
      const { getMediaBinDataAction } = await import(
        '../server/media-bin-queries'
      );
      const result = await getMediaBinDataAction({ episodeId });
      setRawData(result);
    } catch (err) {
      console.error('Failed to fetch media bin data:', err);
      setError(err instanceof Error ? err.message : 'Failed to load media');
    } finally {
      setIsLoading(false);
    }
  }, [episodeId]);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  // Compute sections from raw data + current clips (no stale closure)
  const sections = useMemo(() => {
    if (!rawData) return [];
    const onTimelineIds = new Set<string>();
    for (const clip of clips) {
      if (clip.sourceShotId) onTimelineIds.add(clip.sourceShotId);
      if (clip.sourceDialogueId) onTimelineIds.add(clip.sourceDialogueId);
      if (clip.sourceDubbedDialogueId)
        onTimelineIds.add(clip.sourceDubbedDialogueId);
      if (clip.sourceAudioTrackId) onTimelineIds.add(clip.sourceAudioTrackId);
    }
    return buildSections(rawData, onTimelineIds);
  }, [rawData, clips]);

  return { sections, isLoading, error, refetch: fetchData };
}
