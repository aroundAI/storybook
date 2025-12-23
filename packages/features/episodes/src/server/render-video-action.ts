'use server';

import { exec } from 'child_process';
import { promises as fs } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { promisify } from 'util';

import { revalidatePath } from 'next/cache';

import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';

import { enhanceAction } from '@kit/next/actions';
import { canPerformProjectAction } from '@kit/projects/queries';
import { getLogger } from '@kit/shared/logger';
import { getStorageAdapter } from '@kit/storage';
import { getSupabaseServerClient } from '@kit/supabase/server-client';
import { requireUser } from '@kit/supabase/require-user';

const execAsync = promisify(exec);

// ============================================================================
// Types
// ============================================================================

/**
 * Schema for render video action
 */
const RenderVideoActionSchema = z.object({
    episodeId: z.string().uuid(),
    language: z.enum(['en', 'hi', 'es', 'pt']).default('en'),
    quality: z.enum(['draft', 'standard', 'high']).default('standard'),
    format: z.enum(['mp4', 'webm', 'mov']).default('mp4'),
    dialogueVolume: z.number().min(0).max(2).default(1.0),
    musicVolume: z.number().min(0).max(2).default(0.3),
});

export type RenderVideoActionInput = z.infer<typeof RenderVideoActionSchema>;

export interface RenderVideoActionResult {
    success: boolean;
    jobId?: string;
    outputPath?: string;
    finalVideoUrl?: string;
    durationSeconds?: number;
    error?: string;
    provider?: string;
    language?: string;
}

interface ShotData {
    id: string;
    video_url: string;
    duration_seconds: number;
    sequence_number: number;
}

interface DialogueData {
    id: string;
    audio_url: string;
    timeline_start_seconds: number;
    generation_metadata: { durationSeconds?: number } | null;
}

interface AudioTrackData {
    id: string;
    type: string;
    file_url: string;
    timeline_start_seconds: number;
    duration_seconds: number | null;
    volume: number;
}

// ============================================================================
// Provider Configuration
// ============================================================================

/**
 * Get the configured video render provider
 * 
 * Set VIDEO_RENDER_PROVIDER env var to switch:
 * - 'ffmpeg': Local FFmpeg (default for development)
 * - 'shotstack': Shotstack cloud API
 * - 'creatomate': Creatomate cloud API
 */
function getVideoRenderProvider(): 'ffmpeg' | 'shotstack' | 'creatomate' {
    const provider = process.env.VIDEO_RENDER_PROVIDER?.toLowerCase();

    if (provider === 'shotstack' && process.env.SHOTSTACK_API_KEY) {
        return 'shotstack';
    }
    if (provider === 'creatomate' && process.env.CREATOMATE_API_KEY) {
        return 'creatomate';
    }

    // Default to FFmpeg for local development
    return 'ffmpeg';
}

// ============================================================================
// Main Action
// ============================================================================

/**
 * Render video using configured provider
 *
 * Automatically switches between:
 * - Local FFmpeg (development)
 * - Shotstack/Creatomate (cloud production)
 * 
 * Based on VIDEO_RENDER_PROVIDER environment variable.
 */
export const renderVideoAction = enhanceAction(
    async (input): Promise<RenderVideoActionResult> => {
        const logger = await getLogger();
        const provider = getVideoRenderProvider();

        const ctx = {
            name: 'render-video',
            episodeId: input.episodeId,
            quality: input.quality,
            provider,
        };

        logger.info(ctx, `Starting video render with provider: ${provider}`);

        const client = getSupabaseServerClient();
        const { data: user, error: authError } = await requireUser(client);

        if (authError || !user) {
            logger.warn(ctx, 'Unauthorized render attempt');
            throw new Error('Authentication required');
        }

        try {
            // Fetch episode data (filtered by language for dialogue)
            const episodeData = await fetchEpisodeData(client, input.episodeId, input.language, logger, ctx);

            // Verify permissions
            const canEdit = await canPerformProjectAction(
                episodeData.episode.project_id,
                'project.edit',
            );

            if (!canEdit) {
                throw new Error('Insufficient permissions');
            }

            // Route to appropriate provider
            let result: RenderVideoActionResult;

            switch (provider) {
                case 'ffmpeg':
                    result = await renderWithFFmpeg(input, episodeData, client, logger, ctx);
                    break;
                case 'shotstack':
                    result = await renderWithCloud(input, episodeData, 'shotstack', logger, ctx);
                    break;
                case 'creatomate':
                    result = await renderWithCloud(input, episodeData, 'creatomate', logger, ctx);
                    break;
                default:
                    throw new Error(`Unknown provider: ${provider}`);
            }

            // Update episode with final video URL if successful
            if (result.success && result.finalVideoUrl) {
                // Fetch current localized_videos to merge
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const { data: currentEpisode } = await (client as any)
                    .from('episodes')
                    .select('localized_videos')
                    .eq('id', input.episodeId)
                    .single();

                const currentLocalized = (currentEpisode?.localized_videos || {}) as Record<string, string>;
                const updatedLocalized = {
                    ...currentLocalized,
                    [input.language]: result.finalVideoUrl,
                };

                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                await (client as any)
                    .from('episodes')
                    .update({
                        // Keep final_video_url for backward compatibility (uses English as default)
                        final_video_url: input.language === 'en' ? result.finalVideoUrl : currentEpisode?.final_video_url,
                        localized_videos: updatedLocalized,
                        updated_at: new Date().toISOString(),
                    })
                    .eq('id', input.episodeId);

                revalidatePath('/home/[account]/studio/[projectSlug]/episodes', 'page');
            }

            return { ...result, provider, language: input.language };
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown error';
            logger.error({ ...ctx, error: message }, 'Video render failed');
            return { success: false, error: message, provider };
        }
    },
    {
        schema: RenderVideoActionSchema,
    },
);

// ============================================================================
// Data Fetching
// ============================================================================

interface EpisodeData {
    episode: { id: string; title: string; project_id: string };
    shots: ShotData[];
    dialogueLines: DialogueData[];
    musicTracks: AudioTrackData[];
}

async function fetchEpisodeData(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    client: any,
    episodeId: string,
    language: string,
    logger: ReturnType<typeof getLogger> extends Promise<infer T> ? T : never,
    ctx: Record<string, unknown>,
): Promise<EpisodeData> {
    const [
        { data: episode, error: episodeError },
        { data: shots, error: shotsError },
        { data: dialogueLines },
        { data: audioTracks },
    ] = await Promise.all([
        client
            .from('episodes')
            .select('id, title, project_id')
            .eq('id', episodeId)
            .is('deleted_at', null)
            .single(),
        client
            .from('shots')
            .select('id, video_url, duration_seconds, sequence_number')
            .eq('episode_id', episodeId)
            .eq('status', 'completed')
            .not('video_url', 'is', null)
            .is('deleted_at', null)
            .order('sequence_number', { ascending: true }),
        client
            .from('dialogue_lines')
            .select('id, audio_url, timeline_start_seconds, generation_metadata')
            .eq('episode_id', episodeId)
            .eq('status', 'completed')
            .eq('language', language)
            .not('audio_url', 'is', null)
            .order('sequence_number', { ascending: true }),
        client
            .from('audio_tracks')
            .select('id, type, file_url, timeline_start_seconds, duration_seconds, volume')
            .eq('episode_id', episodeId)
            .eq('status', 'completed')
            .not('file_url', 'is', null),
    ]);

    if (episodeError || !episode) {
        throw new Error('Episode not found');
    }

    if (shotsError) {
        throw new Error(`Failed to fetch shots: ${shotsError.message}`);
    }

    const completedShots = (shots ?? []) as ShotData[];
    if (completedShots.length === 0) {
        throw new Error('No completed shots with video to render');
    }

    logger.info(ctx, `Found ${completedShots.length} shots, ${(dialogueLines ?? []).length} dialogue lines, ${(audioTracks ?? []).length} audio tracks`);

    return {
        episode,
        shots: completedShots,
        dialogueLines: (dialogueLines ?? []) as DialogueData[],
        musicTracks: ((audioTracks ?? []) as AudioTrackData[]).filter(
            (t) => t.type === 'music' && t.file_url,
        ),
    };
}

// ============================================================================
// FFmpeg Provider (Local)
// ============================================================================

async function renderWithFFmpeg(
    input: RenderVideoActionInput,
    data: EpisodeData,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    client: any,
    logger: ReturnType<typeof getLogger> extends Promise<infer T> ? T : never,
    ctx: Record<string, unknown>,
): Promise<RenderVideoActionResult> {
    // Check if FFmpeg is available
    try {
        await execAsync('which ffmpeg');
    } catch {
        throw new Error(
            'FFmpeg is not installed. Please install it with: brew install ffmpeg',
        );
    }

    const { shots, dialogueLines, musicTracks } = data;

    // Create temporary directory for rendering
    const renderDir = join(tmpdir(), `storybook-render-${Date.now()}`);
    await fs.mkdir(renderDir, { recursive: true });

    const localOutputFile = join(renderDir, `final_video.${input.format}`);

    // Build FFmpeg command
    const ffmpegCmd = buildFFmpegCommand({
        shots,
        dialogueLines,
        musicTracks,
        outputFile: localOutputFile,
        quality: input.quality,
        dialogueVolume: input.dialogueVolume,
        musicVolume: input.musicVolume,
    });

    logger.info({ ...ctx, command: ffmpegCmd.slice(0, 200) }, 'Executing FFmpeg');

    // Execute FFmpeg
    try {
        await execAsync(ffmpegCmd, {
            timeout: 1800000, // 30 minutes max
            maxBuffer: 50 * 1024 * 1024, // 50MB buffer
        });
    } catch (execError: unknown) {
        const errorMessage = execError instanceof Error ? execError.message : 'Unknown error';

        // Check if the file was still created (FFmpeg sometimes reports warnings as errors)
        try {
            await fs.access(localOutputFile);
        } catch {
            throw new Error(`FFmpeg failed: ${errorMessage}`);
        }
    }

    // Verify output exists
    const outputStats = await fs.stat(localOutputFile);
    logger.info({ ...ctx, outputSize: outputStats.size }, 'FFmpeg completed');

    // Upload to storage
    const storage = getStorageAdapter(client);
    const videoBuffer = await fs.readFile(localOutputFile);
    const storagePath = `episodes/${input.episodeId}/final-video-${Date.now()}.${input.format}`;

    const uploadResult = await storage.upload(
        'project-assets',
        storagePath,
        videoBuffer,
        {
            contentType: `video/${input.format}`,
            upsert: true,
        },
    );

    // Clean up temp files
    try {
        await fs.unlink(localOutputFile);
        await fs.rmdir(renderDir);
    } catch {
        // Ignore cleanup errors
    }

    const durationSeconds = shots.reduce(
        (acc, shot) => acc + (shot.duration_seconds || 5),
        0,
    );

    return {
        success: true,
        jobId: `ffmpeg-${Date.now()}`,
        outputPath: storagePath,
        finalVideoUrl: uploadResult.url,
        durationSeconds,
    };
}

// ============================================================================
// Cloud Provider (Shotstack/Creatomate)
// ============================================================================

async function renderWithCloud(
    input: RenderVideoActionInput,
    data: EpisodeData,
    providerName: 'shotstack' | 'creatomate',
    logger: ReturnType<typeof getLogger> extends Promise<infer T> ? T : never,
    ctx: Record<string, unknown>,
): Promise<RenderVideoActionResult> {
    // Build timeline in provider-agnostic format
    const timeline = buildCloudTimeline(input, data);

    logger.info({ ...ctx, timelineDuration: timeline.duration }, `Submitting to ${providerName}`);

    // Dynamic import of provider
    const { createRenderProvider } = await import('@kit/video-rendering');

    const providerConfig = providerName === 'shotstack'
        ? { provider: 'shotstack' as const, apiKey: process.env.SHOTSTACK_API_KEY! }
        : { provider: 'creatomate' as const, apiKey: process.env.CREATOMATE_API_KEY! };

    const provider = await createRenderProvider(providerConfig);

    // Submit render job
    const renderResponse = await provider.render({
        timeline,
        priority: 5,
        idempotencyKey: `${input.episodeId}-${Date.now()}`,
        webhookUrl: process.env.VIDEO_RENDER_WEBHOOK_URL,
    });

    logger.info({ ...ctx, jobId: renderResponse.jobId }, 'Cloud render job submitted');

    // For cloud providers, we return immediately and poll for status later
    // The webhook or polling will update the episode when complete
    return {
        success: true,
        jobId: renderResponse.jobId,
        durationSeconds: timeline.duration,
        // Cloud providers return URL when job completes via webhook
        finalVideoUrl: undefined,
    };
}

// ============================================================================
// Timeline Builders
// ============================================================================

function buildCloudTimeline(
    input: RenderVideoActionInput,
    data: EpisodeData,
) {
    const { shots, dialogueLines, musicTracks } = data;

    // Calculate total duration
    let totalDuration = 0;
    const videoClips = shots.map((shot, i) => {
        const startTime = totalDuration;
        const duration = shot.duration_seconds || 5;
        totalDuration += duration;

        return {
            id: uuidv4(),
            trackId: 'video-track',
            assetId: shot.id,
            assetUrl: shot.video_url,
            name: `Shot ${shot.sequence_number}`,
            startTime,
            duration,
            volume: 1,
            isPlaceholder: false,
        };
    });

    // Dialogue clips
    const dialogueClips = dialogueLines.map((d) => ({
        id: uuidv4(),
        trackId: 'dialogue-track',
        assetId: d.id,
        assetUrl: d.audio_url,
        name: 'Dialogue',
        startTime: d.timeline_start_seconds ?? 0,
        duration: d.generation_metadata?.durationSeconds ?? 3,
        volume: input.dialogueVolume,
        isPlaceholder: false,
    }));

    // Music clips
    const musicClips = musicTracks.map((m) => ({
        id: uuidv4(),
        trackId: 'music-track',
        assetId: m.id,
        assetUrl: m.file_url,
        name: m.type,
        startTime: m.timeline_start_seconds ?? 0,
        duration: m.duration_seconds ?? totalDuration,
        volume: (m.volume ?? 1) * input.musicVolume,
        isPlaceholder: false,
    }));

    return {
        id: uuidv4(),
        version: '1.0' as const,
        duration: totalDuration,
        tracks: [
            {
                id: 'video-track',
                type: 'video' as const,
                name: 'Video',
                clips: videoClips,
                volume: 1,
                isMuted: false,
                isLocked: false,
            },
            {
                id: 'dialogue-track',
                type: 'dialogue' as const,
                name: 'Dialogue',
                clips: dialogueClips,
                volume: 1,
                isMuted: false,
                isLocked: false,
            },
            {
                id: 'music-track',
                type: 'music' as const,
                name: 'Music',
                clips: musicClips,
                volume: 1,
                isMuted: false,
                isLocked: false,
            },
        ],
        transitions: [],
        renderSettings: {
            width: 1920,
            height: 1080,
            fps: 30,
            codec: 'h264' as const,
            audioCodec: 'aac' as const,
            format: input.format as 'mp4' | 'webm' | 'mov',
            quality: input.quality,
            audioBitrate: 192,
            sampleRate: 48000,
            includeAudio: true,
        },
        metadata: {
            episodeId: input.episodeId,
        },
    };
}

function buildFFmpegCommand(params: {
    shots: ShotData[];
    dialogueLines: DialogueData[];
    musicTracks: AudioTrackData[];
    outputFile: string;
    quality: 'draft' | 'standard' | 'high';
    dialogueVolume: number;
    musicVolume: number;
}): string {
    const {
        shots,
        dialogueLines,
        musicTracks,
        outputFile,
        quality,
        dialogueVolume,
        musicVolume,
    } = params;

    // Quality settings
    const qualitySettings = {
        draft: { crf: 28, preset: 'ultrafast' },
        standard: { crf: 23, preset: 'medium' },
        high: { crf: 18, preset: 'slow' },
    };
    const { crf, preset } = qualitySettings[quality];

    // Build input list
    const inputs: string[] = [];
    const videoInputs: string[] = [];

    // Add video inputs
    shots.forEach((shot, i) => {
        inputs.push(`-i "${shot.video_url}"`);
        videoInputs.push(`[${i}:v]`);
    });

    const videoCount = shots.length;

    // Add dialogue audio inputs
    const dialogueInputIndices: { index: number; delay: number }[] = [];
    dialogueLines.forEach((d, i) => {
        inputs.push(`-i "${d.audio_url}"`);
        dialogueInputIndices.push({
            index: videoCount + i,
            delay: d.timeline_start_seconds ?? 0,
        });
    });

    const dialogueCount = dialogueLines.length;

    // Add music audio inputs
    const musicInputIndices: { index: number; delay: number; volume: number }[] = [];
    musicTracks.forEach((m, i) => {
        inputs.push(`-i "${m.file_url}"`);
        musicInputIndices.push({
            index: videoCount + dialogueCount + i,
            delay: m.timeline_start_seconds ?? 0,
            volume: (m.volume ?? 1) * musicVolume,
        });
    });

    // Build filter_complex
    const filters: string[] = [];

    // 1. Concat video streams
    if (shots.length > 1) {
        filters.push(`${videoInputs.join('')}concat=n=${shots.length}:v=1:a=0[vout]`);
    } else {
        filters.push(`[0:v]copy[vout]`);
    }

    // 2. Process dialogue audio with delays
    const dialogueLabels: string[] = [];
    dialogueInputIndices.forEach(({ index, delay }, i) => {
        const label = `dialogue${i}`;
        const delayMs = Math.round(delay * 1000);
        filters.push(
            `[${index}:a]volume=${dialogueVolume},adelay=${delayMs}|${delayMs}[${label}]`,
        );
        dialogueLabels.push(`[${label}]`);
    });

    // 3. Process music audio with delays and volume
    const musicLabels: string[] = [];
    musicInputIndices.forEach(({ index, delay, volume }, i) => {
        const label = `music${i}`;
        const delayMs = Math.round(delay * 1000);
        filters.push(
            `[${index}:a]volume=${volume},adelay=${delayMs}|${delayMs}[${label}]`,
        );
        musicLabels.push(`[${label}]`);
    });

    // 4. Mix all audio together
    const allAudioLabels = [...dialogueLabels, ...musicLabels];

    if (allAudioLabels.length > 0) {
        filters.push(
            `${allAudioLabels.join('')}amix=inputs=${allAudioLabels.length}:dropout_transition=0.5:normalize=1[aout]`,
        );
    } else if (shots[0]) {
        filters.push(`[0:a]anull[aout]`);
    }

    // Build final command
    const hasAudio = allAudioLabels.length > 0 || shots.length > 0;
    const outputMaps = hasAudio ? '-map "[vout]" -map "[aout]"' : '-map "[vout]"';

    return [
        'ffmpeg -y',
        inputs.join(' '),
        `-filter_complex "${filters.join(';')}"`,
        outputMaps,
        `-c:v libx264 -crf ${crf} -preset ${preset}`,
        hasAudio ? '-c:a aac -b:a 192k' : '',
        `"${outputFile}"`,
    ]
        .filter(Boolean)
        .join(' ');
}
