/**
 * External Context Provider Types
 * Phase 11: FILM-1135
 *
 * Unified interface and data models for external data sources
 * (news, research papers, historical archives, etc.)
 */

// =============================================================================
// SOURCE CATEGORY
// =============================================================================

/** Content type categories for external sources */
export type SourceCategory =
    | 'news'          // Real-time news articles
    | 'research'      // Academic papers, journals
    | 'encyclopedia'  // Wikipedia, Britannica
    | 'historical'    // Archives, historical records
    | 'official'      // Government documents, reports
    | 'multimedia';   // Video transcripts, podcasts

/** Credibility tier for sources */
export type CredibilityTier = 'tier_1' | 'tier_2' | 'tier_3';

// =============================================================================
// EXTRACTED ENTITIES
// =============================================================================

/** Named entities extracted from content via NLP/LLM */
export interface ExtractedEntities {
    people: Array<{ name: string; role?: string }>;
    organizations: Array<{ name: string; type?: string }>;
    locations: Array<{ name: string; type: string }>;
    topics: string[];
    events: Array<{ name: string; date?: string }>;
    extractedAt: Date;
}

/** Default empty entities object */
export const EMPTY_ENTITIES: ExtractedEntities = {
    people: [],
    organizations: [],
    locations: [],
    topics: [],
    events: [],
    extractedAt: new Date(),
};

// =============================================================================
// EXTERNAL CONTENT
// =============================================================================

/** Unified external content data model */
export interface ExternalContent {
    id: string;
    externalId: string;      // Provider-specific ID
    sourceId: string;         // References external_sources.id

    // Core content
    title: string;
    description: string;
    content: string | null;   // Full text if available
    url: string;

    // Metadata
    authors: string[];
    publishedAt: Date;
    updatedAt?: Date;
    language: string;

    // Categorization
    category: SourceCategory;
    topics: string[];
    entities: ExtractedEntities;

    // Research/academic
    doi?: string;
    journal?: string;
    citations?: number;
    peerReviewed?: boolean;

    // News
    imageUrl?: string;

    // Verification
    credibilityTier: CredibilityTier;
    biasLabel?: string;

    // Cache metadata
    fetchedAt: Date;
    cacheExpiresAt: Date;
}

// =============================================================================
// SEARCH PARAMS
// =============================================================================

/** Search parameters for external content */
export interface ExternalSearchParams {
    query: string;
    category?: SourceCategory | SourceCategory[];
    from?: Date;
    to?: Date;
    sources?: string[];           // Filter by source IDs
    credibilityTier?: CredibilityTier;
    peerReviewedOnly?: boolean;   // For research
    language?: string;
    pageSize?: number;
    page?: number;
}

// =============================================================================
// RATE LIMITING
// =============================================================================

/** Rate limit tracking */
export interface RateLimitStatus {
    remaining: number;
    resetAt: Date;
    isLimited: boolean;
}

// =============================================================================
// PROVIDER INTERFACE
// =============================================================================

/** Unified provider interface for all external data sources */
export interface ExternalContextProvider {
    readonly name: string;
    readonly category: SourceCategory;
    readonly sourceId: string;

    /** Fetch content matching search parameters */
    fetchContent(params: ExternalSearchParams): Promise<ExternalContent[]>;

    /** Check if provider is configured and available */
    isAvailable(): boolean;

    /** Get rate limit status */
    getRateLimitStatus(): RateLimitStatus;

    /** Get default cache TTL for this provider (hours) */
    getCacheTTL(): number;
}

// =============================================================================
// AGGREGATOR TYPES
// =============================================================================

/** Result from the aggregator service */
export interface AggregatorSearchResult {
    content: ExternalContent[];
    totalCount: number;
    fromCache: boolean;
    fetchedNew: number;
    providers: string[];
}

// =============================================================================
// DATABASE ROW TYPES
// =============================================================================

/** Row shape from external_sources table */
export interface ExternalSourceRow {
    id: string;
    name: string;
    slug: string;
    description: string | null;
    website_url: string | null;
    logo_url: string | null;
    category: string;
    provider_type: string;
    api_endpoint: string | null;
    api_key_env: string | null;
    config: Record<string, unknown>;
    credibility_tier: string;
    bias_label: string | null;
    peer_reviewed: boolean;
    rate_limit_per_hour: number;
    current_usage: number;
    usage_reset_at: string | null;
    cache_ttl_hours: number;
    is_active: boolean;
    created_at: string;
    updated_at: string;
}

/** Row shape from external_content table */
export interface ExternalContentRow {
    id: string;
    external_id: string;
    source_id: string;
    title: string;
    description: string | null;
    content: string | null;
    url: string;
    authors: string[];
    published_at: string | null;
    updated_at: string | null;
    language: string;
    category: string;
    topics: string[];
    entities: Record<string, unknown>;
    doi: string | null;
    journal: string | null;
    citations: number | null;
    peer_reviewed: boolean;
    image_url: string | null;
    credibility_tier: string | null;
    bias_label: string | null;
    fetched_at: string;
    cache_expires_at: string | null;
}
