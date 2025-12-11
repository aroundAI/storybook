/**
 * Auto-Stitch Library (FILM-604)
 *
 * Automatically arranges generated shots, dialogue, music, and SFX into a timeline.
 * Eliminates manual clip placement for common workflows while allowing customization.
 */
import type {
  ClipType,
  TimelineClip,
  TimelineData,
  TimelineTrack,
} from '../components/timeline-editor/types';
import { DEFAULT_TRACKS } from '../components/timeline-editor/types';

// ============================================================================
// Input Types (mirror database schema)
// ============================================================================

/**
 * Shot data from database (public.shots table)
 */
export interface ShotInput {
  id: string;
  episode_id: string;
  sequence_number: number;
  duration_seconds: number;
  video_url: string | null;
  thumbnail_url: string | null;
  prompt: string;
  scene_number: number | null;
  shot_number: number | null;
  status:
    | 'pending'
    | 'queued'
    | 'generating'
    | 'completed'
    | 'failed'
    | 'approved';
}

/**
 * Dialogue line from database (public.dialogue_lines table)
 */
export interface DialogueLineInput {
  id: string;
  episode_id: string;
  shot_id: string | null;
  text: string;
  audio_url: string | null;
  sequence_number: number;
  status: 'pending' | 'generating' | 'completed' | 'failed';
}

/**
 * Audio track from database (public.audio_tracks table)
 */
export interface AudioTrackInput {
  id: string;
  episode_id: string;
  type: 'music' | 'sfx' | 'dialogue_composite' | 'ambient';
  name: string | null;
  file_url: string | null;
  duration_seconds: number | null;
  timeline_start_seconds: number;
  volume: number;
  metadata: Record<string, unknown> | null;
}

// ============================================================================
// Configuration Types
// ============================================================================

/**
 * Auto-stitch processing modes
 */
export type AutoStitchMode =
  | 'full'
  | 'shots-only'
  | 'audio-only'
  | 'incremental';

/**
 * Strategy for filling detected gaps
 */
export type GapFillStrategy = 'extend' | 'black' | 'loop' | 'ignore';

/**
 * Optional configuration for auto-stitch behavior
 */
export interface AutoStitchOptions {
  /** Dialogue offset from shot start in seconds (default: 0.5) */
  dialogueOffsetSeconds?: number;
  /** Default music volume (0-1, default: 0.3) */
  musicVolume?: number;
  /** Music fade in duration in seconds (default: 2) */
  musicFadeInSeconds?: number;
  /** Music fade out duration in seconds (default: 2) */
  musicFadeOutSeconds?: number;
  /** Gap threshold in seconds - gaps smaller than this are ignored (default: 0.1) */
  gapThresholdSeconds?: number;
  /** Default dialogue duration estimate when unknown (default: 3) */
  defaultDialogueDurationSeconds?: number;
  /** Target FPS for frame conversion (default: 30) */
  fps?: number;
}

/**
 * Input for auto-stitch operation
 */
export interface AutoStitchInput {
  shots: ShotInput[];
  dialogueLines: DialogueLineInput[];
  audioTracks: AudioTrackInput[];
  mode: AutoStitchMode;
  existingTimeline?: TimelineData;
  options?: AutoStitchOptions;
}

// ============================================================================
// Output Types
// ============================================================================

/**
 * Warning generated during auto-stitch
 */
export interface AutoStitchWarning {
  type:
    | 'missing_video'
    | 'missing_audio'
    | 'gap'
    | 'overlap'
    | 'duration_mismatch';
  message: string;
  shotId?: string;
  dialogueLineId?: string;
  audioTrackId?: string;
  suggestedFix?: string;
  /** Start position in seconds where issue occurs */
  startSeconds?: number;
  /** Duration of gap/overlap in seconds */
  durationSeconds?: number;
}

/**
 * Gap detected in timeline
 */
export interface TimelineGap {
  trackType: ClipType;
  startSeconds: number;
  endSeconds: number;
  durationSeconds: number;
}

/**
 * Statistics from auto-stitch operation
 */
export interface AutoStitchStatistics {
  totalDurationSeconds: number;
  totalDurationFrames: number;
  shotCount: number;
  dialogueCount: number;
  musicTrackCount: number;
  gapsDetected: number;
  placeholderCount: number;
}

/**
 * Complete auto-stitch result
 */
export interface AutoStitchOutput {
  /** Timeline data ready for use with TimelineEditor */
  timeline: TimelineData;
  /** Warnings for user review */
  warnings: AutoStitchWarning[];
  /** Statistics summary */
  statistics: AutoStitchStatistics;
  /** Detected gaps (for optional UI display) */
  gaps: TimelineGap[];
}

// ============================================================================
// Constants
// ============================================================================

/**
 * Default options for auto-stitch
 */
const DEFAULT_OPTIONS: Required<AutoStitchOptions> = {
  dialogueOffsetSeconds: 0.5,
  musicVolume: 0.3,
  musicFadeInSeconds: 2,
  musicFadeOutSeconds: 2,
  gapThresholdSeconds: 0.1,
  defaultDialogueDurationSeconds: 3,
  fps: 30,
};

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Convert seconds to frames
 */
export function secondsToFrames(seconds: number, fps: number): number {
  return Math.round(seconds * fps);
}

/**
 * Convert frames to seconds
 */
export function framesToSeconds(frames: number, fps: number): number {
  return frames / fps;
}

/**
 * Generate unique clip ID
 */
function generateClipId(prefix: string): string {
  const randomPart = Math.random().toString(36).substring(2, 10);
  return `${prefix}-${randomPart}`;
}

/**
 * Create empty tracks from DEFAULT_TRACKS template
 */
function createEmptyTracks(): TimelineTrack[] {
  return DEFAULT_TRACKS.map((template, index) => ({
    ...template,
    id: `track-${template.type}-${index}`,
    clips: [],
  }));
}

/**
 * Find track by type
 */
function findTrack(
  tracks: TimelineTrack[],
  type: ClipType,
): TimelineTrack | undefined {
  return tracks.find((t) => t.type === type);
}

// ============================================================================
// Track Processing Functions
// ============================================================================

/**
 * Process shots onto video track
 */
function processShots(
  shots: ShotInput[],
  tracks: TimelineTrack[],
  warnings: AutoStitchWarning[],
  options: Required<AutoStitchOptions>,
): void {
  const videoTrack = findTrack(tracks, 'video');
  if (!videoTrack) return;

  // Sort shots by sequence_number
  const sortedShots = [...shots].sort(
    (a, b) => a.sequence_number - b.sequence_number,
  );

  let currentFrame = 0;

  for (const shot of sortedShots) {
    const durationFrames = secondsToFrames(shot.duration_seconds, options.fps);

    if (!shot.video_url) {
      // Add warning for missing video
      warnings.push({
        type: 'missing_video',
        message: `Shot ${shot.sequence_number} has no video generated`,
        shotId: shot.id,
        suggestedFix: 'Generate video for this shot before stitching',
      });
    }

    // Create clip (even for pending shots - as placeholder)
    const clip: TimelineClip = {
      id: generateClipId('shot'),
      trackType: 'video',
      startFrame: currentFrame,
      durationFrames,
      name: `Shot ${shot.sequence_number}`,
      shotId: shot.id,
      videoUrl: shot.video_url ?? undefined,
      thumbnailUrl: shot.thumbnail_url ?? undefined,
      isLocked: false,
    };

    videoTrack.clips.push(clip);
    currentFrame += durationFrames;
  }
}

/**
 * Process dialogue lines, syncing to corresponding shots
 */
function processDialogue(
  dialogueLines: DialogueLineInput[],
  shots: ShotInput[],
  tracks: TimelineTrack[],
  warnings: AutoStitchWarning[],
  options: Required<AutoStitchOptions>,
): void {
  const dialogueTrack = findTrack(tracks, 'dialogue');
  if (!dialogueTrack) return;

  // Build shot timing map (in frames)
  const shotTimings = new Map<
    string,
    { startFrame: number; endFrame: number }
  >();
  let currentFrame = 0;

  const sortedShots = [...shots].sort(
    (a, b) => a.sequence_number - b.sequence_number,
  );
  for (const shot of sortedShots) {
    const durationFrames = secondsToFrames(shot.duration_seconds, options.fps);
    shotTimings.set(shot.id, {
      startFrame: currentFrame,
      endFrame: currentFrame + durationFrames,
    });
    currentFrame += durationFrames;
  }

  // Sort dialogue by sequence_number
  const sortedDialogue = [...dialogueLines].sort(
    (a, b) => a.sequence_number - b.sequence_number,
  );

  const dialogueOffsetFrames = secondsToFrames(
    options.dialogueOffsetSeconds,
    options.fps,
  );

  for (const line of sortedDialogue) {
    if (!line.audio_url) {
      warnings.push({
        type: 'missing_audio',
        message: `Dialogue "${line.text.slice(0, 30)}..." has no audio`,
        dialogueLineId: line.id,
        suggestedFix: 'Generate voice for this dialogue line',
      });
      continue;
    }

    // Calculate position based on shot reference
    let startFrame: number;
    const shotTiming = line.shot_id ? shotTimings.get(line.shot_id) : null;

    if (shotTiming) {
      // Place at shot start + offset
      startFrame = shotTiming.startFrame + dialogueOffsetFrames;
    } else {
      // Place sequentially after last dialogue clip
      const lastClip = dialogueTrack.clips[dialogueTrack.clips.length - 1];
      if (lastClip) {
        startFrame =
          lastClip.startFrame + lastClip.durationFrames + dialogueOffsetFrames;
      } else {
        startFrame = dialogueOffsetFrames;
      }
    }

    // Estimate duration (would ideally come from audio metadata)
    const durationFrames = secondsToFrames(
      options.defaultDialogueDurationSeconds,
      options.fps,
    );

    const clip: TimelineClip = {
      id: generateClipId('dialogue'),
      trackType: 'dialogue',
      startFrame,
      durationFrames,
      name: line.text.slice(0, 30) + (line.text.length > 30 ? '...' : ''),
      audioAssetId: line.id,
      isLocked: false,
    };

    dialogueTrack.clips.push(clip);
  }
}

/**
 * Process music tracks spanning episode duration
 */
function processMusic(
  musicTracks: AudioTrackInput[],
  tracks: TimelineTrack[],
  options: Required<AutoStitchOptions>,
): void {
  const musicTrack = findTrack(tracks, 'music');
  if (!musicTrack) return;

  // Calculate episode duration from video track
  const videoTrack = findTrack(tracks, 'video');
  const episodeDurationFrames = videoTrack
    ? Math.max(
        ...videoTrack.clips.map((c) => c.startFrame + c.durationFrames),
        0,
      )
    : 0;

  if (episodeDurationFrames === 0) return;

  let currentFrame = 0;

  for (const music of musicTracks) {
    if (!music.file_url || !music.duration_seconds) continue;

    const remainingFrames = episodeDurationFrames - currentFrame;
    if (remainingFrames <= 0) break;

    const musicDurationFrames = secondsToFrames(
      music.duration_seconds,
      options.fps,
    );
    const clipDurationFrames = Math.min(musicDurationFrames, remainingFrames);

    const clip: TimelineClip = {
      id: generateClipId('music'),
      trackType: 'music',
      startFrame: currentFrame,
      durationFrames: clipDurationFrames,
      name: music.name ?? 'Background Music',
      audioAssetId: music.id,
      isLocked: false,
    };

    musicTrack.clips.push(clip);
    currentFrame += clipDurationFrames;
  }
}

/**
 * Process ambient tracks
 */
function processAmbient(
  ambientTracks: AudioTrackInput[],
  tracks: TimelineTrack[],
  options: Required<AutoStitchOptions>,
): void {
  const ambientTrack = findTrack(tracks, 'ambient');
  if (!ambientTrack) return;

  for (const ambient of ambientTracks) {
    if (!ambient.file_url || !ambient.duration_seconds) continue;

    const startFrame = secondsToFrames(
      ambient.timeline_start_seconds,
      options.fps,
    );
    const durationFrames = secondsToFrames(
      ambient.duration_seconds,
      options.fps,
    );

    const clip: TimelineClip = {
      id: generateClipId('ambient'),
      trackType: 'ambient',
      startFrame,
      durationFrames,
      name: ambient.name ?? 'Ambient',
      audioAssetId: ambient.id,
      isLocked: false,
    };

    ambientTrack.clips.push(clip);
  }
}

// ============================================================================
// Gap Detection Functions
// ============================================================================

/**
 * Detect gaps in all tracks
 */
export function detectGaps(
  tracks: TimelineTrack[],
  thresholdSeconds: number,
  fps: number,
): TimelineGap[] {
  const gaps: TimelineGap[] = [];
  const thresholdFrames = secondsToFrames(thresholdSeconds, fps);

  for (const track of tracks) {
    if (track.clips.length === 0) continue;

    // Sort clips by start frame
    const sortedClips = [...track.clips].sort(
      (a, b) => a.startFrame - b.startFrame,
    );

    // Check gap at start (if first clip doesn't start at 0) - only for video track
    if (
      track.type === 'video' &&
      sortedClips[0] &&
      sortedClips[0].startFrame > thresholdFrames
    ) {
      gaps.push({
        trackType: track.type,
        startSeconds: 0,
        endSeconds: sortedClips[0].startFrame / fps,
        durationSeconds: sortedClips[0].startFrame / fps,
      });
    }

    // Check gaps between clips
    for (let i = 0; i < sortedClips.length - 1; i++) {
      const current = sortedClips[i];
      const next = sortedClips[i + 1];
      if (!current || !next) continue;

      const gapStartFrame = current.startFrame + current.durationFrames;
      const gapEndFrame = next.startFrame;
      const gapDurationFrames = gapEndFrame - gapStartFrame;

      if (gapDurationFrames > thresholdFrames) {
        gaps.push({
          trackType: track.type,
          startSeconds: gapStartFrame / fps,
          endSeconds: gapEndFrame / fps,
          durationSeconds: gapDurationFrames / fps,
        });
      }
    }
  }

  return gaps;
}

/**
 * Calculate total duration from all tracks
 */
function calculateTotalDuration(tracks: TimelineTrack[]): number {
  let maxFrame = 0;

  for (const track of tracks) {
    for (const clip of track.clips) {
      const endFrame = clip.startFrame + clip.durationFrames;
      if (endFrame > maxFrame) {
        maxFrame = endFrame;
      }
    }
  }

  return maxFrame;
}

// ============================================================================
// Gap Fill Function
// ============================================================================

/**
 * Fill gaps using specified strategy
 */
export function fillGaps(
  timeline: TimelineData,
  gaps: TimelineGap[],
  strategy: GapFillStrategy,
): TimelineData {
  if (strategy === 'ignore' || gaps.length === 0) {
    return timeline;
  }

  const newTracks = timeline.tracks.map((track) => {
    const trackGaps = gaps.filter((g) => g.trackType === track.type);
    if (trackGaps.length === 0) return track;

    const newClips = [...track.clips];

    for (const gap of trackGaps) {
      const gapStartFrame = secondsToFrames(gap.startSeconds, timeline.fps);
      const gapDurationFrames = secondsToFrames(
        gap.durationSeconds,
        timeline.fps,
      );

      if (strategy === 'extend') {
        // Find clip ending at gap start
        const prevClip = newClips.find(
          (c) => c.startFrame + c.durationFrames === gapStartFrame,
        );
        if (prevClip) {
          prevClip.durationFrames += gapDurationFrames;
        }
      } else if (strategy === 'black') {
        // Add placeholder/black clip
        newClips.push({
          id: generateClipId('fill'),
          trackType: track.type,
          startFrame: gapStartFrame,
          durationFrames: gapDurationFrames,
          name: 'Gap Fill',
          isLocked: false,
        });
      }
      // 'loop' strategy would be more complex - not implemented for MVP
    }

    return { ...track, clips: newClips };
  });

  return { ...timeline, tracks: newTracks };
}

// ============================================================================
// Main Auto-Stitch Function
// ============================================================================

/**
 * Main auto-stitch function
 *
 * Arranges shots, dialogue, music, and SFX into a timeline automatically.
 */
export function autoStitch(input: AutoStitchInput): AutoStitchOutput {
  const options = { ...DEFAULT_OPTIONS, ...input.options };
  const warnings: AutoStitchWarning[] = [];

  // Initialize tracks from DEFAULT_TRACKS template
  const tracks = createEmptyTracks();

  // 1. Process shots onto video track
  if (input.mode !== 'audio-only') {
    processShots(input.shots, tracks, warnings, options);
  }

  // 2. Process dialogue synced to shots
  if (input.mode !== 'shots-only' && input.dialogueLines.length > 0) {
    processDialogue(
      input.dialogueLines,
      input.shots,
      tracks,
      warnings,
      options,
    );
  }

  // 3. Process music tracks
  if (input.mode !== 'shots-only') {
    const musicInputTracks = input.audioTracks.filter(
      (t) => t.type === 'music',
    );
    if (musicInputTracks.length > 0) {
      processMusic(musicInputTracks, tracks, options);
    }
  }

  // 4. Process ambient tracks
  if (input.mode !== 'shots-only') {
    const ambientInputTracks = input.audioTracks.filter(
      (t) => t.type === 'ambient',
    );
    if (ambientInputTracks.length > 0) {
      processAmbient(ambientInputTracks, tracks, options);
    }
  }

  // 5. Detect gaps
  const gaps = detectGaps(tracks, options.gapThresholdSeconds, options.fps);

  // Add gap warnings
  for (const gap of gaps) {
    warnings.push({
      type: 'gap',
      message: `Gap of ${gap.durationSeconds.toFixed(2)}s detected on ${gap.trackType} track`,
      startSeconds: gap.startSeconds,
      durationSeconds: gap.durationSeconds,
      suggestedFix: 'Extend adjacent clip or add filler content',
    });
  }

  // 6. Calculate total duration
  const totalDurationFrames = calculateTotalDuration(tracks);
  const totalDurationSeconds = framesToSeconds(
    totalDurationFrames,
    options.fps,
  );

  // 7. Build TimelineData output
  const timeline: TimelineData = {
    tracks,
    totalFrames: Math.max(totalDurationFrames, options.fps * 60), // Minimum 1 minute
    fps: options.fps,
    inPoint: null,
    outPoint: null,
    version: 1,
  };

  // 8. Calculate statistics
  const placeholderCount = tracks
    .flatMap((t) => t.clips)
    .filter((c) => c.trackType === 'video' && !c.videoUrl).length;

  const statistics: AutoStitchStatistics = {
    totalDurationSeconds,
    totalDurationFrames,
    shotCount: input.shots.length,
    dialogueCount: input.dialogueLines.filter((d) => d.audio_url).length,
    musicTrackCount: input.audioTracks.filter((t) => t.type === 'music').length,
    gapsDetected: gaps.length,
    placeholderCount,
  };

  return { timeline, warnings, statistics, gaps };
}
