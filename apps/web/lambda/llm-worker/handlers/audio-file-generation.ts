/**
 * Audio File Generation Handler
 *
 * Processes audio generation jobs for cues (music, SFX, ambient).
 * Called from LLM Worker Lambda via SQS queue.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

import { z } from 'zod';

import {
    markJobCompleted,
    markJobFailed,
    markJobProcessing,
} from '../utils/job-tracking';

const AudioFileGenerationPayloadSchema = z.object({
    cueId: z.string().uuid(),
    projectId: z.string().uuid(),
    episodeId: z.string().uuid(),
    cueType: z.enum(['sfx', 'ambient', 'music']),
    prompt: z.string(),
    durationSeconds: z.number(),
    startOffsetSeconds: z.number(),
});

/**
 * Get decrypted ElevenLabs API key for a project
 * Note: decrypt is imported here in Lambda context where server-only works
 */
async function getProjectElevenLabsApiKey(
    supabase: SupabaseClient,
    projectId: string,
): Promise<string> {
    const { decrypt } = await import('@kit/shared/crypto');

    const { data, error } = await supabase
        .from('project_audio_settings')
        .select('elevenlabs_api_key_encrypted')
        .eq('project_id', projectId)
        .single();

    if (error || !data?.elevenlabs_api_key_encrypted) {
        throw new Error('ElevenLabs API key not configured for this project');
    }

    return decrypt(data.elevenlabs_api_key_encrypted);
}

export async function processAudioFileGeneration(
    payload: Record<string, unknown>,
    supabase: SupabaseClient,
): Promise<{ success: boolean; assetId?: string; cueId: string }> {
    const data = AudioFileGenerationPayloadSchema.parse(payload);

    console.log(
        `[Audio File Gen] Processing cue ${data.cueId} (${data.cueType})`,
    );
    await markJobProcessing(supabase, data.cueId, 'audio_file_generation');

    try {
        // Fetch API key first - decrypt happens here in Lambda context
        const apiKey = await getProjectElevenLabsApiKey(supabase, data.projectId);

        let result: {
            assetId: string;
            status: string;
            fileUrl?: string;
            error?: string;
        };

        if (data.cueType === 'music') {
            // Import and call ElevenLabs music generation
            const { generateMusicElevenLabsCore } = await import(
                '@kit/audio-generation/server-core'
            );

            const coreResult = await generateMusicElevenLabsCore({
                supabase,
                projectId: data.projectId,
                episodeId: data.episodeId,
                prompt: data.prompt,
                durationSeconds: Math.min(data.durationSeconds, 300),
                timelineStartSeconds: data.startOffsetSeconds,
                apiKey,
            });

            result = {
                assetId: coreResult.assetId,
                status: coreResult.status,
                fileUrl: coreResult.fileUrl,
                error: coreResult.error,
            };
        } else {
            // SFX/Ambient generation
            const { generateSfxCore } = await import(
                '@kit/audio-generation/server-core'
            );

            const coreResult = await generateSfxCore({
                supabase,
                projectId: data.projectId,
                episodeId: data.episodeId,
                prompt: data.prompt,
                durationSeconds: Math.min(data.durationSeconds, 22),
                timelineStartSeconds: data.startOffsetSeconds,
                apiKey,
            });

            result = {
                assetId: coreResult.assetId,
                status: coreResult.status,
                fileUrl: coreResult.fileUrl,
                error: coreResult.error,
            };
        }

        if (result.status === 'completed' || result.status === 'reused') {
            // Update cue with asset reference
            await supabase
                .from('audio_cues')
                .update({ audio_asset_id: result.assetId, status: 'placed' })
                .eq('id', data.cueId);

            await markJobCompleted(supabase, data.cueId, 'audio_file_generation', {
                assetId: result.assetId,
                fileUrl: result.fileUrl,
            });

            console.log(
                `[Audio File Gen] Cue ${data.cueId} completed with asset ${result.assetId}`,
            );

            return { success: true, assetId: result.assetId, cueId: data.cueId };
        } else {
            await supabase
                .from('audio_cues')
                .update({ status: 'failed' })
                .eq('id', data.cueId);

            await markJobFailed(
                supabase,
                data.cueId,
                'audio_file_generation',
                result.error ?? 'Generation failed',
            );

            console.error(
                `[Audio File Gen] Cue ${data.cueId} failed: ${result.error}`,
            );

            return { success: false, cueId: data.cueId };
        }
    } catch (error) {
        const errorMsg = error instanceof Error ? error.message : 'Unknown error';

        await supabase
            .from('audio_cues')
            .update({ status: 'failed' })
            .eq('id', data.cueId);

        await markJobFailed(
            supabase,
            data.cueId,
            'audio_file_generation',
            errorMsg,
        );

        console.error(`[Audio File Gen] Cue ${data.cueId} error:`, error);

        throw error;
    }
}
