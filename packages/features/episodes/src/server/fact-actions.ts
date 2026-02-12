'use server';

import { revalidatePath } from 'next/cache';

import { enhanceAction } from '@kit/next/actions';
import { getSupabaseServerClient } from '@kit/supabase/server-client';
import { z } from 'zod';

// =============================================================================
// SCHEMAS
// =============================================================================

const AddFactSchema = z.object({
    projectId: z.string().uuid(),
    claim: z.string().min(10, 'Claim must be at least 10 characters'),
    category: z.string().max(100).optional(),
    subcategory: z.string().max(100).optional(),
    tags: z.array(z.string()).default([]),
    sourceType: z.enum([
        'research_paper',
        'book',
        'news_article',
        'official_document',
        'documentary',
        'expert_interview',
        'dataset',
        'website',
        'encyclopedia',
        'court_document',
        'historical_record',
        'textbook',
        'other',
    ]),
    sourceUrl: z
        .string()
        .url()
        .optional()
        .or(z.literal('')),
    sourceCitation: z.string().min(10, 'Citation required'),
    sourceTitle: z.string().optional(),
    sourceAuthors: z.string().optional(),
    sourceDoi: z.string().optional(),
    confidenceScore: z.number().min(0).max(1).optional(),
});

const VerifyFactSchema = z.object({
    factId: z.string().uuid(),
    verificationNotes: z.string().optional(),
});

const DisputeFactSchema = z.object({
    factId: z.string().uuid(),
    disputeReason: z.string().min(1, 'Dispute reason is required'),
});

const DeleteFactSchema = z.object({
    factId: z.string().uuid(),
});

const GetProjectFactsSchema = z.object({
    projectId: z.string().uuid(),
    search: z.string().optional(),
    category: z.string().optional(),
    status: z
        .enum([
            'unverified',
            'pending_review',
            'verified',
            'disputed',
            'retracted',
        ])
        .optional(),
    limit: z.number().int().min(1).max(100).default(50),
    offset: z.number().int().min(0).default(0),
});

const GetFactByIdSchema = z.object({
    factId: z.string().uuid(),
});

// =============================================================================
// ROW MAPPER
// =============================================================================

interface VerifiedFactRow {
    id: string;
    project_id: string;
    claim: string;
    simplified_claim: string | null;
    category: string | null;
    subcategory: string | null;
    tags: string[] | null;
    source_type: string;
    source_url: string | null;
    source_citation: string | null;
    source_title: string | null;
    source_authors: string[] | null;
    source_publication_date: string | null;
    source_doi: string | null;
    source_metadata: unknown;
    verification_status: string;
    verified_by: string | null;
    verified_at: string | null;
    verification_notes: string | null;
    confidence_score: number | null;
    times_used: number | null;
    last_used_at: string | null;
    episodes_used_in: string[] | null;
    created_at: string | null;
    created_by: string | null;
    updated_at: string | null;
    updated_by: string | null;
}

function mapFactRow(row: VerifiedFactRow) {
    return {
        id: row.id,
        projectId: row.project_id,
        claim: row.claim,
        simplifiedClaim: row.simplified_claim,
        category: row.category,
        subcategory: row.subcategory,
        tags: row.tags ?? [],
        sourceType: row.source_type,
        sourceUrl: row.source_url,
        sourceCitation: row.source_citation,
        sourceTitle: row.source_title,
        sourceAuthors: row.source_authors ?? [],
        sourcePublicationDate: row.source_publication_date,
        sourceDoi: row.source_doi,
        verificationStatus: row.verification_status,
        verifiedBy: row.verified_by,
        verifiedAt: row.verified_at,
        verificationNotes: row.verification_notes,
        confidenceScore: row.confidence_score,
        timesUsed: row.times_used ?? 0,
        lastUsedAt: row.last_used_at,
        episodesUsedIn: row.episodes_used_in ?? [],
        createdAt: row.created_at,
        createdBy: row.created_by,
        updatedAt: row.updated_at,
        updatedBy: row.updated_by,
    };
}

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
                source_type: data.sourceType,
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

        revalidatePath('/home/[account]/studio/[projectSlug]/settings/facts');

        return { fact: mapFactRow(fact as VerifiedFactRow) };
    },
    {
        schema: AddFactSchema,
        auth: true,
    },
);

/**
 * Mark a fact as verified.
 */
export const verifyFactAction = enhanceAction(
    async (data, user) => {
        const client = getSupabaseServerClient();

        const { error } = await client
            .from('verified_facts')
            .update({
                verification_status: 'verified',
                verified_by: user?.id,
                verified_at: new Date().toISOString(),
                verification_notes: data.verificationNotes || null,
                updated_by: user?.id,
            })
            .eq('id', data.factId);

        if (error) {
            throw new Error(`Failed to verify fact: ${error.message}`);
        }

        revalidatePath('/home/[account]/studio/[projectSlug]/settings/facts');

        return { success: true };
    },
    {
        schema: VerifyFactSchema,
        auth: true,
    },
);

/**
 * Mark a fact as disputed.
 */
export const disputeFactAction = enhanceAction(
    async (data, user) => {
        const client = getSupabaseServerClient();

        const { error } = await client
            .from('verified_facts')
            .update({
                verification_status: 'disputed',
                verification_notes: data.disputeReason,
                updated_by: user?.id,
            })
            .eq('id', data.factId);

        if (error) {
            throw new Error(`Failed to dispute fact: ${error.message}`);
        }

        revalidatePath('/home/[account]/studio/[projectSlug]/settings/facts');

        return { success: true };
    },
    {
        schema: DisputeFactSchema,
        auth: true,
    },
);

/**
 * Delete a verified fact (owner/admin via RLS).
 */
export const deleteFactAction = enhanceAction(
    async (data) => {
        const client = getSupabaseServerClient();

        const { error } = await client
            .from('verified_facts')
            .delete()
            .eq('id', data.factId);

        if (error) {
            throw new Error(`Failed to delete fact: ${error.message}`);
        }

        revalidatePath('/home/[account]/studio/[projectSlug]/settings/facts');

        return { success: true };
    },
    {
        schema: DeleteFactSchema,
        auth: true,
    },
);

/**
 * Get all facts for a project with search, filter, pagination.
 */
export const getProjectFactsAction = enhanceAction(
    async (data) => {
        const client = getSupabaseServerClient();

        // TODO(FILM-1121): Remove cast after running `pnpm supabase:web:typegen` with verified_facts table
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- verified_facts not yet in generated types
        let query = (client as any)
            .from('verified_facts')
            .select('*', { count: 'exact' })
            .eq('project_id', data.projectId)
            .order('created_at', { ascending: false });

        if (data.search) {
            query = query.textSearch(
                'claim',
                data.search.split(/\s+/).join(' & '),
            );
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

        // TODO(FILM-1121): Remove cast after running `pnpm supabase:web:typegen` with verified_facts table
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- verified_facts not yet in generated types
        const { data: fact, error } = await (client as any)
            .from('verified_facts')
            .select('*')
            .eq('id', data.factId)
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

