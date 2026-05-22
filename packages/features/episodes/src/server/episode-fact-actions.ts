'use server';

import { z } from 'zod';

import { enhanceAction } from '@kit/next/actions';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

// =============================================================================
// SCHEMAS
// =============================================================================

const LinkFactSchema = z.object({
  episodeId: z.string().uuid(),
  factId: z.string().uuid(),
  sceneReference: z.string().optional(),
});

const UnlinkFactSchema = z.object({
  episodeId: z.string().uuid(),
  factId: z.string().uuid(),
});

const GetEpisodeFactsSchema = z.object({
  episodeId: z.string().uuid(),
});

const GetProjectFactsSchema = z.object({
  projectId: z.string().uuid(),
  search: z.string().optional(),
});

// =============================================================================
// ACTIONS
// =============================================================================

/**
 * Link a verified fact to an episode.
 */
export const linkFactToEpisodeAction = enhanceAction(
  async (data: z.infer<typeof LinkFactSchema>) => {
    const supabase = getSupabaseServerClient();

    const { error } = await supabase.from('episode_facts').insert({
      episode_id: data.episodeId,
      fact_id: data.factId,
      scene_reference: data.sceneReference ?? null,
    });

    if (error) {
      if (error.code === '23505') {
        // Unique constraint violation — already linked
        return { success: true, alreadyLinked: true };
      }
      throw new Error(`Failed to link fact: ${error.message}`);
    }

    return { success: true, alreadyLinked: false };
  },
  {
    auth: true,
    schema: LinkFactSchema,
  },
);

/**
 * Unlink a fact from an episode.
 */
export const unlinkFactFromEpisodeAction = enhanceAction(
  async (data: z.infer<typeof UnlinkFactSchema>) => {
    const supabase = getSupabaseServerClient();

    const { error } = await supabase
      .from('episode_facts')
      .delete()
      .eq('episode_id', data.episodeId)
      .eq('fact_id', data.factId);

    if (error) {
      throw new Error(`Failed to unlink fact: ${error.message}`);
    }

    return { success: true };
  },
  {
    auth: true,
    schema: UnlinkFactSchema,
  },
);

/**
 * Get all facts linked to a specific episode.
 */
export const getEpisodeFactsAction = enhanceAction(
  async (data: z.infer<typeof GetEpisodeFactsSchema>) => {
    const supabase = getSupabaseServerClient();

    const { data: links, error } = await supabase
      .from('episode_facts')
      .select(
        `
                id,
                fact_id,
                scene_reference,
                linked_at,
                verified_facts (
                    id,
                    claim,
                    simplified_claim,
                    source_citation,
                    verification_status,
                    category,
                    source_type
                )
            `,
      )
      .eq('episode_id', data.episodeId)
      .order('linked_at', { ascending: false });

    if (error) {
      throw new Error(`Failed to get episode facts: ${error.message}`);
    }

    return links ?? [];
  },
  {
    auth: true,
    schema: GetEpisodeFactsSchema,
  },
);

/**
 * Get all project facts for the link dialog.
 */
export const getProjectFactsForLinkingAction = enhanceAction(
  async (data: z.infer<typeof GetProjectFactsSchema>) => {
    const supabase = getSupabaseServerClient();

    let query = supabase
      .from('verified_facts')
      .select(
        'id, claim, simplified_claim, source_citation, verification_status, category',
      )
      .eq('project_id', data.projectId)
      .order('created_at', { ascending: false })
      .limit(50);

    if (data.search?.trim()) {
      query = query.ilike('claim', `%${data.search.trim()}%`);
    }

    const { data: facts, error } = await query;

    if (error) {
      throw new Error(`Failed to get project facts: ${error.message}`);
    }

    return facts ?? [];
  },
  {
    auth: true,
    schema: GetProjectFactsSchema,
  },
);
