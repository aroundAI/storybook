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

/** Create a default empty entities object with current timestamp. */
export function createEmptyEntities(): ExtractedEntities {
    return {
        people: [],
        organizations: [],
        locations: [],
        topics: [],
        events: [],
        extractedAt: new Date(),
    };
}

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
// DATABASE ROW TYPES (derived from generated Supabase types)
// =============================================================================

import type { Database } from '@kit/supabase/database';

/** Row shape from external_sources table — auto-derived from generated types. */
export type ExternalSourceRow =
    Database['public']['Tables']['external_sources']['Row'];

/** Row shape from external_content table — auto-derived from generated types. */
export type ExternalContentRow =
    Database['public']['Tables']['external_content']['Row'];
