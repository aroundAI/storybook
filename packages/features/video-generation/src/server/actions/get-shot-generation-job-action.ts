'use server';

import 'server-only';

import { z } from 'zod';

import { enhanceAction } from '@kit/next/actions';
import { requireUser } from '@kit/supabase/require-user';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

const GetShotGenerationJobSchema = z.object({
  shotId: z.string().uuid(),
});

/**
 * Get the most recent generation job for a shot.
 * Returns the job ID and basic status info for polling.
 */
export const getShotGenerationJobAction = enhanceAction(
  async (data) => {
    const client = getSupabaseServerClient();
    const { error: authError } = await requireUser(client);

    if (authError) {
      throw new Error('Authentication required');
    }

    // Type assertion required: The Supabase client's generated types don't include
    // the generation_jobs table yet. RLS policies enforce authorization at the DB level.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: job, error } = await (client as any)
      .from('generation_jobs')
      .select('id, status, created_at')
      .eq('reference_id', data.shotId)
      .eq('reference_type', 'shot')
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (error || !job) {
      return null;
    }

    return {
      id: job.id as string,
      status: job.status as string,
      createdAt: job.created_at as string,
    };
  },
  {
    schema: GetShotGenerationJobSchema,
  },
);
