'use server';

import { revalidatePath } from 'next/cache';

import { enhanceAction } from '@kit/next/actions';
import { getSupabaseServerClient } from '@kit/supabase/server-client';
import { z } from 'zod';

import { SOURCE_TYPES } from '../components/facts/fact-constants';

import { mapFactRow } from './fact-row-mapper';
import type { VerifiedFactRow } from './fact-row-mapper';

export type { MappedFact } from './fact-row-mapper';

// =============================================================================
// SCHEMAS
// =============================================================================

type SourceTypeValue = (typeof SOURCE_TYPES)[number]['value'];
const sourceTypeValues = SOURCE_TYPES.map((s) => s.value) as readonly [SourceTypeValue, ...SourceTypeValue[]];

const AddFactSchema = z.object({
    projectId: z.string().uuid(),
    basePath: z.string().min(1),
    claim: z.string().min(10, 'Claim must be at least 10 characters'),
    category: z.string().max(100).optional(),
    subcategory: z.string().max(100).optional(),
    tags: z.array(z.string()).default([]),
    sourceType: z.enum(sourceTypeValues),
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
            .eq('id', data.factId)
            .eq('project_id', data.projectId);

        if (error) {
            throw new Error(`Failed to verify fact: ${error.message}`);
        }

        revalidatePath(data.basePath);

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
            .eq('id', data.factId)
            .eq('project_id', data.projectId);

        if (error) {
            throw new Error(`Failed to dispute fact: ${error.message}`);
        }

        revalidatePath(data.basePath);

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
            .eq('id', data.factId)
            .eq('project_id', data.projectId);

        if (error) {
            throw new Error(`Failed to delete fact: ${error.message}`);
        }

        revalidatePath(data.basePath);

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

        let query = client
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

        const { data: fact, error } = await client
            .from('verified_facts')
            .select('*')
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

