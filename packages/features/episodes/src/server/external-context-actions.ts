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
    ExternalSourceRow,
    ExternalContentRow,
    CredibilityTier,
    ExtractedEntities,
} from '../types/external-context';
import { getContextAggregator } from '../lib/server/services/context-aggregator';

// =============================================================================
// SCHEMAS
// =============================================================================

const SearchExternalContentSchema = z.object({
    query: z.string().min(1),
    category: z
        .union([
            z.enum(['news', 'research', 'encyclopedia', 'historical', 'official', 'multimedia']),
            z.array(z.enum(['news', 'research', 'encyclopedia', 'historical', 'official', 'multimedia'])),
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
        .enum(['news', 'research', 'encyclopedia', 'historical', 'official', 'multimedia'])
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

        // NOTE: external_sources table is FILM-1135 — types will be generated after migration.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let query = (supabase as any)
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

        return (sources ?? []) as ExternalSourceRow[];
    },
    {
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

        const categories: SourceCategory[] = [
            'news', 'research', 'encyclopedia', 'historical', 'official', 'multimedia',
        ];

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

        // NOTE: external_content table is FILM-1135 — types will be generated after migration.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data: rawRow, error } = await (supabase as any)
            .from('external_content')
            .select('*')
            .eq('id', data.contentId)
            .single();

        if (error || !rawRow) return null;

        const row = rawRow as ExternalContentRow;

        return {
            id: row.id,
            externalId: row.external_id,
            sourceId: row.source_id,
            title: row.title,
            description: row.description ?? '',
            content: row.content,
            url: row.url,
            authors: row.authors ?? [],
            publishedAt: new Date(row.published_at ?? Date.now()),
            language: row.language,
            category: row.category as SourceCategory,
            topics: row.topics ?? [],
            entities: (row.entities ?? {}) as unknown as ExtractedEntities,
            doi: row.doi ?? undefined,
            journal: row.journal ?? undefined,
            citations: row.citations ?? undefined,
            peerReviewed: row.peer_reviewed,
            imageUrl: row.image_url ?? undefined,
            credibilityTier: (row.credibility_tier ?? 'tier_3') as CredibilityTier,
            biasLabel: row.bias_label ?? undefined,
            fetchedAt: new Date(row.fetched_at),
            cacheExpiresAt: new Date(row.cache_expires_at ?? Date.now()),
        };
    },
    {
        schema: GetContentByIdSchema,
    },
);
