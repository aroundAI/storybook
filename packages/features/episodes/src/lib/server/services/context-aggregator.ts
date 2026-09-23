/**
 * External Context Aggregator
 * Phase 11: FILM-1135
 *
 * Routes search requests to appropriate external providers,
 * manages a Supabase-backed cache layer, and deduplicates results.
 */
import type { Database } from '@kit/supabase/database';
import { getSupabaseServerAdminClient } from '@kit/supabase/server-admin-client';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

import type {
  AggregatorSearchResult,
  CredibilityTier,
  ExternalContent,
  ExternalContentRow,
  ExternalContextProvider,
  ExternalSearchParams,
  ExternalSourceRow,
  SourceCategory,
} from '../../../types/external-context';
import { createEmptyEntities } from '../../../types/external-context';
import { ArchiveOrgProvider } from '../providers/archive-org-provider';
import type { BaseExternalProvider } from '../providers/base-provider';
import { NewsAPIProvider } from '../providers/newsapi-provider';
import { SemanticScholarProvider } from '../providers/semantic-scholar-provider';

type Json =
  Database['public']['Tables']['external_content']['Insert']['entities'];

// =============================================================================
// ROW MAPPER (shared — also re-exported for use in server actions)
// =============================================================================

/** Map a database row to the application-level ExternalContent model. */
export function rowToExternalContent(
  row: Partial<ExternalContentRow> &
    Pick<
      ExternalContentRow,
      'id' | 'external_id' | 'source_id' | 'title' | 'url' | 'category'
    >,
): ExternalContent {
  return {
    id: row.id,
    externalId: row.external_id,
    sourceId: row.source_id,
    title: row.title,
    description: row.description ?? '',
    content: row.content ?? null,
    url: row.url,
    authors: row.authors ?? [],
    publishedAt: new Date(row.published_at ?? Date.now()),
    language: row.language ?? 'en',
    category: row.category as SourceCategory,
    topics: row.topics ?? [],
    entities: {
      ...createEmptyEntities(),
      ...((row.entities ?? {}) as Record<string, unknown>),
      extractedAt: new Date(
        ((row.entities as Record<string, unknown> | null)
          ?.extractedAt as string) ?? Date.now(),
      ),
    },
    doi: row.doi ?? undefined,
    journal: row.journal ?? undefined,
    citations: row.citations ?? undefined,
    peerReviewed: row.peer_reviewed ?? undefined,
    imageUrl: row.image_url ?? undefined,
    credibilityTier: (row.credibility_tier ?? 'tier_3') as CredibilityTier,
    biasLabel: row.bias_label ?? undefined,
    fetchedAt: new Date(row.fetched_at ?? Date.now()),
    cacheExpiresAt: new Date(row.cache_expires_at ?? Date.now()),
  };
}

// =============================================================================
// AGGREGATOR
// =============================================================================

/** TTL for singleton re-initialisation (5 minutes). */
const REINIT_TTL_MS = 5 * 60 * 1000;

export class ExternalContextAggregator {
  private providers = new Map<string, ExternalContextProvider>();
  private providersByCategory = new Map<
    SourceCategory,
    ExternalContextProvider[]
  >();
  private initializedAt = 0;

  /**
   * Initialize by loading active sources from the database
   * and instantiating their providers.
   */
  async initialize(): Promise<void> {
    const supabase = getSupabaseServerClient();

    const { data: sources, error } = await supabase
      .from('external_sources')
      .select('id, category, provider_type, credibility_tier')
      .eq('is_active', true)
      // Shared sources only. This instance is cached for the whole process,
      // built from whichever caller's RLS view arrived first, so a
      // project's own sources (KB-26) must never enter it.
      .is('project_id', null);

    if (error) {
      console.error(
        '[context-aggregator] Failed to load sources:',
        error.message,
      );
      return;
    }

    // Clear previous state for re-init (including stale rate-limit counters
    // that may persist across Lambda warm invocations).
    for (const provider of this.providers.values()) {
      (provider as BaseExternalProvider).resetRateLimit?.();
    }
    this.providers.clear();
    this.providersByCategory.clear();

    for (const source of sources ?? []) {
      const provider = this.createProvider(source);
      if (provider) {
        this.providers.set(source.id, provider);

        const existing =
          this.providersByCategory.get(source.category as SourceCategory) ?? [];
        existing.push(provider);
        this.providersByCategory.set(
          source.category as SourceCategory,
          existing,
        );
      }
    }

    this.initializedAt = Date.now();
  }

  /** Whether the singleton has gone stale and should re-initialize. */
  isStale(): boolean {
    return Date.now() - this.initializedAt > REINIT_TTL_MS;
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
          console.error(
            `[context-aggregator] Provider ${provider.name} failed:`,
            err,
          );
        }
      }
    }

    // 3. Cache fresh content (uses admin client to bypass RLS)
    await this.cacheContent(freshContent);

    // 4. Combine, deduplicate, and return
    const allContent = [...cachedContent, ...freshContent];
    const unique = this.deduplicateContent(allContent);

    return {
      content: unique.slice(0, params.pageSize ?? 20),
      totalCount: unique.length,
      fromCache: false,
      fetchedNew: freshContent.length,
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

  private createProvider(
    source: Pick<
      ExternalSourceRow,
      'id' | 'provider_type' | 'credibility_tier'
    >,
  ): ExternalContextProvider | null {
    const tier = (source.credibility_tier ?? 'tier_3') as CredibilityTier;

    switch (source.provider_type) {
      case 'newsapi':
        return new NewsAPIProvider(source.id, tier);
      case 'semantic_scholar':
        return new SemanticScholarProvider(source.id, tier);
      case 'archive_org':
        return new ArchiveOrgProvider(source.id, tier);
      default:
        console.warn(
          `[context-aggregator] Unknown provider_type: ${source.provider_type}`,
        );
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

    let query = supabase
      .from('external_content')
      .select(
        'id, external_id, source_id, title, description, content, url, authors, published_at, language, category, topics, entities, doi, journal, citations, peer_reviewed, image_url, credibility_tier, bias_label, fetched_at, cache_expires_at',
      )
      .in('category', categories)
      .gt('cache_expires_at', new Date().toISOString())
      .order('published_at', { ascending: false });

    // Apply pagination via .range() (handles both page 1 and subsequent pages)
    const pageSize = params.pageSize ?? 20;
    const offset = ((params.page ?? 1) - 1) * pageSize;
    query = query.range(offset, offset + pageSize - 1);

    if (params.query) {
      query = query.textSearch('fts', params.query, { type: 'websearch' });
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

    return (data ?? []).map(rowToExternalContent);
  }

  /**
   * Write fetched content to the cache.
   * Uses the admin client to bypass RLS (only service_role can INSERT).
   */
  private async cacheContent(content: ExternalContent[]): Promise<number> {
    if (content.length === 0) return 0;

    const adminClient = getSupabaseServerAdminClient();

    const now = new Date().toISOString();
    const rows = content.map((c) => ({
      external_id: c.externalId,
      source_id: c.sourceId,
      title: c.title,
      description: c.description,
      content: c.content,
      url: c.url,
      authors: c.authors,
      published_at: c.publishedAt.toISOString(),
      updated_at: now,
      language: c.language,
      category: c.category,
      topics: c.topics,
      entities: {
        ...c.entities,
        extractedAt: c.entities.extractedAt.toISOString(),
      } as unknown as Json,
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

    const { data, error } = await adminClient
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
// SINGLETON
// =============================================================================

let aggregatorInstance: ExternalContextAggregator | null = null;

/**
 * Get the singleton ExternalContextAggregator instance.
 * Initializes on first call by loading active sources from the database.
 * Re-initializes automatically if the instance is stale (>5 minutes old).
 */
export async function getContextAggregator(): Promise<ExternalContextAggregator> {
  if (!aggregatorInstance || aggregatorInstance.isStale()) {
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
