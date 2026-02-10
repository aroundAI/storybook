/**
 * External Context Server Actions
 * Phase 11: FILM-1135
 *
 * Server actions for searching, listing, and managing external content sources.
 */

'use server';

import { getSupabaseServerClient } from '@kit/supabase/server-client';
import { enhanceAction } from '@kit/next/actions';
import { z } from 'zod';

import type {
    ExternalContent,
    AggregatorSearchResult,
    SourceCategory,
} from '../types/external-context';
import { SOURCE_CATEGORIES } from '../types/external-context';
import { getContextAggregator, rowToExternalContent } from '../lib/server/services/context-aggregator';

// =============================================================================
// SCHEMAS
// =============================================================================

const SearchExternalContentSchema = z.object({
    query: z.string().min(1),
    category: z
        .union([
            z.enum(SOURCE_CATEGORIES),
            z.array(z.enum(SOURCE_CATEGORIES)),
        ])
        .optional(),
    from: z.string().datetime().optional(),
    to: z.string().datetime().optional(),
    sources: z.array(z.string().uuid()).optional(),
    credibilityTier: z.enum(['tier_1', 'tier_2', 'tier_3']).optional(),
    peerReviewedOnly: z.boolean().optional(),
    language: z.string().optional(),
    pageSize: z.number().int().min(1).max(100).optional(),
    page: z.number().int().min(1).optional(),
});

const ListSourcesSchema = z.object({
    category: z
        .enum(SOURCE_CATEGORIES)
        .optional(),
    activeOnly: z.boolean().optional(),
});

// =============================================================================
// SEARCH ACTION
// =============================================================================

/**
 * Search external content across all configured providers.
 */
export const searchExternalContentAction = enhanceAction(
    async (data: z.infer<typeof SearchExternalContentSchema>): Promise<AggregatorSearchResult> => {
        const aggregator = await getContextAggregator();

        return aggregator.search({
            query: data.query,
            category: data.category as SourceCategory | SourceCategory[] | undefined,
            from: data.from ? new Date(data.from) : undefined,
            to: data.to ? new Date(data.to) : undefined,
            sources: data.sources,
            credibilityTier: data.credibilityTier,
            peerReviewedOnly: data.peerReviewedOnly,
            language: data.language,
            pageSize: data.pageSize,
            page: data.page,
        });
    },
    {
        auth: true,
        schema: SearchExternalContentSchema,
    },
);

// =============================================================================
// LIST SOURCES ACTION
// =============================================================================

/**
 * List registered external sources, optionally filtered by category.
 */
export const listExternalSourcesAction = enhanceAction(
    async (data: z.infer<typeof ListSourcesSchema>) => {
        const supabase = getSupabaseServerClient();
        const activeOnly = data.activeOnly ?? true;

        let query = supabase
            .from('external_sources')
            .select('*')
            .order('category')
            .order('name');

        if (activeOnly) {
            query = query.eq('is_active', true);
        }

        if (data.category) {
            query = query.eq('category', data.category);
        }

        const { data: sources, error } = await query;

        if (error) {
            console.error('[external-context] Failed to list sources:', error.message);
            throw new Error(`Failed to list sources: ${error.message}`);
        }

        return sources ?? [];
    },
    {
        auth: true,
        schema: ListSourcesSchema,
    },
);

// =============================================================================
// GET AVAILABLE PROVIDERS ACTION
// =============================================================================

/**
 * Get available (configured + not rate-limited) providers per category.
 */
export const getAvailableProvidersAction = enhanceAction(
    async () => {
        const aggregator = await getContextAggregator();

        const categories = SOURCE_CATEGORIES;

        const result: Record<string, string[]> = {};
        for (const cat of categories) {
            const providers = aggregator.getProvidersForCategory(cat);
            if (providers.length > 0) {
                result[cat] = providers;
            }
        }

        return {
            providers: result,
            registered: aggregator.getRegisteredProviders(),
        };
    },
    {
        auth: true,
        schema: z.object({}),
    },
);

// =============================================================================
// GET CONTENT BY ID ACTION
// =============================================================================

const GetContentByIdSchema = z.object({
    contentId: z.string().uuid(),
});

/**
 * Get a single cached external content item by ID.
 */
export const getExternalContentByIdAction = enhanceAction(
    async (data: z.infer<typeof GetContentByIdSchema>): Promise<ExternalContent | null> => {
        const supabase = getSupabaseServerClient();

        const { data: rawRow, error } = await supabase
            .from('external_content')
            .select('*')
            .eq('id', data.contentId)
            .single();

        if (error || !rawRow) return null;

        return rowToExternalContent(rawRow);
    },
    {
        auth: true,
        schema: GetContentByIdSchema,
    },
);
