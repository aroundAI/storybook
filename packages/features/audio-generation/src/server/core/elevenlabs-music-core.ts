/**
 * ElevenLabs Music Core
 *
 * Core music generation logic without server action wrapper.
 * Used by LLM Worker Lambda for async processing.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

import { getLogger } from '@kit/shared/logger';

import { ElevenLabsMusicProvider } from '../../providers/elevenlabs-music';
import {
    findOrCreateAudioAssetCore,
    updateAudioAssetCore,
} from './audio-asset-core';

// =============================================================================
// Types
// =============================================================================

export interface GenerateMusicCoreInput {
    supabase: SupabaseClient;
    projectId: string;
    episodeId?: string;
    sceneNumber?: number;
    prompt: string;
    name?: string;
    durationSeconds?: number;
    genre?: string;
    mood?: string;
    tempo?: 'slow' | 'medium' | 'fast' | 'varied';
    timelineStartSeconds?: number;
    /** ElevenLabs API key (decrypted) - passed from handler to avoid server-only import */
    apiKey: string;
}

export interface GenerateMusicCoreResult {
    assetId: string;
    prompt: string;
    status: 'completed' | 'failed' | 'reused';
    fileUrl?: string;
    duration?: number;
    error?: string;
    wasReused: boolean;
}

// =============================================================================
// Helpers
// =============================================================================

async function uploadAudioToStorage(
    supabase: SupabaseClient,
    projectId: string,
    assetId: string,
    audioBuffer: Buffer,
): Promise<{ url: string; path: string }> {
    const { getStorageAdapter } = await import('@kit/storage');

    const fileName = `${assetId}.mp3`;
    const storagePath = `${projectId}/music/${fileName}`;
    const storage = getStorageAdapter(supabase);

    const { url } = await storage.upload('audio', storagePath, audioBuffer, {
        contentType: 'audio/mpeg',
        upsert: true,
    });

    return { url, path: storagePath };
}

// =============================================================================
// Core Function
// =============================================================================

/**
 * Generate music using ElevenLabs (core logic)
 * Called directly from LLM Worker Lambda without server action wrapper
 */
export async function generateMusicElevenLabsCore(
    input: GenerateMusicCoreInput,
): Promise<GenerateMusicCoreResult> {
    const logger = await getLogger();
    const ctx = {
        name: 'music.generateElevenLabsCore',
        projectId: input.projectId,
        prompt: input.prompt.substring(0, 50),
    };

    logger.info(ctx, 'Starting music generation with ElevenLabs (core)');

    const durationSeconds = input.durationSeconds ?? 60;

    // 1. Check if asset exists (deduplication)
    const { asset, isNew } = await findOrCreateAudioAssetCore({
        supabase: input.supabase,
        projectId: input.projectId,
        audioType: 'music',
        prompt: input.prompt,
        name: input.name,
        provider: 'elevenlabs',
        metadata: {
            durationSeconds,
            genre: input.genre,
            mood: input.mood,
            tempo: input.tempo,
            sceneNumber: input.sceneNumber,
            episodeId: input.episodeId,
            timelineStartSeconds: input.timelineStartSeconds,
        },
    });

    // If asset already exists and is completed, return it
    if (!isNew && asset.status === 'completed' && asset.fileUrl) {
        logger.info({ ...ctx, assetId: asset.id }, 'Reusing existing music asset');

        return {
            assetId: asset.id,
            prompt: input.prompt,
            status: 'reused',
            fileUrl: asset.fileUrl,
            duration: asset.durationSeconds ?? undefined,
            wasReused: true,
        };
    }

    // 2. Generate new music
    logger.info({ ...ctx, assetId: asset.id }, 'Generating new music');

    try {
        // Update status to processing
        await updateAudioAssetCore({
            supabase: input.supabase,
            assetId: asset.id,
            status: 'processing',
        });

        // Use API key passed from handler
        const provider = new ElevenLabsMusicProvider({ apiKey: input.apiKey });

        // Generate music
        const result = await provider.generateMusic({
            prompt: input.prompt,
            duration: durationSeconds,
            genre: input.genre,
            mood: input.mood,
            tempo: input.tempo,
        });

        // @ts-expect-error - audioBuffer is added to extended response
        const audioBuffer = result.audioBuffer as Buffer | undefined;

        if (result.status === 'failed' || !audioBuffer) {
            await updateAudioAssetCore({
                supabase: input.supabase,
                assetId: asset.id,
                status: 'failed',
                metadata: { error: 'No audio buffer returned' },
            });

            return {
                assetId: asset.id,
                prompt: input.prompt,
                status: 'failed',
                error: 'No audio buffer returned',
                wasReused: false,
            };
        }

        // 3. Upload to storage
        const { url, path } = await uploadAudioToStorage(
            input.supabase,
            input.projectId,
            asset.id,
            audioBuffer,
        );

        // 4. Update asset with completed status
        await updateAudioAssetCore({
            supabase: input.supabase,
            assetId: asset.id,
            status: 'completed',
            fileUrl: url,
            filePath: path,
            durationSeconds,
            fileSizeBytes: audioBuffer.length,
            providerJobId: result.jobId,
        });

        logger.info(
            { ...ctx, assetId: asset.id, fileUrl: url },
            'Music generation completed (core)',
        );

        // 5. If episodeId provided, create audio_track entry
        if (input.episodeId) {
            const timelineStart = input.timelineStartSeconds ?? 0;

            await input.supabase.from('audio_tracks').insert({
                episode_id: input.episodeId,
                type: 'music',
                name: input.name ?? `Music - ${input.genre ?? 'Background'}`,
                file_url: url,
                duration_seconds: durationSeconds,
                timeline_start_seconds: timelineStart,
                volume: 0.5,
                metadata: {
                    audio_asset_id: asset.id,
                    prompt: input.prompt,
                    genre: input.genre,
                    mood: input.mood,
                    sceneNumber: input.sceneNumber,
                },
            });
        }

        return {
            assetId: asset.id,
            prompt: input.prompt,
            status: 'completed',
            fileUrl: url,
            duration: durationSeconds,
            wasReused: false,
        };
    } catch (error) {
        logger.error({ ...ctx, error }, 'Music generation failed (core)');

        await updateAudioAssetCore({
            supabase: input.supabase,
            assetId: asset.id,
            status: 'failed',
            metadata: {
                error: error instanceof Error ? error.message : 'Unknown error',
            },
        });

        return {
            assetId: asset.id,
            prompt: input.prompt,
            status: 'failed',
            error: error instanceof Error ? error.message : 'Unknown error',
            wasReused: false,
        };
    }
}
