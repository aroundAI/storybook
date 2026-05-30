'use server';

import { z } from 'zod';

import { enhanceAction } from '@kit/next/actions';
import { getLogger } from '@kit/shared/logger';
import { requireUser } from '@kit/supabase/require-user';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

// =============================================================================
// SCHEMAS
// =============================================================================

const LinkFactsToEpisodeSchema = z.object({
  episodeId: z.string().uuid(),
  factIds: z.array(z.string().uuid()).min(1).max(50),
});

const UnlinkFactFromEpisodeSchema = z.object({
  episodeId: z.string().uuid(),
  factId: z.string().uuid(),
});

const GetEpisodeFactsSchema = z.object({
  episodeId: z.string().uuid(),
});

// =============================================================================
// ACTIONS
// =============================================================================

/**
 * Links multiple facts to an episode via the episode_facts junction table.
 * Uses upsert to gracefully handle facts that are already linked.
 */
export const linkFactsToEpisodeAction = enhanceAction(
  async (data: z.infer<typeof LinkFactsToEpisodeSchema>) => {
    const logger = await getLogger();
    const ctx = { name: 'episodes.linkFactsToEpisode' };

    const client = getSupabaseServerClient();
    const { data: user, error: authError } = await requireUser(client);

    if (authError || !user) {
      logger.warn(ctx, 'Unauthorized fact linking attempt');
      throw new Error('Authentication required');
    }

    const rows = data.factIds.map((factId) => ({
      episode_id: data.episodeId,
      fact_id: factId,
      linked_by: user.id,
    }));

    const { data: upserted, error } = await client
      .from('episode_facts')
      .upsert(rows, { onConflict: 'episode_id,fact_id' })
      .select('id');

    if (error) {
      logger.error({ ...ctx, error }, 'Failed to link facts to episode');
      throw new Error(`Failed to link facts: ${error.message}`);
    }

    return { linkedCount: upserted?.length ?? 0 };
  },
  {
    auth: true,
    schema: LinkFactsToEpisodeSchema,
  },
);

/**
 * Unlinks a single fact from an episode.
 */
export const unlinkFactFromEpisodeAction = enhanceAction(
  async (data: z.infer<typeof UnlinkFactFromEpisodeSchema>) => {
    const logger = await getLogger();
    const ctx = { name: 'episodes.unlinkFactFromEpisode' };

    const client = getSupabaseServerClient();
    const { data: user, error: authError } = await requireUser(client);

    if (authError || !user) {
      logger.warn(ctx, 'Unauthorized fact unlinking attempt');
      throw new Error('Authentication required');
    }

    const { error } = await client
      .from('episode_facts')
      .delete()
      .eq('episode_id', data.episodeId)
      .eq('fact_id', data.factId);

    if (error) {
      logger.error({ ...ctx, error }, 'Failed to unlink fact from episode');
      throw new Error(`Failed to unlink fact: ${error.message}`);
    }

    return { success: true as const };
  },
  {
    auth: true,
    schema: UnlinkFactFromEpisodeSchema,
  },
);

/**
 * Lists all facts linked to an episode with full verified_facts details.
 * Joins episode_facts → verified_facts for the complete fact payload.
 */
export const getEpisodeFactsAction = enhanceAction(
  async (data: z.infer<typeof GetEpisodeFactsSchema>) => {
    const logger = await getLogger();
    const ctx = { name: 'episodes.getEpisodeFacts' };

    const client = getSupabaseServerClient();
    const { data: user, error: authError } = await requireUser(client);

    if (authError || !user) {
      logger.warn(ctx, 'Unauthorized episode facts query');
      throw new Error('Authentication required');
    }

    const { data: linkedFacts, error } = await client
      .from('episode_facts')
      .select(
        `
        fact_id,
        linked_at,
        linked_by,
        scene_reference,
        verified_facts!inner (
          id,
          claim,
          simplified_claim,
          category,
          source_type,
          source_citation,
          source_title,
          verification_status,
          confidence_score,
          tags
        )
      `,
      )
      .eq('episode_id', data.episodeId)
      .order('linked_at', { ascending: false });

    if (error) {
      logger.error({ ...ctx, error }, 'Failed to fetch episode facts');
      throw new Error(`Failed to fetch episode facts: ${error.message}`);
    }

    const facts = (linkedFacts ?? []).map((row) => {
      const fact = row.verified_facts;

      return {
        id: fact.id,
        claim: fact.claim,
        simplifiedClaim: fact.simplified_claim,
        category: fact.category,
        sourceType: fact.source_type,
        sourceCitation: fact.source_citation,
        sourceTitle: fact.source_title,
        verificationStatus: fact.verification_status,
        confidenceScore: fact.confidence_score,
        tags: fact.tags,
        linkedAt: row.linked_at,
        linkedBy: row.linked_by,
        sceneReference: row.scene_reference,
      };
    });

    return { facts, totalCount: facts.length };
  },
  {
    auth: true,
    schema: GetEpisodeFactsSchema,
  },
);

