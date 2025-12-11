'use server';

import 'server-only';

import { revalidatePath } from 'next/cache';

import { z } from 'zod';

import { enhanceAction } from '@kit/next/actions';
import { canPerformProjectAction } from '@kit/projects/queries';
import { getLogger } from '@kit/shared/logger';
import type { Json } from '@kit/supabase/database';
import { requireUser } from '@kit/supabase/require-user';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

import {
  type AudioTrackInput,
  type AutoStitchOutput,
  type DialogueLineInput,
  type GapFillStrategy,
  type ShotInput,
  autoStitch,
  fillGaps,
} from '../lib/auto-stitch';

/**
 * Schema for auto-stitch action input
 */
const AutoStitchActionSchema = z.object({
  episodeId: z.string().uuid(),
  mode: z
    .enum(['full', 'shots-only', 'audio-only', 'incremental'])
    .default('full'),
  gapFillStrategy: z
    .enum(['extend', 'black', 'loop', 'ignore'])
    .default('ignore'),
  options: z
    .object({
      dialogueOffsetSeconds: z.number().min(0).max(5).optional(),
      musicVolume: z.number().min(0).max(1).optional(),
      musicFadeInSeconds: z.number().min(0).max(10).optional(),
      musicFadeOutSeconds: z.number().min(0).max(10).optional(),
      gapThresholdSeconds: z.number().min(0).max(1).optional(),
      defaultDialogueDurationSeconds: z.number().min(1).max(30).optional(),
      fps: z.number().min(24).max(60).optional(),
    })
    .optional(),
});

export type AutoStitchActionInput = z.infer<typeof AutoStitchActionSchema>;

export interface AutoStitchActionResult {
  success: boolean;
  data?: AutoStitchOutput;
  error?: string;
}

/**
 * Auto-stitch server action
 *
 * Fetches episode data, runs auto-stitch algorithm, and saves timeline to episode metadata.
 * Non-destructive: timeline is stored in episode.metadata and can be replaced/undone.
 */
export const autoStitchAction = enhanceAction(
  async (input): Promise<AutoStitchActionResult> => {
    const logger = await getLogger();
    const ctx = {
      name: 'auto-stitch',
      episodeId: input.episodeId,
      mode: input.mode,
    };

    logger.info(ctx, 'Starting auto-stitch operation');

    const client = getSupabaseServerClient();
    const { data: user, error: authError } = await requireUser(client);

    if (authError || !user) {
      logger.warn(ctx, 'Unauthorized auto-stitch attempt');
      throw new Error('Authentication required');
    }

    try {
      // Fetch all required data in parallel
      const [
        { data: shots, error: shotsError },
        { data: dialogueLines, error: dialogueError },
        { data: audioTracks, error: audioError },
        { data: episode, error: episodeError },
      ] = await Promise.all([
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (client as any)
          .from('shots')
          .select('*')
          .eq('episode_id', input.episodeId)
          .is('deleted_at', null)
          .order('sequence_number', { ascending: true }),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (client as any)
          .from('dialogue_lines')
          .select('*')
          .eq('episode_id', input.episodeId)
          .order('sequence_number', { ascending: true }),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (client as any)
          .from('audio_tracks')
          .select('*')
          .eq('episode_id', input.episodeId),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (client as any)
          .from('episodes')
          .select('id, metadata, project_id')
          .eq('id', input.episodeId)
          .is('deleted_at', null)
          .single(),
      ]);

      // Handle errors
      if (shotsError || dialogueError || audioError || episodeError) {
        const error = shotsError || dialogueError || audioError || episodeError;
        logger.error({ ...ctx, error }, 'Failed to fetch episode data');
        throw new Error(`Failed to fetch episode data: ${error?.message}`);
      }

      if (!episode) {
        throw new Error('Episode not found');
      }

      // Verify user has permission to edit this project (defense-in-depth)
      const canEdit = await canPerformProjectAction(
        episode.project_id,
        'project.edit',
      );

      if (!canEdit) {
        logger.warn(
          { ...ctx, projectId: episode.project_id },
          'Unauthorized auto-stitch attempt - insufficient project permissions',
        );
        throw new Error('Insufficient permissions to modify this episode');
      }

      // Run auto-stitch algorithm
      let result = autoStitch({
        shots: (shots ?? []) as ShotInput[],
        dialogueLines: (dialogueLines ?? []) as DialogueLineInput[],
        audioTracks: (audioTracks ?? []) as AudioTrackInput[],
        mode: input.mode,
        options: input.options,
      });

      // Apply gap fill strategy if requested
      if (input.gapFillStrategy !== 'ignore' && result.gaps.length > 0) {
        const filledTimeline = fillGaps(
          result.timeline,
          result.gaps,
          input.gapFillStrategy as GapFillStrategy,
        );
        result = { ...result, timeline: filledTimeline };
      }

      // Save timeline to episode metadata (non-destructive - stored alongside existing data)
      const existingMetadata =
        (episode.metadata as Record<string, unknown>) ?? {};
      const updatedMetadata: Record<string, unknown> = {
        ...existingMetadata,
        timeline: result.timeline,
        autoStitch: {
          stitchedAt: new Date().toISOString(),
          mode: input.mode,
          statistics: result.statistics,
          warningCount: result.warnings.length,
        },
      };

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error: updateError } = await (client as any)
        .from('episodes')
        .update({
          metadata: updatedMetadata as Json,
          updated_at: new Date().toISOString(),
        })
        .eq('id', input.episodeId);

      if (updateError) {
        logger.error({ ...ctx, error: updateError }, 'Failed to save timeline');
        throw new Error(`Failed to save timeline: ${updateError.message}`);
      }

      logger.info(
        {
          ...ctx,
          statistics: result.statistics,
          warningCount: result.warnings.length,
        },
        'Auto-stitch completed successfully',
      );

      revalidatePath('/home/[account]/studio/[projectId]/episodes', 'page');

      return { success: true, data: result };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      logger.error({ ...ctx, error: message }, 'Auto-stitch failed');
      return { success: false, error: message };
    }
  },
  {
    schema: AutoStitchActionSchema,
  },
);
