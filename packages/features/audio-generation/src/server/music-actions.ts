'use server';

import 'server-only';

import { revalidatePath } from 'next/cache';

import { z } from 'zod';

import { enhanceAction } from '@kit/next/actions';
import { getLogger } from '@kit/shared/logger';
import { requireUser } from '@kit/supabase/require-user';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

/**
 * Update an audio track (music/sfx) timing/metadata
 */
export const updateAudioTrackAction = enhanceAction(
  async (data: {
    trackId: string;
    timelineStartSeconds?: number;
    durationSeconds?: number;
    volume?: number;
    prompt?: string;
  }): Promise<{ success: boolean; trackId: string }> => {
    const logger = await getLogger();
    const ctx = {
      name: 'audioTrack.update',
      trackId: data.trackId,
    };

    const client = getSupabaseServerClient();
    const { data: user, error: authError } = await requireUser(client);

    if (authError || !user) {
      throw new Error('Authentication required');
    }

    const updatePayload: Record<string, unknown> = {};
    if (data.timelineStartSeconds !== undefined) {
      updatePayload.timeline_start_seconds = data.timelineStartSeconds;
    }
    if (data.durationSeconds !== undefined) {
      updatePayload.duration_seconds = data.durationSeconds;
    }
    if (data.volume !== undefined) {
      updatePayload.volume = data.volume;
    }

    if (data.prompt !== undefined) {
      // Fetch existing metadata first to merge
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: track } = await (client as any)
        .from('audio_tracks')
        .select('metadata')
        .eq('id', data.trackId)
        .single();

      updatePayload.metadata = {
        ...(track?.metadata || {}),
        prompt: data.prompt,
      };
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: updateError } = await (client as any)
      .from('audio_tracks')
      .update(updatePayload)
      .eq('id', data.trackId);

    if (updateError) {
      logger.error(
        { ...ctx, error: updateError },
        'Failed to update audio track',
      );
      throw new Error('Failed to update audio track');
    }

    revalidatePath('/home/[account]/studio/[projectId]/episodes', 'page');
    return { success: true, trackId: data.trackId };
  },
  {
    schema: z.object({
      trackId: z.string().uuid(),
      timelineStartSeconds: z.number().min(0).optional(),
      durationSeconds: z.number().positive().optional(),
      volume: z.number().min(0).max(1).optional(),
      prompt: z.string().min(1).optional(),
    }),
  },
);
