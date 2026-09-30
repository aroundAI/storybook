'use server';

import { z } from 'zod';

import { ActionRefusal } from '@kit/next/action-result';
import { enhanceAction } from '@kit/next/actions';
import { returnRefusals } from '@kit/next/refusals';
import { getLogger } from '@kit/shared/logger';
import { requireUser } from '@kit/supabase/require-user';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

import { sceneOptionsOf } from '../lib/episode-fact-scenes';
import { EPISODE_FACT_REFUSALS } from './episode-fact-refusals';

// =============================================================================
// SCHEMAS
// =============================================================================

const LinkFactsToEpisodeSchema = z.object({
  episodeId: z.string().uuid(),
  factIds: z.array(z.string().uuid()).min(1).max(50),
  sceneReference: z.string().min(1).max(20).optional(),
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
 * A fact that is already linked is skipped (`on conflict do nothing`): the
 * table has no UPDATE policy, so `do update` would refuse the whole batch.
 */
const linkFactsToEpisode = enhanceAction(
  async (data: z.infer<typeof LinkFactsToEpisodeSchema>) => {
    const logger = await getLogger();
    const ctx = { name: 'episodes.linkFactsToEpisode' };

    const client = getSupabaseServerClient();
    const { data: user, error: authError } = await requireUser(client);

    if (authError || !user) {
      logger.warn(ctx, 'Unauthorized fact linking attempt');
      throw new Error('Authentication required');
    }

    if (data.sceneReference !== undefined) {
      const { data: episode, error: episodeError } = await client
        .from('episodes')
        .select('screenplay_data')
        .eq('id', data.episodeId)
        .single();

      if (episodeError && episodeError.code !== 'PGRST116') {
        logger.error({ ...ctx, error: episodeError }, 'Failed to read scenes');
        throw new Error(`Failed to read episode scenes: ${episodeError.message}`);
      }

      const known = sceneOptionsOf(episode?.screenplay_data).some(
        (scene) => scene.value === data.sceneReference,
      );

      if (!known) {
        throw new ActionRefusal(EPISODE_FACT_REFUSALS.scene);
      }
    }

    const rows = data.factIds.map((factId) => ({
      episode_id: data.episodeId,
      fact_id: factId,
      linked_by: user.id,
      ...(data.sceneReference ? { scene_reference: data.sceneReference } : {}),
    }));

    const { data: upserted, error } = await client
      .from('episode_facts')
      .upsert(rows, {
        onConflict: 'episode_id,fact_id',
        ignoreDuplicates: true,
      })
      .select('id');

    if (error?.code === '42501') {
      throw new ActionRefusal(EPISODE_FACT_REFUSALS.link);
    }

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

export const linkFactsToEpisodeAction = returnRefusals(linkFactsToEpisode);

/**
 * Unlinks a single fact from an episode. RLS turns a refused delete into zero
 * rows, not an error, so a delete that removed nothing is refused here.
 */
const unlinkFactFromEpisode = enhanceAction(
  async (data: z.infer<typeof UnlinkFactFromEpisodeSchema>) => {
    const logger = await getLogger();
    const ctx = { name: 'episodes.unlinkFactFromEpisode' };

    const client = getSupabaseServerClient();
    const { data: user, error: authError } = await requireUser(client);

    if (authError || !user) {
      logger.warn(ctx, 'Unauthorized fact unlinking attempt');
      throw new Error('Authentication required');
    }

    const { data: removed, error } = await client
      .from('episode_facts')
      .delete()
      .eq('episode_id', data.episodeId)
      .eq('fact_id', data.factId)
      .select('id');

    if (error) {
      logger.error({ ...ctx, error }, 'Failed to unlink fact from episode');
      throw new Error(`Failed to unlink fact: ${error.message}`);
    }

    if (!removed?.length) {
      throw new ActionRefusal(EPISODE_FACT_REFUSALS.unlink);
    }

    return { success: true as const };
  },
  {
    auth: true,
    schema: UnlinkFactFromEpisodeSchema,
  },
);

export const unlinkFactFromEpisodeAction = returnRefusals(
  unlinkFactFromEpisode,
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

    const facts = (linkedFacts ?? [])
      .map((row) => {
        const fact = row.verified_facts;
        if (!fact) return null;

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
      })
      .filter((f): f is NonNullable<typeof f> => f !== null);

    return { facts, totalCount: facts.length };
  },
  {
    auth: true,
    schema: GetEpisodeFactsSchema,
  },
);

/**
 * The scenes of an episode's screenplay, for choosing the scene a fact is
 * used in. Empty until the screenplay exists.
 */
export const getEpisodeSceneOptionsAction = enhanceAction(
  async (data: z.infer<typeof GetEpisodeFactsSchema>) => {
    const client = getSupabaseServerClient();

    const { data: episode, error } = await client
      .from('episodes')
      .select('screenplay_data')
      .eq('id', data.episodeId)
      .single();

    if (error && error.code !== 'PGRST116') {
      throw new Error(`Failed to read episode scenes: ${error.message}`);
    }

    return { scenes: sceneOptionsOf(episode?.screenplay_data) };
  },
  {
    auth: true,
    schema: GetEpisodeFactsSchema,
  },
);
