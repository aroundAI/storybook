/**
 * Audio Cue Actions
 * 
 * Process audioCues from screenplay scenes into audio_cues table
 * and trigger generation for SFX/ambient, display prompts for music.
 */

'use server';

import { enhanceAction } from '@kit/next/actions';
import { getSupabaseServerClient } from '@kit/supabase/server-client';
import { z } from 'zod';

import { generateSfxAction } from './sfx-actions';
import { generateMusicElevenLabsAction } from './elevenlabs-music-actions';

// =============================================================================
// Schemas
// =============================================================================

const AudioCueSchema = z.object({
    type: z.enum(['sfx', 'ambient', 'music']),
    prompt: z.string().min(1),
    startOffset: z.number().min(0),
    duration: z.number().min(0.1),
    isLoopable: z.boolean().optional(),
});

const ProcessAudioCuesSchema = z.object({
    episodeId: z.string().uuid(),
    projectId: z.string().uuid(),
    sceneNumber: z.number().int().positive(),
    sceneStartSeconds: z.number().min(0).optional().default(0),
    audioCues: z.array(AudioCueSchema),
    autoGenerate: z.boolean().optional().default(false),
});

// =============================================================================
// Types
// =============================================================================

interface ProcessedCue {
    cueId: string;
    type: 'sfx' | 'ambient' | 'music';
    prompt: string;
    status: 'pending' | 'matched' | 'generating' | 'placed' | 'failed';
    audioAssetId?: string;
    error?: string;
}

// =============================================================================
// Actions
// =============================================================================

/**
 * Process audio cues from a screenplay scene
 * 
 * 1. Saves audioCues to audio_cues table
 * 2. Checks for matching assets in library
 * 3. Optionally triggers generation for new assets
 */
export const processAudioCuesAction = enhanceAction(
    async (data): Promise<{ cues: ProcessedCue[]; matched: number; pending: number }> => {
        const client = getSupabaseServerClient();
        const results: ProcessedCue[] = [];
        let matchedCount = 0;
        let pendingCount = 0;

        for (const cue of data.audioCues) {
            // Calculate absolute timeline position
            const absoluteStart = data.sceneStartSeconds + cue.startOffset;

            // 1. Insert audio cue into database
            const { data: insertedCue, error: insertError } = await client
                .from('audio_cues')
                .insert({
                    episode_id: data.episodeId,
                    scene_number: data.sceneNumber,
                    cue_type: cue.type,
                    prompt: cue.prompt,
                    start_offset_seconds: absoluteStart,
                    duration_seconds: cue.duration,
                    is_loopable: cue.isLoopable ?? cue.type === 'ambient',
                    status: 'pending',
                })
                .select('id')
                .single();

            if (insertError || !insertedCue) {
                results.push({
                    cueId: '',
                    type: cue.type,
                    prompt: cue.prompt,
                    status: 'failed',
                    error: insertError?.message ?? 'Failed to insert cue',
                });
                continue;
            }

            // 2. Check for similar existing asset (exact prompt match)
            const normalizedPrompt = cue.prompt.toLowerCase().trim();
            const promptHash = Buffer.from(normalizedPrompt).toString('base64').substring(0, 32);

            const { data: existingAsset } = await client
                .from('audio_assets')
                .select('id, file_url, status')
                .eq('project_id', data.projectId)
                .eq('prompt_hash', promptHash)
                .eq('status', 'completed')
                .single();

            if (existingAsset?.file_url) {
                // Match found - link to existing asset
                await client
                    .from('audio_cues')
                    .update({
                        audio_asset_id: existingAsset.id,
                        status: 'matched',
                    })
                    .eq('id', insertedCue.id);

                results.push({
                    cueId: insertedCue.id,
                    type: cue.type,
                    prompt: cue.prompt,
                    status: 'matched',
                    audioAssetId: existingAsset.id,
                });
                matchedCount++;
                continue;
            }

            // 3. No match - handle based on type and autoGenerate flag
            if (data.autoGenerate && (cue.type === 'sfx' || cue.type === 'ambient')) {
                // Auto-generate SFX and ambient sounds
                try {
                    const genResult = await generateSfxAction({
                        projectId: data.projectId,
                        episodeId: data.episodeId,
                        prompt: cue.prompt,
                        durationSeconds: Math.min(cue.duration, 22), // SFX API max is 22s
                        timelineStartSeconds: absoluteStart,
                    });

                    if (genResult.status === 'completed' || genResult.status === 'reused') {
                        await client
                            .from('audio_cues')
                            .update({
                                audio_asset_id: genResult.assetId,
                                status: 'placed',
                            })
                            .eq('id', insertedCue.id);

                        results.push({
                            cueId: insertedCue.id,
                            type: cue.type,
                            prompt: cue.prompt,
                            status: 'placed',
                            audioAssetId: genResult.assetId,
                        });
                    } else {
                        results.push({
                            cueId: insertedCue.id,
                            type: cue.type,
                            prompt: cue.prompt,
                            status: 'failed',
                            error: genResult.error,
                        });
                    }
                } catch (error) {
                    results.push({
                        cueId: insertedCue.id,
                        type: cue.type,
                        prompt: cue.prompt,
                        status: 'failed',
                        error: error instanceof Error ? error.message : 'Generation failed',
                    });
                }
            } else {
                // Music or non-auto: leave as pending for user review
                results.push({
                    cueId: insertedCue.id,
                    type: cue.type,
                    prompt: cue.prompt,
                    status: 'pending',
                });
                pendingCount++;
            }
        }

        return {
            cues: results,
            matched: matchedCount,
            pending: pendingCount,
        };
    },
    { schema: ProcessAudioCuesSchema }
);

/**
 * Generate audio for a specific cue
 * Used when user clicks "Generate" on a pending cue
 */
export const generateAudioForCueAction = enhanceAction(
    async (data): Promise<{ success: boolean; assetId?: string; error?: string }> => {
        const client = getSupabaseServerClient();

        // Get cue details
        const { data: cue, error: cueError } = await client
            .from('audio_cues')
            .select(`
                id, episode_id, scene_number, cue_type, prompt,
                start_offset_seconds, duration_seconds, is_loopable, status,
                audio_asset_id, audio_track_id, created_at,
                episodes!inner(season_id, seasons!inner(project_id))
            `)
            .eq('id', data.cueId)
            .single();

        if (cueError || !cue) {
            return { success: false, error: cueError?.message ?? 'Cue not found' };
        }

        // Extract project_id from the nested join
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const projectId = (cue.episodes as any)?.seasons?.project_id;
        if (!projectId) {
            return { success: false, error: 'Could not determine project ID' };
        }

        try {
            let result: { assetId: string; status: string; error?: string };

            if (cue.cue_type === 'music') {
                // Use music generation
                result = await generateMusicElevenLabsAction({
                    projectId,
                    episodeId: cue.episode_id,
                    prompt: cue.prompt,
                    durationSeconds: Math.min(cue.duration_seconds ?? 60, 300),
                    timelineStartSeconds: cue.start_offset_seconds ?? 0,
                });
            } else {
                // Use SFX generation for sfx and ambient
                result = await generateSfxAction({
                    projectId,
                    episodeId: cue.episode_id,
                    prompt: cue.prompt,
                    durationSeconds: Math.min(cue.duration_seconds ?? 5, 22),
                    timelineStartSeconds: cue.start_offset_seconds ?? 0,
                });
            }

            if (result.status === 'completed' || result.status === 'reused') {
                // Update cue with asset reference
                await client
                    .from('audio_cues')
                    .update({
                        audio_asset_id: result.assetId,
                        status: 'placed',
                    })
                    .eq('id', data.cueId);

                return { success: true, assetId: result.assetId };
            } else {
                await client
                    .from('audio_cues')
                    .update({ status: 'failed' })
                    .eq('id', data.cueId);

                return { success: false, error: result.error ?? 'Generation failed' };
            }
        } catch (error) {
            await client
                .from('audio_cues')
                .update({ status: 'failed' })
                .eq('id', data.cueId);

            return {
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error',
            };
        }
    },
    {
        schema: z.object({
            cueId: z.string().uuid(),
        }),
    }
);

/**
 * Get audio cues for an episode
 */
export const getAudioCuesAction = enhanceAction(
    async (data) => {
        const client = getSupabaseServerClient();

        const { data: cues, error } = await client
            .from('audio_cues')
            .select(`
                id,
                episode_id,
                scene_number,
                cue_type,
                prompt,
                start_offset_seconds,
                duration_seconds,
                is_loopable,
                status,
                audio_asset_id,
                audio_track_id,
                audio_assets (
                    id,
                    name,
                    file_url,
                    duration_seconds,
                    tags
                )
            `)
            .eq('episode_id', data.episodeId)
            .order('scene_number')
            .order('start_offset_seconds');

        if (error) {
            throw new Error(`Failed to fetch audio cues: ${error.message}`);
        }

        return { cues: cues ?? [] };
    },
    {
        schema: z.object({
            episodeId: z.string().uuid(),
        }),
    }
);
