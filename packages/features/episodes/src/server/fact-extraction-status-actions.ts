'use server';

import { z } from 'zod';

import { enhanceAction } from '@kit/next/actions';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

const CreateJobSchema = z.object({
  projectId: z.string().uuid(),
  sourceTitle: z.string().min(1),
  chunkCount: z.number().int().min(1),
});

const GetStatusSchema = z.object({
  projectId: z.string().uuid(),
});

interface ExtractionJob {
  id: string;
  source_title: string;
  chunk_count: number;
  chunks_completed: number;
  status: string;
  facts_extracted: number;
  created_at: string;
}

/**
 * Create a tracking record for a fact extraction job.
 *
 * NOTE: Uses raw SQL because `fact_extraction_jobs` table is not yet
 * in generated Supabase types. Remove and use typed `.from()` after
 * running `pnpm supabase:web:typegen`.
 */
export const createExtractionJobAction = enhanceAction(
  async (data: z.infer<typeof CreateJobSchema>) => {
    const supabase = getSupabaseServerClient();

    const { data: result, error } = await supabase.rpc(
      'create_extraction_job' as never,
      {
        p_project_id: data.projectId,
        p_source_title: data.sourceTitle,
        p_chunk_count: data.chunkCount,
      } as never,
    );

    if (error) {
      // Fallback: direct insert if RPC doesn't exist
      const { data: inserted, error: insertError } = await supabase
        .from('fact_extraction_jobs' as never)
        .insert({
          project_id: data.projectId,
          source_title: data.sourceTitle,
          chunk_count: data.chunkCount,
          status: 'pending',
        } as never)
        .select('id')
        .single();

      if (insertError) {
        throw new Error(
          `Failed to create extraction job: ${insertError.message}`,
        );
      }

      return { jobId: (inserted as unknown as { id: string }).id };
    }

    return { jobId: (result as unknown as string) ?? '' };
  },
  {
    auth: true,
    schema: CreateJobSchema,
  },
);

/**
 * Get active (pending/processing) extraction jobs for a project.
 *
 * NOTE: Uses `as never` cast because `fact_extraction_jobs` table is not yet
 * in generated Supabase types. Remove after running `pnpm supabase:web:typegen`.
 */
export const getExtractionStatusAction = enhanceAction(
  async (data: z.infer<typeof GetStatusSchema>) => {
    const supabase = getSupabaseServerClient();

    const { data: jobs, error } = await supabase
      .from('fact_extraction_jobs' as never)
      .select(
        'id, source_title, chunk_count, chunks_completed, status, facts_extracted, created_at',
      )
      .eq('project_id' as never, data.projectId)
      .in('status' as never, ['pending', 'processing'])
      .order('created_at' as never, { ascending: false })
      .limit(10);

    if (error) {
      throw new Error(`Failed to fetch extraction status: ${error.message}`);
    }

    return { jobs: (jobs ?? []) as unknown as ExtractionJob[] };
  },
  {
    auth: true,
    schema: GetStatusSchema,
  },
);
