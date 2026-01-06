'use server';

import 'server-only';

import { exec } from 'child_process';
import { promises as fs } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { promisify } from 'util';

import { revalidatePath } from 'next/cache';

import { z } from 'zod';

import { enhanceAction } from '@kit/next/actions';
import { getLogger } from '@kit/shared/logger';
import { requireUser } from '@kit/supabase/require-user';
import { getSupabaseServerAdminClient } from '@kit/supabase/server-admin-client';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

import {
    buildVerticalCropArgs,
    type CropMode,
    PLATFORM_SPECS,
} from '../lib/ffmpeg-vertical-crop';

const execAsync = promisify(exec);

// =============================================================================
// Schema
// =============================================================================

const GenerateShortSchema = z.object({
    episodeId: z.string().uuid(),
    shotId: z.string().uuid(),
    // Optional boundary overrides
    startSecondsOverride: z.number().min(0).optional(),
    endSecondsOverride: z.number().min(0).optional(),
    // Clip settings
    title: z.string().max(200).optional(),
    caption: z.string().optional(),
    hashtags: z.array(z.string()).optional(),
    // Processing options
    cropMode: z.enum(['center', 'blur_bars']).optional(),
});

type GenerateShortInput = z.infer<typeof GenerateShortSchema>;

interface GenerateShortResult {
    success: boolean;
    shortId?: string;
    videoUrl?: string;
    durationSeconds?: number;
    error?: string;
}

// =============================================================================
// Types for database queries
// =============================================================================

interface ShotRow {
    id: string;
    episode_id: string;
    sequence_number: number;
    duration_seconds: number;
    video_url: string | null;
    shorts_candidate: boolean;
    shorts_metadata: {
        viralScore?: number;
        hookType?: string;
        standaloneSummary?: string;
    } | null;
}

interface EpisodeRow {
    id: string;
    project_id: string;
    title: string;
    final_video_url: string | null;
}

// =============================================================================
// Main Action
// =============================================================================

/**
 * Generate a vertical (9:16) short clip from a shot
 *
 * Steps:
 * 1. Fetch shot + episode data
 * 2. Download source video to temp
 * 3. Run FFmpeg to extract and crop clip
 * 4. Upload to storage
 * 5. Create shorts record
 */
export const generateShortAction = enhanceAction(
    async (input: GenerateShortInput): Promise<GenerateShortResult> => {
        const logger = await getLogger();
        const ctx = {
            name: 'shorts.generate',
            episodeId: input.episodeId,
            shotId: input.shotId,
        };

        logger.info(ctx, 'Starting short generation');

        const client = getSupabaseServerClient();
        const adminClient = getSupabaseServerAdminClient();
        const { data: user, error: authError } = await requireUser(client);

        if (authError || !user) {
            logger.warn(ctx, 'Unauthorized short generation attempt');
            throw new Error('Authentication required');
        }

        try {
            // 1. Fetch shot data
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const { data: shot, error: shotError } = await (client as any)
                .from('shots')
                .select(
                    `
          id,
          episode_id,
          sequence_number,
          duration_seconds,
          video_url,
          shorts_candidate,
          shorts_metadata
        `,
                )
                .eq('id', input.shotId)
                .eq('episode_id', input.episodeId)
                .single();

            if (shotError || !shot) {
                logger.error({ ...ctx, error: shotError }, 'Shot not found');
                throw new Error('Shot not found');
            }

            const shotData = shot as ShotRow;

            // 2. Fetch episode data
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const { data: episode, error: episodeError } = await (client as any)
                .from('episodes')
                .select(
                    `
          id,
          project_id,
          title,
          final_video_url
        `,
                )
                .eq('id', input.episodeId)
                .single();

            if (episodeError || !episode) {
                logger.error({ ...ctx, error: episodeError }, 'Episode not found');
                throw new Error('Episode not found');
            }

            const episodeData = episode as EpisodeRow;

            // 3. Determine source video
            // Prefer shot's individual video, fallback to episode final video
            const sourceVideoUrl =
                shotData.video_url ?? episodeData.final_video_url;

            if (!sourceVideoUrl) {
                throw new Error(
                    'No source video available. Generate shot video or episode video first.',
                );
            }

            // 4. Calculate clip boundaries
            // For now, use shot duration or overrides
            const startSeconds = input.startSecondsOverride ?? 0;
            const endSeconds =
                input.endSecondsOverride ?? shotData.duration_seconds ?? 8;
            const duration = endSeconds - startSeconds;

            // Validate duration
            if (duration > PLATFORM_SPECS.youtube_shorts.maxDuration) {
                throw new Error(
                    `Clip duration ${duration}s exceeds YouTube Shorts max of ${PLATFORM_SPECS.youtube_shorts.maxDuration}s`,
                );
            }

            // 5. Create shorts record with pending status
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const { data: shortRecord, error: insertError } = await (client as any)
                .from('shorts')
                .insert({
                    episode_id: input.episodeId,
                    source_shot_id: input.shotId,
                    start_seconds: startSeconds,
                    end_seconds: endSeconds,
                    title: input.title,
                    caption: input.caption,
                    hashtags: input.hashtags,
                    viral_score: shotData.shorts_metadata?.viralScore ?? null,
                    hook_type: shotData.shorts_metadata?.hookType ?? null,
                    standalone_summary:
                        shotData.shorts_metadata?.standaloneSummary ?? null,
                    status: 'processing',
                })
                .select()
                .single();

            if (insertError || !shortRecord) {
                logger.error({ ...ctx, error: insertError }, 'Failed to create short');
                throw new Error('Failed to create short record');
            }

            const shortId = shortRecord.id as string;

            try {
                // 6. Download source video
                const tempDir = join(tmpdir(), 'shorts');
                await fs.mkdir(tempDir, { recursive: true });

                const inputPath = join(tempDir, `input_${shortId}.mp4`);
                const outputPath = join(tempDir, `output_${shortId}.mp4`);

                logger.info({ ...ctx, shortId, sourceVideoUrl }, 'Downloading source');

                const response = await fetch(sourceVideoUrl);
                if (!response.ok) {
                    throw new Error(`Failed to download source: ${response.status}`);
                }

                const videoBuffer = Buffer.from(await response.arrayBuffer());
                await fs.writeFile(inputPath, videoBuffer);

                // 7. Run FFmpeg
                logger.info({ ...ctx, shortId }, 'Running FFmpeg vertical crop');

                const ffmpegArgs = buildVerticalCropArgs({
                    inputPath,
                    outputPath,
                    startSeconds,
                    endSeconds,
                    cropMode: (input.cropMode ?? 'center') as CropMode,
                });

                const ffmpegCommand = `ffmpeg ${ffmpegArgs.join(' ')}`;
                await execAsync(ffmpegCommand, { timeout: 120000 }); // 2 min timeout

                // 8. Upload to storage
                const outputBuffer = await fs.readFile(outputPath);
                const storagePath = `shorts/${input.episodeId}/${shortId}.mp4`;

                const { error: uploadError } = await adminClient.storage
                    .from('videos')
                    .upload(storagePath, outputBuffer, {
                        contentType: 'video/mp4',
                        upsert: true,
                    });

                if (uploadError) {
                    throw new Error(`Failed to upload: ${uploadError.message}`);
                }

                // 9. Get public URL
                const { data: urlData } = adminClient.storage
                    .from('videos')
                    .getPublicUrl(storagePath);

                // 10. Update shorts record
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                await (client as any)
                    .from('shorts')
                    .update({
                        video_url_9x16: urlData.publicUrl,
                        status: 'ready',
                    })
                    .eq('id', shortId);

                // 11. Cleanup temp files
                await fs.unlink(inputPath).catch(() => { });
                await fs.unlink(outputPath).catch(() => { });

                logger.info(
                    { ...ctx, shortId, videoUrl: urlData.publicUrl },
                    'Short generated successfully',
                );

                revalidatePath('/home/[account]/studio', 'layout');

                return {
                    success: true,
                    shortId,
                    videoUrl: urlData.publicUrl,
                    durationSeconds: duration,
                };
            } catch (processingError) {
                // Update record with error
                const errorMessage =
                    processingError instanceof Error
                        ? processingError.message
                        : 'Unknown error';

                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                await (client as any)
                    .from('shorts')
                    .update({
                        status: 'failed',
                        processing_error: errorMessage,
                    })
                    .eq('id', shortId);

                throw processingError;
            }
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown error';
            logger.error({ ...ctx, error: message }, 'Short generation failed');
            return { success: false, error: message };
        }
    },
    {
        schema: GenerateShortSchema,
    },
);

// =============================================================================
// Batch Generation
// =============================================================================

const GenerateAllShortsSchema = z.object({
    episodeId: z.string().uuid(),
    minViralScore: z.number().min(1).max(10).optional(),
    cropMode: z.enum(['center', 'blur_bars']).optional(),
});

/**
 * Generate shorts for all candidate shots in an episode
 */
export const generateAllShortsAction = enhanceAction(
    async (
        input: z.infer<typeof GenerateAllShortsSchema>,
    ): Promise<{
        success: boolean;
        generated: number;
        skipped: number;
        errors: string[];
    }> => {
        const logger = await getLogger();
        const ctx = {
            name: 'shorts.generateAll',
            episodeId: input.episodeId,
        };

        logger.info(ctx, 'Starting batch short generation');

        const client = getSupabaseServerClient();
        const { data: user, error: authError } = await requireUser(client);

        if (authError || !user) {
            throw new Error('Authentication required');
        }

        // Fetch all shorts candidates
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data: shots, error: fetchError } = await (client as any)
            .from('shots')
            .select('id, shorts_metadata')
            .eq('episode_id', input.episodeId)
            .eq('shorts_candidate', true);

        if (fetchError) {
            throw new Error(`Failed to fetch shots: ${fetchError.message}`);
        }

        const minScore = input.minViralScore ?? 7;
        const candidates = (shots as ShotRow[]).filter((shot) => {
            const score = shot.shorts_metadata?.viralScore ?? 0;
            return score >= minScore;
        });

        logger.info(
            { ...ctx, candidateCount: candidates.length },
            'Found candidate shots',
        );

        let generated = 0;
        let skipped = 0;
        const errors: string[] = [];

        for (const shot of candidates) {
            try {
                const result = await generateShortAction({
                    episodeId: input.episodeId,
                    shotId: shot.id,
                    cropMode: input.cropMode ?? 'center',
                });

                if (result.success) {
                    generated++;
                } else {
                    errors.push(`Shot ${shot.id}: ${result.error}`);
                }
            } catch (error) {
                const message =
                    error instanceof Error ? error.message : 'Unknown error';
                errors.push(`Shot ${shot.id}: ${message}`);
                skipped++;
            }
        }

        logger.info(
            { ...ctx, generated, skipped, errorCount: errors.length },
            'Batch generation complete',
        );

        return {
            success: errors.length === 0,
            generated,
            skipped,
            errors,
        };
    },
    {
        schema: GenerateAllShortsSchema,
    },
);
