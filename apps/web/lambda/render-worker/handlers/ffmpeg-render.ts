/**
 * FFmpeg Render Handler
 *
 * Builds FFmpeg command from edit project data, downloads media,
 * executes FFmpeg, and returns the rendered video buffer.
 */
import { execFile } from 'child_process';
import { createWriteStream, existsSync, mkdirSync, readFileSync, unlinkSync } from 'fs';
import { createHash } from 'crypto';
import { pipeline } from 'stream/promises';
import { tmpdir } from 'os';
import { join } from 'path';

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
    buffer: Buffer;
    durationMs: number;
}

// ──────────────────────────────────────────
// Constants
// ──────────────────────────────────────────

const WORK_DIR = join(tmpdir(), 'render');
const FFMPEG_PATH = process.env.FFMPEG_PATH || '/opt/bin/ffmpeg';

// ──────────────────────────────────────────
// Media download
// ──────────────────────────────────────────

/**
 * Download a media file from URL to /tmp
 * Uses content hash for deduplication
 */
async function downloadMedia(url: string): Promise<string> {
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
    // @ts-expect-error Node.js ReadableStream compatibility
    await pipeline(response.body, fileStream);

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
        filters.push(
            `${videoOutputLabels[0]}copy[vout]`,
        );
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
        '-c:v', 'libx264',
        '-preset', 'medium',
        '-crf', '23',
        '-c:a', 'aac',
        '-b:a', '128k',
        '-ar', '48000',
        '-movflags', '+faststart',
        '-r', String(project.fps),
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
        const { readdirSync } = require('fs');
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
        const outputPath = join(
            WORK_DIR,
            `output_${project.id}_${language}.mp4`,
        );
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

        // 5. Read output file
        const buffer = readFileSync(outputPath);

        console.log(
            `[FFmpeg] Render complete: ${buffer.length} bytes (${(buffer.length / 1024 / 1024).toFixed(1)} MB)`,
        );

        return {
            buffer,
            durationMs: maxEndMs,
        };
    } finally {
        // Clean up temp files
        cleanupWorkDir();
    }
}
