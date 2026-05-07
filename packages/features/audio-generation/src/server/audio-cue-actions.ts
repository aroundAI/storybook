/**
 * Audio Cue Actions
 *
 * Process audioCues from screenplay scenes into audio_cues table
 * and trigger generation for SFX/ambient, display prompts for music.
 */

'use server';

import { z } from 'zod';

import { enhanceAction } from '@kit/next/actions';
import { requireUser } from '@kit/supabase/require-user';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

import { generateSfxAction } from './sfx-actions';

/**
 * Audio Cue Actions
 *
 * Process audioCues from screenplay scenes into audio_cues table
 * and trigger generation for SFX/ambient, display prompts for music.
 */

/**
 * Audio Cue Actions
 *
 * Process audioCues from screenplay scenes into audio_cues table
 * and trigger generation for SFX/ambient, display prompts for music.
 */

/**
 * Audio Cue Actions
 *
 * Process audioCues from screenplay scenes into audio_cues table
 * and trigger generation for SFX/ambient, display prompts for music.
 */

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
  async (
    data,
  ): Promise<{ cues: ProcessedCue[]; matched: number; pending: number }> => {
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
      const promptHash = Buffer.from(normalizedPrompt)
        .toString('base64')
        .substring(0, 32);

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

          if (
            genResult.status === 'completed' ||
            genResult.status === 'reused'
          ) {
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
  { schema: ProcessAudioCuesSchema },
);

/**
 * Generate audio for a specific cue (ASYNC)
 *
 * Enqueues an LLM job for background processing.
 * Results are delivered via WebSocket when complete.
 *
 * Used when user clicks "Generate" on a pending cue
 */
export const generateAudioForCueAction = enhanceAction(
  async (
    data,
  ): Promise<{
    success: boolean;
    status: 'queued' | 'failed';
    error?: string;
  }> => {
    const client = getSupabaseServerClient();
    const { data: user, error: authError } = await requireUser(client);

    if (authError || !user) {
      return {
        success: false,
        status: 'failed',
        error: 'Authentication required',
      };
    }

    // Get cue details
    const { data: cue, error: cueError } = await client
      .from('audio_cues')
      .select(
        `
                id, episode_id, scene_number, cue_type, prompt,
                start_offset_seconds, duration_seconds, is_loopable, status,
                audio_asset_id, audio_track_id, created_at,
                episodes!inner(season_id, seasons!inner(project_id))
            `,
      )
      .eq('id', data.cueId)
      .single();

    if (cueError || !cue) {
      return {
        success: false,
        status: 'failed',
        error: cueError?.message ?? 'Cue not found',
      };
    }

    // Extract project_id from the nested join
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const projectId = (cue.episodes as any)?.seasons?.project_id;
    if (!projectId) {
      return {
        success: false,
        status: 'failed',
        error: 'Could not determine project ID',
      };
    }

    try {
      // 1. Update cue status to 'generating'
      await client
        .from('audio_cues')
        .update({ status: 'generating' })
        .eq('id', data.cueId);

      // 2. Enqueue LLM job for background processing
      const { queueLlmJob } = await import('@kit/prompt-engine/server');

      await queueLlmJob({
        jobType: 'audio-file-generation',
        userId: user.id,
        payload: {
          cueId: data.cueId,
          projectId,
          episodeId: cue.episode_id,
          cueType: cue.cue_type,
          prompt: cue.prompt,
          durationSeconds: cue.duration_seconds ?? 60,
          startOffsetSeconds: cue.start_offset_seconds ?? 0,
        },
      });

      // 3. Return immediately - result comes via WebSocket
      return { success: true, status: 'queued' };
    } catch (error) {
      // Revert status on enqueue failure
      await client
        .from('audio_cues')
        .update({ status: 'pending' })
        .eq('id', data.cueId);

      return {
        success: false,
        status: 'failed',
        error:
          error instanceof Error ? error.message : 'Failed to queue generation',
      };
    }
  },
  {
    schema: z.object({
      cueId: z.string().uuid(),
    }),
  },
);

/**
 * Get audio cues for an episode
 */
export const getAudioCuesAction = enhanceAction(
  async (data) => {
    const client = getSupabaseServerClient();

    const { data: cues, error } = await client
      .from('audio_cues')
      .select(
        `
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
            `,
      )
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
  },
);

/**
 * Update audio cue details
 */
export const updateAudioCueAction = enhanceAction(
  async (data) => {
    const client = getSupabaseServerClient();

    const updateData: Record<string, unknown> = {};
    if (data.prompt !== undefined) updateData.prompt = data.prompt;
    if (data.startOffset !== undefined)
      updateData.start_offset_seconds = data.startOffset;
    if (data.duration !== undefined)
      updateData.duration_seconds = data.duration;

    const { error } = await client
      .from('audio_cues')
      .update(updateData)
      .eq('id', data.cueId);

    if (error) {
      throw new Error(`Failed to update audio cue: ${error.message}`);
    }

    return { success: true };
  },
  {
    schema: z.object({
      cueId: z.string().uuid(),
      prompt: z.string().min(1).optional(),
      startOffset: z.number().min(0).optional(),
      duration: z.number().min(0.1).optional(),
    }),
  },
);
