/**
 * External Context Aggregator
 * Phase 11: FILM-1135
 *
 * Routes search requests to appropriate external providers,
 * manages a Supabase-backed cache layer, and deduplicates results.
 */

import { getSupabaseServerClient } from '@kit/supabase/server-client';
import type { Database } from '@kit/supabase/database';

type Json = Database['public']['Tables']['external_content']['Insert']['entities'];

import type {
    ExternalContextProvider,
    ExternalSearchParams,
    ExternalContent,
    AggregatorSearchResult,
    SourceCategory,
    ExternalSourceRow,
    ExternalContentRow,
    CredibilityTier,
    ExtractedEntities,
} from '../../../types/external-context';
import { NewsAPIProvider } from '../providers/newsapi-provider';
import { SemanticScholarProvider } from '../providers/semantic-scholar-provider';
import { ArchiveOrgProvider } from '../providers/archive-org-provider';

// =============================================================================
// AGGREGATOR
// =============================================================================

export class ExternalContextAggregator {
    private providers = new Map<string, ExternalContextProvider>();
    private providersByCategory = new Map<SourceCategory, ExternalContextProvider[]>();

    /**
     * Initialize by loading active sources from the database
     * and instantiating their providers.
     */
    async initialize(): Promise<void> {
        const supabase = getSupabaseServerClient();

        // NOTE: external_sources table is FILM-1135 — types will be generated after migration.
        const { data: sources, error } = await supabase
            .from('external_sources')
            .select('*')
            .eq('is_active', true);

        if (error) {
            console.error('[context-aggregator] Failed to load sources:', error.message);
            return;
        }

        for (const source of (sources ?? []) as ExternalSourceRow[]) {
            const provider = this.createProvider(source);
            if (provider) {
                this.providers.set(source.id, provider);

                const existing = this.providersByCategory.get(source.category as SourceCategory) ?? [];
                existing.push(provider);
                this.providersByCategory.set(source.category as SourceCategory, existing);
            }
        }
    }

    /**
     * Search across providers with cache-first strategy.
     */
    async search(params: ExternalSearchParams): Promise<AggregatorSearchResult> {
        const categories = this.resolveCategories(params.category);

        // 1. Check cache
        const cachedContent = await this.searchCache(params, categories);

        if (cachedContent.length >= (params.pageSize ?? 20)) {
            return {
                content: cachedContent.slice(0, params.pageSize ?? 20),
                totalCount: cachedContent.length,
                fromCache: true,
                fetchedNew: 0,
                providers: [],
            };
        }

        // 2. Fetch from live providers
        const freshContent: ExternalContent[] = [];
        const usedProviders: string[] = [];

        for (const category of categories) {
            const categoryProviders = this.providersByCategory.get(category) ?? [];

            for (const provider of categoryProviders) {
                if (!provider.isAvailable()) continue;

                try {
                    const content = await provider.fetchContent(params);
                    freshContent.push(...content);
                    usedProviders.push(provider.name);
                } catch (err) {
                    console.error(`[context-aggregator] Provider ${provider.name} failed:`, err);
                }
            }
        }

        // 3. Cache fresh content
        const cachedCount = await this.cacheContent(freshContent);

        // 4. Combine, deduplicate, and return
        const allContent = [...cachedContent, ...freshContent];
        const unique = this.deduplicateContent(allContent);

        return {
            content: unique.slice(0, params.pageSize ?? 20),
            totalCount: unique.length,
            fromCache: false,
            fetchedNew: cachedCount,
            providers: usedProviders,
        };
    }

    /**
     * Get available provider names for a category.
     */
    getProvidersForCategory(category: SourceCategory): string[] {
        return (this.providersByCategory.get(category) ?? [])
            .filter((p) => p.isAvailable())
            .map((p) => p.name);
    }

    /**
     * Get all registered provider names.
     */
    getRegisteredProviders(): string[] {
        return Array.from(this.providers.values()).map((p) => p.name);
    }

    // ---------------------------------------------------------------------------
    // Private helpers
    // ---------------------------------------------------------------------------

    private createProvider(source: ExternalSourceRow): ExternalContextProvider | null {
        switch (source.provider_type) {
            case 'newsapi':
                return new NewsAPIProvider(source.id);
            case 'semantic_scholar':
                return new SemanticScholarProvider(source.id);
            case 'archive_org':
                return new ArchiveOrgProvider(source.id);
            default:
                console.warn(`[context-aggregator] Unknown provider_type: ${source.provider_type}`);
                return null;
        }
    }

    private resolveCategories(
        category: SourceCategory | SourceCategory[] | undefined,
    ): SourceCategory[] {
        if (!category) {
            return Array.from(this.providersByCategory.keys());
        }
        return Array.isArray(category) ? category : [category];
    }

    private async searchCache(
        params: ExternalSearchParams,
        categories: SourceCategory[],
    ): Promise<ExternalContent[]> {
        const supabase = getSupabaseServerClient();

        // NOTE: external_content table is FILM-1135 — types will be generated after migration.
        let query = supabase
            .from('external_content')
            .select('*')
            .in('category', categories)
            .gt('cache_expires_at', new Date().toISOString())
            .order('published_at', { ascending: false })
            .limit(params.pageSize ?? 20);

        if (params.query) {
            query = query.textSearch('title', params.query, { type: 'websearch' });
        }

        if (params.from) {
            query = query.gte('published_at', params.from.toISOString());
        }
        if (params.to) {
            query = query.lte('published_at', params.to.toISOString());
        }

        if (params.credibilityTier) {
            query = query.eq('credibility_tier', params.credibilityTier);
        }

        if (params.peerReviewedOnly) {
            query = query.eq('peer_reviewed', true);
        }

        if (params.sources && params.sources.length > 0) {
            query = query.in('source_id', params.sources);
        }

        const { data, error } = await query;

        if (error) {
            console.error('[context-aggregator] Cache search failed:', error.message);
            return [];
        }

        return ((data ?? []) as ExternalContentRow[]).map(rowToExternalContent);
    }

    private async cacheContent(content: ExternalContent[]): Promise<number> {
        if (content.length === 0) return 0;

        const supabase = getSupabaseServerClient();

        const rows = content.map((c) => ({
            external_id: c.externalId,
            source_id: c.sourceId,
            title: c.title,
            description: c.description,
            content: c.content,
            url: c.url,
            authors: c.authors,
            published_at: c.publishedAt.toISOString(),
            language: c.language,
            category: c.category as string,
            topics: c.topics,
            entities: JSON.parse(JSON.stringify(c.entities)) as Json,
            doi: c.doi ?? null,
            journal: c.journal ?? null,
            citations: c.citations ?? null,
            peer_reviewed: c.peerReviewed ?? false,
            image_url: c.imageUrl ?? null,
            credibility_tier: c.credibilityTier,
            bias_label: c.biasLabel ?? null,
            fetched_at: c.fetchedAt.toISOString(),
            cache_expires_at: c.cacheExpiresAt.toISOString(),
        }));

        const { data, error } = await supabase
            .from('external_content')
            .upsert(rows, { onConflict: 'external_id' })
            .select('id');

        if (error) {
            console.error('[context-aggregator] Cache write failed:', error.message);
            return 0;
        }

        return data?.length ?? 0;
    }

    private deduplicateContent(content: ExternalContent[]): ExternalContent[] {
        const seen = new Set<string>();
        return content.filter((c) => {
            if (seen.has(c.externalId)) return false;
            seen.add(c.externalId);
            return true;
        });
    }
}

// =============================================================================
// ROW MAPPER
// =============================================================================

function rowToExternalContent(row: ExternalContentRow): ExternalContent {
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
}

// =============================================================================
// SINGLETON
// =============================================================================

let aggregatorInstance: ExternalContextAggregator | null = null;

/**
 * Get the singleton ExternalContextAggregator instance.
 * Initializes on first call by loading active sources from the database.
 */
export async function getContextAggregator(): Promise<ExternalContextAggregator> {
    if (!aggregatorInstance) {
        aggregatorInstance = new ExternalContextAggregator();
        await aggregatorInstance.initialize();
    }
    return aggregatorInstance;
}

/**
 * Reset the singleton (for testing or after source config changes).
 */
export function resetContextAggregator(): void {
    aggregatorInstance = null;
}
