'use client';

/**
 * FFmpeg Command Builder — generates FFmpeg CLI commands from Edit Suite state.
 *
 * Reads clips, tracks, transitions, and keyframes to produce:
 *   - A `filter_complex` string with video/audio filters
 *   - Input file references for all media clips
 *   - Final output options
 *
 * Video: concat with xfade filter for transitions
 * Audio: amix with per-clip volume and volume keyframe filters
 * Speed: setpts (video) / atempo (audio) per clip
 * Multi-track audio mixing (dialogue + music + sfx → single output)
 */
import { getKeyframesForProperty } from './keyframe-engine';
import type {
  EditClip,
  EditKeyframe,
  EditProject,
  EditTrack,
  EditTransition,
} from './types';

// ──────────────────────────────────────────
// Types
// ──────────────────────────────────────────

interface FFmpegInput {
  index: number;
  url: string;
  clipId: string;
}

interface FFmpegResult {
  /** Full FFmpeg command string */
  command: string;
  /** The filter_complex graph string */
  filterComplex: string;
  /** Input arguments (-i flags) */
  inputs: string[];
  /** Output arguments */
  outputArgs: string[];
  /** Number of filter stages in the filter_complex graph */
  filterStageCount: number;
}

// ──────────────────────────────────────────
// Constants
// ──────────────────────────────────────────

const AUDIO_TRACK_TYPES = new Set([
  'dialogue',
  'music',
  'sfx',
  'ambient',
  'upload',
]);
const VIDEO_TRACK_TYPES = new Set(['video']);

/** Map transition types to FFmpeg xfade transition names */
const XFADE_MAP: Record<string, string> = {
  crossfade: 'fade',
  fade_black: 'fadeblack',
  fade_white: 'fadewhite',
  dissolve: 'dissolve',
  wipe_left: 'wipeleft',
  wipe_right: 'wiperight',
};

/**
 * Escape a string for safe use in a shell command argument.
 * Wraps in single quotes and escapes embedded single quotes.
 */
function escapeShellArg(arg: string): string {
  return "'" + arg.replace(/'/g, "'\\''") + "'";
}

/**
 * Sanitize an output path — allow only safe characters.
 */
function sanitizeOutputPath(path: string): string {
  return path.replace(/[^a-zA-Z0-9._\-/]/g, '_');
}

// ──────────────────────────────────────────
// Public API
// ──────────────────────────────────────────

/**
 * Build an FFmpeg command from the Edit Suite project state.
 *
 * @param project - The edit project metadata (dimensions, fps)
 * @param tracks - All tracks
 * @param clips - All clips (filtered by active language if needed)
 * @param transitions - All transitions
 * @param keyframes - All keyframes
 * @param outputPath - Output file path (default: output.mp4)
 * @returns FFmpegResult with command, filterComplex, inputs, outputArgs
 */
export function buildFFmpegCommand(
  project: EditProject,
  tracks: EditTrack[],
  clips: EditClip[],
  transitions: EditTransition[],
  keyframes: EditKeyframe[],
  outputPath = 'output.mp4',
): FFmpegResult {
  // Only include active clips with media
  const activeClips = clips
    .filter((c) => c.isActive && c.mediaUrl)
    .sort((a, b) => a.startMs - b.startMs);

  if (activeClips.length === 0) {
    return {
      command: '# No active clips to export',
      filterComplex: '',
      inputs: [],
      outputArgs: [],
      filterStageCount: 0,
    };
  }

  // Build input list (unique media URLs → input indices)
  const urlToIndex = new Map<string, number>();
  const inputs: FFmpegInput[] = [];

  for (const clip of activeClips) {
    if (!clip.mediaUrl) continue;
    if (!urlToIndex.has(clip.mediaUrl)) {
      const idx = inputs.length;
      urlToIndex.set(clip.mediaUrl, idx);
      inputs.push({ index: idx, url: clip.mediaUrl, clipId: clip.id });
    }
  }

  const inputArgs = inputs.map((inp) => `-i ${escapeShellArg(inp.url)}`);

  // Separate clips by track type
  const videoClips = activeClips.filter((c) =>
    VIDEO_TRACK_TYPES.has(tracks.find((t) => t.id === c.trackId)?.type ?? ''),
  );
  const audioClips = activeClips.filter((c) =>
    AUDIO_TRACK_TYPES.has(tracks.find((t) => t.id === c.trackId)?.type ?? ''),
  );

  const filterLines: string[] = [];
  let videoOutLabel = '';
  let audioOutLabel = '';

  // ── Video filter chain ──
  if (videoClips.length > 0) {
    videoOutLabel = buildVideoFilters(
      videoClips,
      transitions,
      urlToIndex,
      filterLines,
      project,
    );
  }

  // ── Audio filter chain ──
  if (audioClips.length > 0) {
    audioOutLabel = buildAudioFilters(
      audioClips,
      keyframes,
      urlToIndex,
      filterLines,
      clips,
    );
  }

  const filterComplex = filterLines.join(';\n');

  // ── Output options ──
  const outputArgs: string[] = [];

  if (videoOutLabel) {
    outputArgs.push(`-map "${videoOutLabel}"`);
  }
  if (audioOutLabel) {
    outputArgs.push(`-map "${audioOutLabel}"`);
  }

  outputArgs.push(
    `-c:v libx264 -preset medium -crf 18`,
    `-c:a aac -b:a 192k`,
    `-r ${project.fps}`,
    `-s ${project.width}x${project.height}`,
    `-y ${escapeShellArg(sanitizeOutputPath(outputPath))}`,
  );

  const filterStageCount = filterLines.length;

  // ── Assemble full command ──
  const command = [
    'ffmpeg',
    ...inputArgs,
    `-filter_complex "`,
    filterComplex,
    `"`,
    ...outputArgs,
  ].join(' \\\n  ');

  return {
    command,
    filterComplex,
    inputs: inputArgs,
    outputArgs,
    filterStageCount,
  };
}

// ──────────────────────────────────────────
// Video filter builder
// ──────────────────────────────────────────

function buildVideoFilters(
  videoClips: EditClip[],
  transitions: EditTransition[],
  urlToIndex: Map<string, number>,
  filterLines: string[],
  project: EditProject,
): string {
  const trimmedLabels: string[] = [];

  // Trim and speed-adjust each video clip
  for (let i = 0; i < videoClips.length; i++) {
    const clip = videoClips[i]!;
    const inputIdx = urlToIndex.get(clip.mediaUrl!) ?? 0;
    const label = `v${i}`;

    const startSec = (clip.inPointMs / 1000).toFixed(3);
    const endSec = (clip.outPointMs / 1000).toFixed(3);

    let filters = `[${inputIdx}:v]trim=start=${startSec}:end=${endSec},setpts=PTS-STARTPTS`;

    // Apply speed adjustment
    if (clip.speed !== 1) {
      filters += `,setpts=${(1 / clip.speed).toFixed(3)}*PTS`;
    }

    // Scale to project dimensions
    filters += `,scale=${project.width}:${project.height}:force_original_aspect_ratio=decrease,pad=${project.width}:${project.height}:(ow-iw)/2:(oh-ih)/2`;

    filterLines.push(`${filters}[${label}]`);
    trimmedLabels.push(label);
  }

  // Apply xfade transitions between consecutive clips
  if (trimmedLabels.length === 1) {
    return `[${trimmedLabels[0]}]`;
  }

  let currentLabel = trimmedLabels[0]!;
  for (let i = 0; i < trimmedLabels.length - 1; i++) {
    const nextLabel = trimmedLabels[i + 1]!;
    const outLabel = `vx${i}`;

    // Find transition between these clips
    const clip = videoClips[i]!;
    const nextClip = videoClips[i + 1]!;
    const transition = transitions.find(
      (t) => t.fromClipId === clip.id && t.toClipId === nextClip.id,
    );

    if (transition && transition.type !== 'cut') {
      const durationSec = (transition.durationMs / 1000).toFixed(3);
      const xfadeType = XFADE_MAP[transition.type] ?? 'fade';

      // Calculate offset (where in the timeline the transition starts)
      const clipDurationMs =
        (clip.outPointMs - clip.inPointMs) / (clip.speed || 1);
      const offsetSec = Math.max(
        0,
        (clipDurationMs - transition.durationMs) / 1000,
      ).toFixed(3);

      filterLines.push(
        `[${currentLabel}][${nextLabel}]xfade=transition=${xfadeType}:duration=${durationSec}:offset=${offsetSec}[${outLabel}]`,
      );
    } else {
      // Simple concat (cut)
      filterLines.push(
        `[${currentLabel}][${nextLabel}]concat=n=2:v=1:a=0[${outLabel}]`,
      );
    }

    currentLabel = outLabel;
  }

  return `[${currentLabel}]`;
}

// ──────────────────────────────────────────
// Audio filter builder
// ──────────────────────────────────────────

function buildAudioFilters(
  audioClips: EditClip[],
  keyframes: EditKeyframe[],
  urlToIndex: Map<string, number>,
  filterLines: string[],
  _allClips: EditClip[],
): string {
  const trimmedLabels: string[] = [];

  for (let i = 0; i < audioClips.length; i++) {
    const clip = audioClips[i]!;
    const inputIdx = urlToIndex.get(clip.mediaUrl!) ?? 0;
    const label = `a${i}`;

    const startSec = (clip.inPointMs / 1000).toFixed(3);
    const endSec = (clip.outPointMs / 1000).toFixed(3);

    let filters = `[${inputIdx}:a]atrim=start=${startSec}:end=${endSec},asetpts=PTS-STARTPTS`;

    // Apply speed adjustment via atempo (supports 0.5–2.0 range, chain for wider)
    if (clip.speed !== 1) {
      const atempoFilters = buildAtempoChain(clip.speed);
      filters += `,${atempoFilters}`;
    }

    // Apply base volume
    if (clip.volume !== 1) {
      filters += `,volume=${clip.volume.toFixed(3)}`;
    }

    // Apply volume keyframes as volume filter expressions
    const volumeKfs = getKeyframesForProperty(keyframes, clip.id, 'volume');
    if (volumeKfs.length > 0) {
      const volumeExpr = buildVolumeKeyframeExpression(volumeKfs);
      filters += `,volume='${volumeExpr}':eval=frame`;
    }

    // Add delay to position clip at correct timeline offset
    const delayMs = Math.round(clip.startMs);
    if (delayMs > 0) {
      filters += `,adelay=${delayMs}|${delayMs}`;
    }

    filterLines.push(`${filters}[${label}]`);
    trimmedLabels.push(label);
  }

  // Mix all audio tracks together
  if (trimmedLabels.length === 1) {
    return `[${trimmedLabels[0]}]`;
  }

  const mixInputs = trimmedLabels.map((l) => `[${l}]`).join('');
  const outLabel = 'aout';
  filterLines.push(
    `${mixInputs}amix=inputs=${trimmedLabels.length}:duration=longest:dropout_transition=0[${outLabel}]`,
  );

  return `[${outLabel}]`;
}

// ──────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────

/**
 * Build atempo filter chain for speeds outside the 0.5–2.0 range.
 * FFmpeg's atempo only supports 0.5–100.0, but for speeds < 0.5
 * we chain multiple atempo filters.
 */
function buildAtempoChain(speed: number): string {
  const filters: string[] = [];
  let remaining = speed;

  while (remaining < 0.5) {
    filters.push('atempo=0.5');
    remaining /= 0.5;
  }
  while (remaining > 2.0) {
    filters.push('atempo=2.0');
    remaining /= 2.0;
  }

  filters.push(`atempo=${remaining.toFixed(3)}`);
  return filters.join(',');
}

/**
 * Build a volume expression from keyframes for FFmpeg's volume filter.
 *
 * Uses FFmpeg's expression syntax with `between(t, start, end)` to
 * create piecewise linear volume automation.
 *
 * @example
 * // Two keyframes: 0s→1.0, 2s→0.5
 * // Result: "if(between(t,0,2), 1.0+(0.5-1.0)*(t-0)/(2-0), 0.5)"
 */
function buildVolumeKeyframeExpression(volumeKfs: EditKeyframe[]): string {
  if (volumeKfs.length === 0) return '1';
  if (volumeKfs.length === 1) return volumeKfs[0]!.value.toFixed(3);

  const sorted = [...volumeKfs].sort((a, b) => a.offsetMs - b.offsetMs);
  const parts: string[] = [];

  // Before first keyframe: hold first value
  const firstKf = sorted[0]!;
  parts.push(
    `if(lt(t,${(firstKf.offsetMs / 1000).toFixed(3)}),${firstKf.value.toFixed(3)}`,
  );

  // Between keyframes: linear interpolation
  for (let i = 0; i < sorted.length - 1; i++) {
    const curr = sorted[i]!;
    const next = sorted[i + 1]!;
    const tStart = (curr.offsetMs / 1000).toFixed(3);
    const tEnd = (next.offsetMs / 1000).toFixed(3);
    const vStart = curr.value.toFixed(3);
    const vEnd = next.value.toFixed(3);

    if (curr.easing === 'hold') {
      parts.push(`if(between(t,${tStart},${tEnd}),${vStart}`);
    } else {
      // Linear interpolation: vStart + (vEnd - vStart) * (t - tStart) / (tEnd - tStart)
      parts.push(
        `if(between(t,${tStart},${tEnd}),${vStart}+(${vEnd}-${vStart})*(t-${tStart})/(${tEnd}-${tStart})`,
      );
    }
  }

  // After last keyframe: hold last value
  const lastKf = sorted[sorted.length - 1]!;
  parts.push(lastKf.value.toFixed(3));

  // Close all if() brackets
  const closingParens = ')'.repeat(parts.length - 1);
  return parts.join(',') + closingParens;
}
