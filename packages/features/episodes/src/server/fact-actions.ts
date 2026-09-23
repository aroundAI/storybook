'use server';

import { revalidatePath } from 'next/cache';

import { z } from 'zod';

import { ActionRefusal } from '@kit/next/action-result';
import { enhanceAction } from '@kit/next/actions';
import { returnRefusals } from '@kit/next/refusals';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

import { SOURCE_TYPES } from '../components/facts/fact-constants';
import { FACT_REFUSALS, factRefusal } from './fact-review-refusals';
import type { FactAction } from './fact-review-refusals';
import { mapFactRow } from './fact-row-mapper';
import type { VerifiedFactRow } from './fact-row-mapper';

// =============================================================================
// HELPERS
// =============================================================================

/**
 * Review a fact through `public.set_fact_verification` (KB-18), which alone
 * decides who may and from which state; `verified_by` is set there from the
 * session. A refusal becomes an `ActionRefusal` the user can read; anything
 * else stays thrown.
 */
async function reviewFact(
  action: Exclude<FactAction, 'delete'>,
  factId: string,
  notes: string | null,
) {
  const client = getSupabaseServerClient();

  const { data: status, error } = await client.rpc('set_fact_verification', {
    target_fact_id: factId,
    outcome: action === 'verify' ? 'verified' : 'disputed',
    notes: notes ?? undefined,
  });

  if (error) {
    const refusal = factRefusal(error, action);

    if (refusal) {
      throw new ActionRefusal(refusal);
    }

    throw new Error(`Failed to ${action} fact: ${error.message}`);
  }

  return status;
}

// =============================================================================
// SCHEMAS
// =============================================================================

type SourceTypeValue = (typeof SOURCE_TYPES)[number]['value'];
const [firstSourceType, ...restSourceTypes] = SOURCE_TYPES.map((s) => s.value);
const sourceTypeValues = [
  firstSourceType!,
  ...restSourceTypes,
] as const satisfies readonly [SourceTypeValue, ...SourceTypeValue[]];

const AddFactSchema = z.object({
  projectId: z.string().uuid(),
  basePath: z.string().min(1),
  claim: z.string().min(10, 'Claim must be at least 10 characters'),
  category: z.string().max(100).optional(),
  subcategory: z.string().max(100).optional(),
  tags: z.array(z.string()).default([]),
  sourceType: z.enum(sourceTypeValues),
  sourceUrl: z.string().url().optional().or(z.literal('')),
  sourceCitation: z.string().min(10, 'Citation required'),
  sourceTitle: z.string().optional(),
  sourceAuthors: z.string().optional(),
  sourceDoi: z.string().optional(),
  confidenceScore: z.number().min(0).max(1).optional(),
});

const VerifyFactSchema = z.object({
  factId: z.string().uuid(),
  projectId: z.string().uuid(),
  basePath: z.string().min(1),
  verificationNotes: z.string().optional(),
});

const DisputeFactSchema = z.object({
  factId: z.string().uuid(),
  projectId: z.string().uuid(),
  basePath: z.string().min(1),
  disputeReason: z.string().min(1, 'Dispute reason is required'),
});

const DeleteFactSchema = z.object({
  factId: z.string().uuid(),
  projectId: z.string().uuid(),
  basePath: z.string().min(1),
});

const GetProjectFactsSchema = z.object({
  projectId: z.string().uuid(),
  search: z.string().optional(),
  category: z.string().optional(),
  status: z
    .enum(['unverified', 'pending_review', 'verified', 'disputed', 'retracted'])
    .optional(),
  limit: z.number().int().min(1).max(100).default(50),
  offset: z.number().int().min(0).default(0),
});

const GetFactByIdSchema = z.object({
  factId: z.string().uuid(),
  projectId: z.string().uuid(),
});

// =============================================================================
// ACTIONS
// =============================================================================

/**
 * Add a new verified fact to a project.
 * Auto-generates simplified_claim for search.
 */
export const addVerifiedFactAction = enhanceAction(
  async (data, user) => {
    const client = getSupabaseServerClient();

    // Generate simplified claim for better full-text search
    const simplifiedClaim = data.claim
      .toLowerCase()
      .replace(/[^\w\s]/g, '')
      .trim();

    // Parse authors from comma-separated string to array
    const sourceAuthors = data.sourceAuthors
      ? data.sourceAuthors
          .split(',')
          .map((a: string) => a.trim())
          .filter(Boolean)
      : undefined;

    const { data: fact, error } = await client
      .from('verified_facts')
      .insert({
        project_id: data.projectId,
        claim: data.claim,
        simplified_claim: simplifiedClaim,
        category: data.category || null,
        subcategory: data.subcategory || null,
        tags: data.tags,
        source_type: data.sourceType as SourceTypeValue,
        source_url: data.sourceUrl || null,
        source_citation: data.sourceCitation,
        source_title: data.sourceTitle || null,
        source_authors: sourceAuthors || null,
        source_doi: data.sourceDoi || null,
        confidence_score: data.confidenceScore ?? null,
        created_by: user?.id,
        updated_by: user?.id,
      })
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to add fact: ${error.message}`);
    }

    revalidatePath(data.basePath);

    // Note: cast is safe as long as verified_facts schema matches VerifiedFactRow.
    // Remove cast after running `pnpm supabase:web:typegen` with verified_facts table.
    return { fact: mapFactRow(fact as VerifiedFactRow) };
  },
  {
    schema: AddFactSchema,
    auth: true,
  },
);

/**
 * Mark a fact as verified, by the signed-in user.
 * Only the project's owner or admins; only an unverified or pending fact.
 */
export const verifyFactAction = returnRefusals(
  enhanceAction(
    async (data) => {
      const status = await reviewFact(
        'verify',
        data.factId,
        data.verificationNotes || null,
      );

      revalidatePath(data.basePath);

      return { status };
    },
    {
      schema: VerifyFactSchema,
      auth: true,
    },
  ),
);

/**
 * Mark a fact as disputed, with the reason.
 * Only the project's owner or admins; only an unverified or pending fact.
 */
export const disputeFactAction = returnRefusals(
  enhanceAction(
    async (data) => {
      const status = await reviewFact(
        'dispute',
        data.factId,
        data.disputeReason,
      );

      revalidatePath(data.basePath);

      return { status };
    },
    {
      schema: DisputeFactSchema,
      auth: true,
    },
  ),
);

/**
 * Delete a fact. Only the project's owner or admins — the rule the DELETE
 * policy applies, asked first so a refusal is said rather than returned as a
 * delete that removed nothing.
 */
export const deleteFactAction = returnRefusals(
  enhanceAction(
    async (data) => {
      const client = getSupabaseServerClient();

      const { data: canEdit, error: roleError } = await client.rpc(
        'can_edit_project',
        { target_project_id: data.projectId },
      );

      if (roleError) {
        throw new Error(`Failed to delete fact: ${roleError.message}`);
      }

      if (!canEdit) {
        throw new ActionRefusal(FACT_REFUSALS.deleteForbidden);
      }

      const { data: deleted, error } = await client
        .from('verified_facts')
        .delete()
        .eq('id', data.factId)
        .eq('project_id', data.projectId)
        .select('id');

      if (error) {
        throw new Error(`Failed to delete fact: ${error.message}`);
      }

      if (!deleted?.length) {
        throw new ActionRefusal(FACT_REFUSALS.notFound);
      }

      revalidatePath(data.basePath);

      return { deleted: true };
    },
    {
      schema: DeleteFactSchema,
      auth: true,
    },
  ),
);

/**
 * Get all facts for a project with search, filter, pagination.
 */
export const getProjectFactsAction = enhanceAction(
  async (data) => {
    const client = getSupabaseServerClient();

    let query = client
      .from('verified_facts')
      .select(
        'id, project_id, claim, simplified_claim, category, subcategory, tags, source_type, source_url, source_citation, source_title, source_authors, source_publication_date, source_doi, source_metadata, verification_status, verified_by, verified_at, verification_notes, confidence_score, times_used, last_used_at, episodes_used_in, created_at, created_by, updated_at, updated_by',
        { count: 'exact' },
      )
      .eq('project_id', data.projectId)
      .order('created_at', { ascending: false });

    if (data.search) {
      query = query.textSearch('claim', data.search.split(/\s+/).join(' & '));
    }

    if (data.category) {
      query = query.eq('category', data.category);
    }

    if (data.status) {
      query = query.eq('verification_status', data.status);
    }

    query = query.range(data.offset, data.offset + data.limit - 1);

    const { data: facts, count, error } = await query;

    if (error) {
      throw new Error(`Failed to fetch facts: ${error.message}`);
    }

    return {
      facts: ((facts ?? []) as VerifiedFactRow[]).map(mapFactRow),
      total: (count as number | null) ?? 0,
    };
  },
  {
    schema: GetProjectFactsSchema,
    auth: true,
  },
);

/**
 * Get a single fact by ID.
 */
export const getFactByIdAction = enhanceAction(
  async (data) => {
    const client = getSupabaseServerClient();

    const { data: fact, error } = await client
      .from('verified_facts')
      .select(
        'id, project_id, claim, simplified_claim, category, subcategory, tags, source_type, source_url, source_citation, source_title, source_authors, source_publication_date, source_doi, source_metadata, verification_status, verified_by, verified_at, verification_notes, confidence_score, times_used, last_used_at, episodes_used_in, created_at, created_by, updated_at, updated_by',
      )
      .eq('id', data.factId)
      .eq('project_id', data.projectId)
      .single();

    if (error) {
      throw new Error(`Failed to fetch fact: ${error.message}`);
    }

    return { fact: mapFactRow(fact as VerifiedFactRow) };
  },
  {
    schema: GetFactByIdSchema,
    auth: true,
  },
);
