/**
 * FFmpeg Render Handler
 *
 * Builds FFmpeg command from edit project data, downloads media,
 * executes FFmpeg, and returns the rendered video buffer.
 */
import { execFile } from 'child_process';
import { createHash } from 'crypto';
import { lookup } from 'dns/promises';
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  readdirSync,
  statSync,
  unlinkSync,
} from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';

// ──────────────────────────────────────────
// Types
// ──────────────────────────────────────────

interface EditProject {
  id: string;
  width: number;
  height: number;
  fps: number;
}

interface EditTrack {
  id: string;
  type: string;
  name: string;
  sort_order: number;
  volume: number;
  is_muted: boolean;
}

interface EditClip {
  id: string;
  track_id: string;
  media_url: string | null;
  start_ms: number;
  end_ms: number;
  in_point_ms: number;
  out_point_ms: number;
  volume: number;
  speed: number;
  fade_in_ms: number;
  fade_out_ms: number;
  language: string | null;
}

interface EditTransition {
  id: string;
  from_clip_id: string;
  to_clip_id: string;
  type: string;
  duration_ms: number;
}

interface EditKeyframe {
  id: string;
  clip_id: string;
  property: string;
  offset_ms: number;
  value: number;
}

interface RenderInput {
  project: EditProject;
  tracks: EditTrack[];
  clips: EditClip[];
  transitions: EditTransition[];
  keyframes: EditKeyframe[];
  language: string;
  onProgress: (progress: number) => Promise<void>;
}

interface RenderResult {
  outputPath: string;
  durationMs: number;
}

// ──────────────────────────────────────────
// Constants
// ──────────────────────────────────────────

const WORK_DIR = join(tmpdir(), 'render');

// Resolve FFmpeg binary path:
// 1. ffmpeg-static npm package (bundled in Lambda via nodejs.install)
// 2. FFMPEG_PATH env var (custom override)
// 3. /opt/bin/ffmpeg (Lambda Layer fallback)
function resolveFFmpegPath(): string {
  if (process.env.FFMPEG_PATH) return process.env.FFMPEG_PATH;
  try {
    // ffmpeg-static exports the path to the binary
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const ffmpegPath = require('ffmpeg-static') as string;
    if (ffmpegPath) return ffmpegPath;
  } catch {
    // Package not available, fall through
  }
  return '/opt/bin/ffmpeg';
}

const FFMPEG_PATH = resolveFFmpegPath();

// ──────────────────────────────────────────
// SSRF Protection
// ──────────────────────────────────────────

/** Allowed URL prefixes for media downloads (R2 public URL) */
function getAllowedOrigins(): string[] {
  const origins: string[] = [];
  if (process.env.R2_PUBLIC_URL) {
    origins.push(process.env.R2_PUBLIC_URL);
  }
  return origins;
}

/** IPv4/IPv6 ranges that must never be fetched */
const BLOCKED_IP_RANGES = [
  /^127\./,
  /^10\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
  /^169\.254\./,
  /^0\./,
  /^::1$/,
  /^fc00:/,
  /^fe80:/,
];

/**
 * Validate a URL is safe to fetch (SSRF protection).
 * 1. Must use https.
 * 2. Must match an allowed origin prefix (R2 bucket).
 * 3. Resolved IP must not be in private/reserved ranges.
 */
async function validateMediaUrl(url: string): Promise<void> {
  const parsed = new URL(url);

  if (parsed.protocol !== 'https:') {
    throw new Error(`SSRF blocked: non-HTTPS URL: ${parsed.protocol}`);
  }

  const allowed = getAllowedOrigins();
  if (allowed.length > 0 && !allowed.some((origin) => url.startsWith(origin))) {
    throw new Error(
      `SSRF blocked: URL not in allowed origins: ${parsed.hostname}`,
    );
  }

  // DNS-rebinding protection: resolve hostname and check IP
  try {
    const { address } = await lookup(parsed.hostname);
    if (BLOCKED_IP_RANGES.some((r) => r.test(address))) {
      throw new Error(`SSRF blocked: resolved to private IP: ${address}`);
    }
  } catch (err) {
    if (err instanceof Error && err.message.startsWith('SSRF')) throw err;
    // DNS resolution failure — allow (might be CDN edge that doesn't resolve locally)
    console.warn(`[SSRF] DNS lookup failed for ${parsed.hostname}, proceeding`);
  }
}

// ──────────────────────────────────────────
// Media download
// ──────────────────────────────────────────

/**
 * Download a media file from URL to /tmp
 * Uses content hash for deduplication.
 * Validates URL against allowlist and private IP ranges (SSRF protection).
 */
async function downloadMedia(url: string): Promise<string> {
  // SSRF protection
  await validateMediaUrl(url);

  const hash = createHash('md5').update(url).digest('hex');
  const ext = url.split('.').pop()?.split('?')[0] || 'mp4';
  const localPath = join(WORK_DIR, `${hash}.${ext}`);

  // Skip if already downloaded
  if (existsSync(localPath)) {
    return localPath;
  }

  console.log(`[FFmpeg] Downloading: ${url.substring(0, 80)}...`);

  const response = await fetch(url);
  if (!response.ok || !response.body) {
    throw new Error(`Failed to download media: ${response.status} ${url}`);
  }

  const fileStream = createWriteStream(localPath);
  await pipeline(Readable.fromWeb(response.body as never), fileStream);

  return localPath;
}

/**
 * Download all media files for active clips
 * Returns map of clip id -> local file path
 */
async function downloadAllMedia(
  clips: EditClip[],
  onProgress: (progress: number) => Promise<void>,
): Promise<Map<string, string>> {
  const mediaMap = new Map<string, string>();
  const clipsWithMedia = clips.filter((c) => c.media_url);
  const total = clipsWithMedia.length;

  // Download in parallel batches of 5
  const BATCH_SIZE = 5;
  for (let i = 0; i < total; i += BATCH_SIZE) {
    const batch = clipsWithMedia.slice(i, i + BATCH_SIZE);
    const results = await Promise.all(
      batch.map(async (clip) => {
        const localPath = await downloadMedia(clip.media_url!);
        return { clipId: clip.id, localPath };
      }),
    );

    for (const { clipId, localPath } of results) {
      mediaMap.set(clipId, localPath);
    }

    const progress = Math.min((i + batch.length) / total, 1);
    await onProgress(progress * 0.4); // 0-40% for downloading
  }

  return mediaMap;
}

// ──────────────────────────────────────────
// FFmpeg command builder
// ──────────────────────────────────────────

/**
 * Build FFmpeg filter_complex command from edit project data
 */
function buildFFmpegArgs(
  project: EditProject,
  tracks: EditTrack[],
  clips: EditClip[],
  mediaMap: Map<string, string>,
  outputPath: string,
): string[] {
  const args: string[] = [];

  // Collect clips that have local media files
  const validClips = clips.filter((c) => mediaMap.has(c.id));

  if (validClips.length === 0) {
    throw new Error('No valid clips with media to render');
  }

  // Build track type lookup
  const trackTypeMap = new Map(tracks.map((t) => [t.id, t]));

  // Separate video and audio clips
  const videoClips = validClips
    .filter((c) => {
      const track = trackTypeMap.get(c.track_id);
      return track?.type === 'video' || track?.type === 'upload';
    })
    .sort((a, b) => a.start_ms - b.start_ms);

  const audioClips = validClips
    .filter((c) => {
      const track = trackTypeMap.get(c.track_id);
      return (
        track?.type === 'dialogue' ||
        track?.type === 'music' ||
        track?.type === 'sfx' ||
        track?.type === 'ambient'
      );
    })
    .sort((a, b) => a.start_ms - b.start_ms);

  // ── Input files ──
  const inputFiles: string[] = [];
  const clipInputIndex = new Map<string, number>();

  for (const clip of validClips) {
    const localPath = mediaMap.get(clip.id)!;
    const idx = inputFiles.length;
    inputFiles.push(localPath);
    clipInputIndex.set(clip.id, idx);
  }

  for (const f of inputFiles) {
    args.push('-i', f);
  }

  // ── filter_complex ──
  const filters: string[] = [];
  const videoOutputLabels: string[] = [];
  const audioOutputLabels: string[] = [];

  // Process video clips
  for (let i = 0; i < videoClips.length; i++) {
    const clip = videoClips[i]!;
    const idx = clipInputIndex.get(clip.id)!;
    const trimStart = clip.in_point_ms / 1000;
    const trimEnd = clip.out_point_ms / 1000;
    const label = `v${i}`;

    let filterChain = `[${idx}:v]trim=${trimStart}:${trimEnd},setpts=PTS-STARTPTS`;

    // Apply speed if not 1.0
    if (clip.speed !== 1.0) {
      filterChain += `,setpts=PTS/${clip.speed}`;
    }

    // Scale to project resolution
    filterChain += `,scale=${project.width}:${project.height}:force_original_aspect_ratio=decrease,pad=${project.width}:${project.height}:(ow-iw)/2:(oh-ih)/2`;

    // Apply fade in/out
    if (clip.fade_in_ms > 0) {
      filterChain += `,fade=t=in:d=${clip.fade_in_ms / 1000}`;
    }
    if (clip.fade_out_ms > 0) {
      const dur = (clip.out_point_ms - clip.in_point_ms) / 1000;
      filterChain += `,fade=t=out:st=${dur - clip.fade_out_ms / 1000}:d=${clip.fade_out_ms / 1000}`;
    }

    filterChain += `[${label}]`;
    filters.push(filterChain);
    videoOutputLabels.push(`[${label}]`);
  }

  // Concat video clips
  if (videoOutputLabels.length > 1) {
    filters.push(
      `${videoOutputLabels.join('')}concat=n=${videoOutputLabels.length}:v=1:a=0[vout]`,
    );
  } else if (videoOutputLabels.length === 1) {
    // Rename single stream
    filters.push(`${videoOutputLabels[0]}copy[vout]`);
  }

  // Process audio clips
  for (let i = 0; i < audioClips.length; i++) {
    const clip = audioClips[i]!;
    const idx = clipInputIndex.get(clip.id)!;
    const track = trackTypeMap.get(clip.track_id);
    const trimStart = clip.in_point_ms / 1000;
    const trimEnd = clip.out_point_ms / 1000;
    const label = `a${i}`;

    let filterChain = `[${idx}:a]atrim=${trimStart}:${trimEnd},asetpts=PTS-STARTPTS`;

    // Apply speed
    if (clip.speed !== 1.0) {
      filterChain += `,atempo=${clip.speed}`;
    }

    // Apply volume (clip volume × track volume)
    const trackVolume = track?.is_muted ? 0 : (track?.volume ?? 1.0);
    const effectiveVolume = clip.volume * trackVolume;
    if (effectiveVolume !== 1.0) {
      filterChain += `,volume=${effectiveVolume}`;
    }

    // Apply delay based on clip start position
    if (clip.start_ms > 0) {
      filterChain += `,adelay=${clip.start_ms}|${clip.start_ms}`;
    }

    // Apply fade in/out
    if (clip.fade_in_ms > 0) {
      filterChain += `,afade=t=in:d=${clip.fade_in_ms / 1000}`;
    }
    if (clip.fade_out_ms > 0) {
      const dur = (clip.out_point_ms - clip.in_point_ms) / 1000;
      filterChain += `,afade=t=out:st=${dur - clip.fade_out_ms / 1000}:d=${clip.fade_out_ms / 1000}`;
    }

    filterChain += `[${label}]`;
    filters.push(filterChain);
    audioOutputLabels.push(`[${label}]`);
  }

  // Mix all audio streams
  if (audioOutputLabels.length > 1) {
    filters.push(
      `${audioOutputLabels.join('')}amix=inputs=${audioOutputLabels.length}:duration=longest:dropout_transition=0[aout]`,
    );
  } else if (audioOutputLabels.length === 1) {
    filters.push(`${audioOutputLabels[0]}acopy[aout]`);
  }

  // Build filter_complex string
  if (filters.length > 0) {
    args.push('-filter_complex', filters.join(';'));
  }

  // Map outputs
  if (videoOutputLabels.length > 0) {
    args.push('-map', '[vout]');
  }
  if (audioOutputLabels.length > 0) {
    args.push('-map', '[aout]');
  }

  // Output settings
  args.push(
    '-c:v',
    'libx264',
    '-preset',
    'medium',
    '-crf',
    '23',
    '-c:a',
    'aac',
    '-b:a',
    '128k',
    '-ar',
    '48000',
    '-movflags',
    '+faststart',
    '-r',
    String(project.fps),
    '-y',
    outputPath,
  );

  return args;
}

// ──────────────────────────────────────────
// FFmpeg execution
// ──────────────────────────────────────────

/**
 * Run FFmpeg with progress reporting
 */
function runFFmpeg(
  args: string[],
  totalDurationSec: number,
  onProgress: (progress: number) => Promise<void>,
): Promise<void> {
  return new Promise((resolve, reject) => {
    console.log(`[FFmpeg] Running: ffmpeg ${args.slice(0, 10).join(' ')}...`);

    const proc = execFile(
      FFMPEG_PATH,
      args,
      { maxBuffer: 50 * 1024 * 1024 }, // 50MB buffer for stderr
      (error, _stdout, stderr) => {
        if (error) {
          console.error(`[FFmpeg] stderr:\n${stderr}`);
          reject(new Error(`FFmpeg failed: ${error.message}`));
        } else {
          resolve();
        }
      },
    );

    // Parse FFmpeg progress from stderr
    proc.stderr?.on('data', (data: Buffer) => {
      const line = data.toString();
      const timeMatch = line.match(/time=(\d+):(\d+):(\d+\.\d+)/);
      if (timeMatch) {
        const hours = parseInt(timeMatch[1]!, 10);
        const minutes = parseInt(timeMatch[2]!, 10);
        const seconds = parseFloat(timeMatch[3]!);
        const currentSec = hours * 3600 + minutes * 60 + seconds;
        const progress = Math.min(currentSec / totalDurationSec, 1);
        void onProgress(progress);
      }
    });
  });
}

// ──────────────────────────────────────────
// Cleanup
// ──────────────────────────────────────────

function cleanupWorkDir(): void {
  try {
    const files = readdirSync(WORK_DIR);
    for (const file of files) {
      try {
        unlinkSync(join(WORK_DIR, file));
      } catch {
        // Ignore cleanup errors
      }
    }
  } catch {
    // Work dir doesn't exist or can't be read
  }
}

// ──────────────────────────────────────────
// Main render function
// ──────────────────────────────────────────

export async function processFFmpegRender(
  input: RenderInput,
): Promise<RenderResult> {
  const { project, tracks, clips, language, onProgress } = input;

  // Ensure work directory exists
  if (!existsSync(WORK_DIR)) {
    mkdirSync(WORK_DIR, { recursive: true });
  }

  try {
    // 1. Download all media (0-40% progress)
    console.log(`[FFmpeg] Downloading ${clips.length} clips...`);
    const mediaMap = await downloadAllMedia(clips, onProgress);

    // 2. Build FFmpeg command (instant)
    const outputPath = join(WORK_DIR, `output_${project.id}_${language}.mp4`);
    const ffmpegArgs = buildFFmpegArgs(
      project,
      tracks,
      clips,
      mediaMap,
      outputPath,
    );

    // 3. Calculate total duration for progress tracking
    const maxEndMs = Math.max(...clips.map((c) => c.end_ms), 0);
    const totalDurationSec = maxEndMs / 1000;

    // 4. Run FFmpeg (40-100% progress)
    await runFFmpeg(ffmpegArgs, totalDurationSec, async (p) => {
      await onProgress(0.4 + p * 0.6); // 40-100%
    });

    // 5. Return output path for streaming upload (avoids loading entire video into RAM)
    const { size } = statSync(outputPath);

    console.log(
      `[FFmpeg] Render complete: ${size} bytes (${(size / 1024 / 1024).toFixed(1)} MB)`,
    );

    return {
      outputPath,
      durationMs: maxEndMs,
    };
  } finally {
    // Clean up temp files
    cleanupWorkDir();
  }
}
