/**
 * Auto-Assembly — builds an edit project from episode assets.
 *
 * This is a client-side algorithm that:
 * 1. Fetches all episode assets via `getMediaBinDataAction`
 * 2. Creates tracks (video, dialogue, one per dubbed language, music, sfx, ambient)
 * 3. Places clips on tracks with proper timing
 * 4. Creates sync groups linking dialogue + dubbed variants
 * 5. Creates default volume keyframes (1.0 at offset 0)
 * 6. Calls `batchAssembleAction` to persist atomically
 *
 * The arrays use index-based cross-references (trackIndex, clipIndex,
 * syncGroupIndex, primaryClipIndex) that the RPC function resolves
 * to real UUIDs after insertion.
 */
import { unwrap } from '@kit/next/action-result';

import type {
  MediaBinAudioTrack,
  MediaBinDialogueLine,
  MediaBinDubbedVersion,
  MediaBinQueryResult,
  MediaBinShot,
} from '../server/media-bin-queries';
import type { KeyframeEasing, KeyframeProperty, TrackType } from './schemas';

// ──────────────────────────────────────────
// Types for the batch arrays
// ──────────────────────────────────────────

interface BatchTrack {
  type: TrackType;
  name: string;
  sortOrder: number;
  volume: number;
}

interface BatchClip {
  trackIndex: number;
  sourceShotId?: string | null;
  sourceDialogueId?: string | null;
  sourceDubbedDialogueId?: string | null;
  sourceAudioTrackId?: string | null;
  mediaUrl?: string | null;
  thumbnailUrl?: string | null;
  startMs: number;
  endMs: number;
  inPointMs: number;
  outPointMs: number;
  volume: number;
  speed: number;
  fadeInMs: number;
  fadeOutMs: number;
  sortOrder: number;
  language?: string | null;
  isActive: boolean;
  syncGroupIndex?: number | null;
}

interface BatchKeyframe {
  clipIndex: number;
  property: KeyframeProperty;
  offsetMs: number;
  value: number;
  easing: KeyframeEasing;
}

interface BatchSyncGroup {
  anchorDialogueId: string;
  primaryClipIndex?: number | null;
}

export interface AutoAssembleParams {
  episodeId: string;
  width?: number;
  height?: number;
  fps?: number;
  activeLanguage?: string;
}

export interface AutoAssemblePayload {
  episodeId: string;
  width: number;
  height: number;
  fps: number;
  activeLanguage: string;
  tracks: BatchTrack[];
  clips: BatchClip[];
  keyframes: BatchKeyframe[];
  syncGroups: BatchSyncGroup[];
}

// ──────────────────────────────────────────
// Constants
// ──────────────────────────────────────────

const DIALOGUE_OFFSET_MS = 500; // Dialogue starts 500ms into its parent shot
const DEFAULT_SHOT_DURATION_S = 5; // Fallback for missing shot duration
const DIALOGUE_GAP_MS = 200; // Gap between dialogue lines in the same scene

// ──────────────────────────────────────────
// Auto-assembly algorithm
// ──────────────────────────────────────────

/**
 * Build the full assembly payload from episode data.
 * Does NOT call the server — returns the payload for the caller to persist.
 */
export function buildAssemblyPayload(
  data: MediaBinQueryResult,
  params: AutoAssembleParams,
): AutoAssemblePayload {
  const tracks: BatchTrack[] = [];
  const clips: BatchClip[] = [];
  const keyframes: BatchKeyframe[] = [];
  const syncGroups: BatchSyncGroup[] = [];

  const activeLanguage = params.activeLanguage ?? 'en';

  // ── 1. Build tracks ──

  // Video track (always first)
  const videoTrackIndex = tracks.length;
  tracks.push({ type: 'video', name: 'Video', sortOrder: 0, volume: 1.0 });

  // Dialogue track (primary language)
  const dialogueTrackIndex = tracks.length;
  tracks.push({
    type: 'dialogue',
    name: `Dialogue (${activeLanguage.toUpperCase()})`,
    sortOrder: 1,
    volume: 1.0,
  });

  // Dubbed tracks — one per unique language (excluding primary)
  const dubbedLanguages = [
    ...new Set(
      data.dubbedVersions
        .map((d: MediaBinDubbedVersion) => d.language)
        .filter((lang: string) => lang !== activeLanguage),
    ),
  ].sort();

  const dubbedTrackMap = new Map<string, number>();
  for (const lang of dubbedLanguages) {
    const idx = tracks.length;
    dubbedTrackMap.set(lang, idx);
    tracks.push({
      type: 'dialogue',
      name: `Dubbed (${lang.toUpperCase()})`,
      sortOrder: tracks.length,
      volume: 1.0,
    });
  }

  // Audio tracks — one per type that has content
  const audioTypes = ['music', 'sfx', 'ambient'] as const;
  const audioTrackMap = new Map<string, number>();

  for (const type of audioTypes) {
    const hasContent = data.audioTracks.some(
      (a: MediaBinAudioTrack) =>
        a.type === type && a.status === 'completed' && a.fileUrl,
    );
    if (hasContent) {
      const idx = tracks.length;
      audioTrackMap.set(type, idx);
      tracks.push({
        type,
        name: type.charAt(0).toUpperCase() + type.slice(1),
        sortOrder: tracks.length,
        volume: 1.0,
      });
    }
  }

  // ── 2. Place shots end-to-end on video track ──

  const completedShots = data.shots
    .filter((s: MediaBinShot) => s.status === 'completed' && s.videoUrl)
    .sort(
      (a: MediaBinShot, b: MediaBinShot) => a.sequenceNumber - b.sequenceNumber,
    );

  // Map: sceneNumber → { startMs, endMs } (for aligning dialogue to shots)
  const sceneTimings = new Map<number, { startMs: number; endMs: number }>();
  let cursor = 0; // ms cursor for end-to-end placement

  for (const shot of completedShots) {
    const durationMs = Math.round(
      (shot.durationSeconds || DEFAULT_SHOT_DURATION_S) * 1000,
    );
    const startMs = cursor;
    const endMs = cursor + durationMs;

    const clipIndex = clips.length;
    clips.push({
      trackIndex: videoTrackIndex,
      sourceShotId: shot.id,
      mediaUrl: shot.videoUrl,
      thumbnailUrl: shot.thumbnailUrl,
      startMs,
      endMs,
      inPointMs: 0,
      outPointMs: durationMs,
      volume: 1.0,
      speed: 1.0,
      fadeInMs: 0,
      fadeOutMs: 0,
      sortOrder: clipIndex,
      isActive: true,
    });

    // Default volume keyframe
    keyframes.push({
      clipIndex,
      property: 'volume',
      offsetMs: 0,
      value: 1.0,
      easing: 'linear',
    });

    // Track scene timing (use first shot for each scene for dialogue alignment)
    if (!sceneTimings.has(shot.sceneNumber)) {
      sceneTimings.set(shot.sceneNumber, { startMs, endMs });
    }

    cursor = endMs;
  }

  // ── 3. Place dialogue lined up with their scene ──

  // Group dialogue by scene for offset calculation within each scene
  const dialogueByScene = new Map<number, MediaBinDialogueLine[]>();
  for (const dl of data.dialogueLines) {
    const scene = dialogueByScene.get(dl.sceneNumber) ?? [];
    scene.push(dl);
    dialogueByScene.set(dl.sceneNumber, scene);
  }

  // syncGroupIndex → dialogueLineId mapping
  const dialogueClipMap = new Map<
    string,
    {
      clipIndex: number;
      syncGroupIndex: number;
      startMs: number;
      durationMs: number;
    }
  >();

  for (const [sceneNumber, lines] of dialogueByScene) {
    const sceneTiming = sceneTimings.get(sceneNumber);
    let sceneOffset = DIALOGUE_OFFSET_MS; // Start 500ms into the scene

    for (const dl of lines) {
      const durationMs = Math.round(dl.estimatedDurationSeconds * 1000);
      const startMs = sceneTiming
        ? sceneTiming.startMs + sceneOffset
        : sceneOffset; // Fallback if no matching shot

      const endMs = startMs + durationMs;
      const clipIndex = clips.length;

      // Create sync group for this dialogue line
      const syncGroupIndex = syncGroups.length;
      syncGroups.push({
        anchorDialogueId: dl.id,
        primaryClipIndex: clipIndex,
      });

      clips.push({
        trackIndex: dialogueTrackIndex,
        sourceDialogueId: dl.id,
        mediaUrl: dl.audioUrl,
        startMs,
        endMs,
        inPointMs: 0,
        outPointMs: durationMs,
        volume: 1.0,
        speed: 1.0,
        fadeInMs: 0,
        fadeOutMs: 0,
        sortOrder: clipIndex,
        language: activeLanguage,
        isActive: true,
        syncGroupIndex,
      });

      // Default volume keyframe
      keyframes.push({
        clipIndex,
        property: 'volume',
        offsetMs: 0,
        value: 1.0,
        easing: 'linear',
      });

      dialogueClipMap.set(dl.id, {
        clipIndex,
        syncGroupIndex,
        startMs,
        durationMs,
      });
      sceneOffset += durationMs + DIALOGUE_GAP_MS; // Gap between dialogue lines
    }
  }

  // ── 4. Place dubbed variants aligned with their primary dialogue ──

  for (const dub of data.dubbedVersions) {
    const trackIndex = dubbedTrackMap.get(dub.language);
    if (trackIndex === undefined) continue;

    const primaryInfo = dialogueClipMap.get(dub.dialogueLineId);
    if (!primaryInfo) continue;

    const durationMs = Math.round(dub.estimatedDurationSeconds * 1000);
    const clipIndex = clips.length;

    clips.push({
      trackIndex,
      sourceDubbedDialogueId: dub.id,
      mediaUrl: dub.audioUrl,
      startMs: primaryInfo.startMs,
      endMs: primaryInfo.startMs + durationMs,
      inPointMs: 0,
      outPointMs: durationMs,
      volume: 1.0,
      speed: 1.0,
      fadeInMs: 0,
      fadeOutMs: 0,
      sortOrder: clipIndex,
      language: dub.language,
      isActive: false, // Non-primary language starts inactive
      syncGroupIndex: primaryInfo.syncGroupIndex,
    });

    // Default volume keyframe
    keyframes.push({
      clipIndex,
      property: 'volume',
      offsetMs: 0,
      value: 1.0,
      easing: 'linear',
    });
  }

  // ── 5. Place audio tracks at their original timeline positions ──

  for (const at of data.audioTracks) {
    if (at.status !== 'completed' || !at.fileUrl) continue;

    const trackIndex = audioTrackMap.get(at.type);
    if (trackIndex === undefined) continue;

    const durationMs = Math.round((at.durationSeconds ?? 0) * 1000);
    if (durationMs <= 0) continue;

    const startMs = Math.round(at.timelineStartSeconds * 1000);
    const endMs = startMs + durationMs;
    const clipIndex = clips.length;

    clips.push({
      trackIndex,
      sourceAudioTrackId: at.id,
      mediaUrl: at.fileUrl,
      startMs,
      endMs,
      inPointMs: 0,
      outPointMs: durationMs,
      volume: 1.0,
      speed: 1.0,
      fadeInMs: 0,
      fadeOutMs: 0,
      sortOrder: clipIndex,
      isActive: true,
    });

    // Default volume keyframe
    keyframes.push({
      clipIndex,
      property: 'volume',
      offsetMs: 0,
      value: 1.0,
      easing: 'linear',
    });
  }

  return {
    episodeId: params.episodeId,
    width: params.width ?? 1920,
    height: params.height ?? 1080,
    fps: params.fps ?? 30,
    activeLanguage,
    tracks,
    clips,
    keyframes,
    syncGroups,
  };
}

/**
 * Full auto-assembly: fetch data → build payload → persist via server action.
 * Returns the batch assemble result.
 */
export async function autoAssemble(params: AutoAssembleParams) {
  // 1. Fetch episode data
  const { getMediaBinDataAction } = await import('../server/media-bin-queries');
  const data = await unwrap(
    getMediaBinDataAction({ episodeId: params.episodeId }),
  );

  // 2. Build the assembly payload
  const payload = buildAssemblyPayload(data, params);

  // 3. Persist atomically via server action
  const { batchAssembleAction } = await import('../server/actions');
  const result = await unwrap(batchAssembleAction(payload));

  if (!result.success) {
    throw new Error('Auto-assembly failed');
  }

  return result;
}
