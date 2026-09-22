---
id: FILM-1135
title: External Context Provider Interface
status: 🟡 PARTIAL
audited: 2026-09-23
priority: high
effort: L
dependencies: []
branch: feature/FILM-1135-external-context-provider
commits: 8
---

# FILM-1135: External Context Provider Interface

## Overview

Create a unified `ExternalContextProvider` interface that abstracts external data sources for all content types. This allows the same architecture to work for news feeds, research papers, historical archives, encyclopedias, and other sources.

## Problem Statement

Current design has:
- `NewsProvider` for NEWS content type
- No abstraction for DOCUMENTARY research sources
- No abstraction for historical archives
- Each content type would need its own provider implementation

This leads to:
- Code duplication across provider types
- Inconsistent caching strategies
- Difficult to add new source types

## Solution

Create a unified `ExternalContextProvider` interface with:
- Common data model (`ExternalContent`)
- Source registry (`external_sources` table)
- Unified cache (`external_content` table)
- Content-type-aware aggregator service

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                   ExternalContextAggregator                     │
│  - Routes requests to appropriate providers                     │
│  - Manages caching layer                                        │
│  - Handles rate limiting                                        │
└─────────────────────────────────────────────────────────────────┘
                              │
     ┌────────────────────────┼────────────────────────┐
     ▼                        ▼                        ▼
┌─────────────┐        ┌─────────────┐         ┌─────────────┐
│ NewsProvider│        │ResearchPaper│         │Historical   │
│             │        │  Provider   │         │Archive Prov │
└─────────────┘        └─────────────┘         └─────────────┘
     │                        │                        │
     ▼                        ▼                        ▼
┌─────────────┐        ┌─────────────┐         ┌─────────────┐
│ NewsAPI     │        │ Semantic    │         │ Archive.org │
│ RSS Feeds   │        │ Scholar     │         │ JSTOR       │
│ Google News │        │ PubMed      │         │ Newspapers  │
└─────────────┘        │ CrossRef    │         └─────────────┘
                       └─────────────┘
```

---

## Unified Interface

### ExternalContextProvider Interface

```typescript
// packages/features/episodes/src/types/external-context.ts

/**
 * Content type categories for external sources
 */
export type SourceCategory =
  | 'news'           // Real-time news articles
  | 'research'       // Academic papers, journals
  | 'encyclopedia'   // Wikipedia, Britannica
  | 'historical'     // Archives, historical records
  | 'official'       // Government documents, reports
  | 'multimedia';    // Video transcripts, podcasts

/**
 * Unified external content data model
 */
export interface ExternalContent {
  id: string;
  externalId: string;           // Provider-specific ID
  sourceId: string;             // References external_sources.id
  
  // Core content
  title: string;
  description: string;
  content: string | null;        // Full text if available
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
  
  // For research/academic
  doi?: string;
  journal?: string;
  citations?: number;
  peerReviewed?: boolean;
  
  // For news
  imageUrl?: string;
  
  // Verification
  credibilityTier: 'tier_1' | 'tier_2' | 'tier_3';
  biasLabel?: string;
  
  // Cache metadata
  fetchedAt: Date;
  cacheExpiresAt: Date;
}

/**
 * Search parameters for external content
 */
export interface ExternalSearchParams {
  query: string;
  category?: SourceCategory | SourceCategory[];
  from?: Date;
  to?: Date;
  sources?: string[];           // Filter by source IDs
  credibilityTier?: 'tier_1' | 'tier_2' | 'tier_3';
  peerReviewedOnly?: boolean;   // For research
  language?: string;
  pageSize?: number;
  page?: number;
}

/**
 * Unified provider interface
 */
export interface ExternalContextProvider {
  readonly name: string;
  readonly category: SourceCategory;
  readonly sourceId: string;
  
  /**
   * Fetch content matching search parameters
   */
  fetchContent(params: ExternalSearchParams): Promise<ExternalContent[]>;
  
  /**
   * Check if provider is configured and available
   */
  isAvailable(): boolean;
  
  /**
   * Get rate limit status
   */
  getRateLimitStatus(): RateLimitStatus;
  
  /**
   * Get default cache TTL for this provider (hours)
   */
  getCacheTTL(): number;
}

/**
 * Rate limit tracking
 */
export interface RateLimitStatus {
  remaining: number;
  resetAt: Date;
  isLimited: boolean;
}

/**
 * Extracted named entities
 */
export interface ExtractedEntities {
  people: Array<{ name: string; role?: string }>;
  organizations: Array<{ name: string; type?: string }>;
  locations: Array<{ name: string; type: string }>;
  topics: string[];
  events: Array<{ name: string; date?: string }>;
  extractedAt: Date;
}
```

---

## Database Schema

### Migration: Unified External Sources

```sql
-- Migration: create_external_sources_table

-- Drop old news-specific tables if they exist
-- (Migration compatibility - production would need data migration)

-- Create unified source registry
CREATE TABLE IF NOT EXISTS external_sources (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  
  -- Source identity
  name VARCHAR(200) NOT NULL,
  slug VARCHAR(100) NOT NULL UNIQUE,
  description TEXT,
  website_url TEXT,
  logo_url TEXT,
  
  -- Categorization
  category VARCHAR(50) NOT NULL CHECK (category IN (
    'news', 'research', 'encyclopedia', 'historical', 'official', 'multimedia'
  )),
  
  -- API configuration
  provider_type VARCHAR(50) NOT NULL, -- 'newsapi', 'semantic_scholar', 'crossref', etc.
  api_endpoint TEXT,
  api_key_env VARCHAR(100),           -- Environment variable name for API key
  config JSONB DEFAULT '{}',          -- Provider-specific configuration
  
  -- Credibility
  credibility_tier VARCHAR(20) DEFAULT 'tier_3' CHECK (
    credibility_tier IN ('tier_1', 'tier_2', 'tier_3')
  ),
  bias_label VARCHAR(50),
  peer_reviewed BOOLEAN DEFAULT false,
  
  -- Rate limiting
  rate_limit_per_hour INTEGER DEFAULT 100,
  current_usage INTEGER DEFAULT 0,
  usage_reset_at TIMESTAMPTZ,
  
  -- Cache settings
  cache_ttl_hours INTEGER DEFAULT 24,
  
  -- Status
  is_active BOOLEAN DEFAULT true,
  
  -- Audit
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Create unified content cache
CREATE TABLE IF NOT EXISTS external_content (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  
  -- Source reference
  external_id VARCHAR(500) NOT NULL,
  source_id UUID REFERENCES external_sources(id) ON DELETE CASCADE NOT NULL,
  
  -- Core content
  title TEXT NOT NULL,
  description TEXT,
  content TEXT,
  url TEXT NOT NULL,
  
  -- Metadata
  authors TEXT[] DEFAULT '{}',
  published_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ,
  language VARCHAR(10) DEFAULT 'en',
  
  -- Categorization (denormalized for performance)
  category VARCHAR(50) NOT NULL,
  topics TEXT[] DEFAULT '{}',
  entities JSONB DEFAULT '{}',
  
  -- Research-specific
  doi VARCHAR(100),
  journal VARCHAR(300),
  citations INTEGER,
  peer_reviewed BOOLEAN DEFAULT false,
  
  -- News-specific
  image_url TEXT,
  
  -- Credibility (denormalized)
  credibility_tier VARCHAR(20),
  bias_label VARCHAR(50),
  
  -- Cache management
  fetched_at TIMESTAMPTZ DEFAULT now(),
  cache_expires_at TIMESTAMPTZ,
  
  -- Unique constraint
  CONSTRAINT uq_external_content_external_id UNIQUE (external_id)
);

-- Indexes
CREATE INDEX idx_external_sources_category ON external_sources(category, is_active);
CREATE INDEX idx_external_content_source ON external_content(source_id);
CREATE INDEX idx_external_content_category ON external_content(category);
CREATE INDEX idx_external_content_published ON external_content(published_at DESC);
CREATE INDEX idx_external_content_topics ON external_content USING GIN(topics);
CREATE INDEX idx_external_content_entities ON external_content USING GIN(entities);
CREATE INDEX idx_external_content_cache ON external_content(cache_expires_at);

-- Full-text search
CREATE INDEX idx_external_content_fts ON external_content 
  USING GIN(to_tsvector('english', title || ' ' || COALESCE(description, '')));

-- RLS
ALTER TABLE external_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE external_content ENABLE ROW LEVEL SECURITY;

-- Public read access for sources (metadata only)
CREATE POLICY "Anyone can view active sources"
  ON external_sources FOR SELECT
  USING (is_active = true);

-- Content is accessible to authenticated users
CREATE POLICY "Authenticated users can view content"
  ON external_content FOR SELECT
  TO authenticated
  USING (true);
```

---

## Provider Implementations

### Base Provider Class

```typescript
// packages/features/episodes/src/lib/server/providers/base-provider.ts

import type { 
  ExternalContextProvider, 
  ExternalSearchParams, 
  ExternalContent,
  RateLimitStatus,
  SourceCategory 
} from '../../types/external-context';

export abstract class BaseExternalProvider implements ExternalContextProvider {
  abstract readonly name: string;
  abstract readonly category: SourceCategory;
  abstract readonly sourceId: string;
  
  protected rateLimitRemaining = 100;
  protected rateLimitResetAt = new Date();
  protected cacheTTLHours = 24;

  abstract fetchContent(params: ExternalSearchParams): Promise<ExternalContent[]>;

  isAvailable(): boolean {
    return !this.getRateLimitStatus().isLimited;
  }

  getRateLimitStatus(): RateLimitStatus {
    return {
      remaining: this.rateLimitRemaining,
      resetAt: this.rateLimitResetAt,
      isLimited: this.rateLimitRemaining <= 0 && this.rateLimitResetAt > new Date(),
    };
  }

  getCacheTTL(): number {
    return this.cacheTTLHours;
  }

  protected updateRateLimit(remaining: number, resetAt?: Date): void {
    this.rateLimitRemaining = remaining;
    if (resetAt) {
      this.rateLimitResetAt = resetAt;
    }
  }

  protected mapToExternalContent(raw: Record<string, unknown>): Partial<ExternalContent> {
    // Subclasses override for provider-specific mapping
    return {};
  }
}
```

### News Provider

```typescript
// packages/features/episodes/src/lib/server/providers/news/newsapi-provider.ts

import { BaseExternalProvider } from '../base-provider';
import type { ExternalSearchParams, ExternalContent, SourceCategory } from '../../../types/external-context';

export class NewsAPIProvider extends BaseExternalProvider {
  readonly name = 'NewsAPI';
  readonly category: SourceCategory = 'news';
  readonly sourceId: string;

  private apiKey: string | null;

  constructor(sourceId: string) {
    super();
    this.sourceId = sourceId;
    this.apiKey = process.env.NEWSAPI_KEY ?? null;
    this.cacheTTLHours = 6; // News expires faster
  }

  isAvailable(): boolean {
    return this.apiKey !== null && super.isAvailable();
  }

  async fetchContent(params: ExternalSearchParams): Promise<ExternalContent[]> {
    if (!this.apiKey) throw new Error('NewsAPI key not configured');

    const url = new URL('https://newsapi.org/v2/everything');
    url.searchParams.set('q', params.query);
    url.searchParams.set('pageSize', String(params.pageSize ?? 20));

    const response = await fetch(url.toString(), {
      headers: { 'X-Api-Key': this.apiKey },
    });

    if (!response.ok) {
      if (response.status === 429) {
        this.updateRateLimit(0, new Date(Date.now() + 3600000));
      }
      throw new Error(`NewsAPI error: ${response.statusText}`);
    }

    const data = await response.json();

    return data.articles.map((article: Record<string, unknown>) => ({
      id: '', // Will be set by cache manager
      externalId: this.generateExternalId(article.url as string),
      sourceId: this.sourceId,
      title: article.title as string,
      description: article.description as string ?? '',
      content: article.content as string | null,
      url: article.url as string,
      authors: article.author ? [article.author as string] : [],
      publishedAt: new Date(article.publishedAt as string),
      language: 'en',
      category: 'news' as SourceCategory,
      topics: [],
      entities: { people: [], organizations: [], locations: [], topics: [], events: [], extractedAt: new Date() },
      imageUrl: article.urlToImage as string | null,
      credibilityTier: 'tier_2',
      fetchedAt: new Date(),
      cacheExpiresAt: new Date(Date.now() + this.cacheTTLHours * 3600000),
    }));
  }

  private generateExternalId(url: string): string {
    return `newsapi:${Buffer.from(url).toString('base64url').slice(0, 32)}`;
  }
}
```

### Research Paper Provider

```typescript
// packages/features/episodes/src/lib/server/providers/research/semantic-scholar-provider.ts

import { BaseExternalProvider } from '../base-provider';
import type { ExternalSearchParams, ExternalContent, SourceCategory } from '../../../types/external-context';

export class SemanticScholarProvider extends BaseExternalProvider {
  readonly name = 'Semantic Scholar';
  readonly category: SourceCategory = 'research';
  readonly sourceId: string;

  constructor(sourceId: string) {
    super();
    this.sourceId = sourceId;
    this.cacheTTLHours = 168; // Research papers don't change - 7 days
  }

  async fetchContent(params: ExternalSearchParams): Promise<ExternalContent[]> {
    const url = new URL('https://api.semanticscholar.org/graph/v1/paper/search');
    url.searchParams.set('query', params.query);
    url.searchParams.set('limit', String(params.pageSize ?? 20));
    url.searchParams.set('fields', 'title,abstract,authors,year,venue,citationCount,externalIds');

    const response = await fetch(url.toString(), {
      headers: { 'Accept': 'application/json' },
    });

    if (!response.ok) {
      throw new Error(`Semantic Scholar error: ${response.statusText}`);
    }

    const data = await response.json();

    return (data.data ?? []).map((paper: Record<string, unknown>) => ({
      id: '',
      externalId: `ss:${paper.paperId}`,
      sourceId: this.sourceId,
      title: paper.title as string,
      description: paper.abstract as string ?? '',
      content: paper.abstract as string | null,
      url: `https://www.semanticscholar.org/paper/${paper.paperId}`,
      authors: ((paper.authors as Array<{ name: string }>) ?? []).map(a => a.name),
      publishedAt: new Date(`${paper.year}-01-01`),
      language: 'en',
      category: 'research' as SourceCategory,
      topics: [],
      entities: { people: [], organizations: [], locations: [], topics: [], events: [], extractedAt: new Date() },
      doi: (paper.externalIds as Record<string, string>)?.DOI,
      journal: paper.venue as string | undefined,
      citations: paper.citationCount as number,
      peerReviewed: true,
      credibilityTier: 'tier_1',
      fetchedAt: new Date(),
      cacheExpiresAt: new Date(Date.now() + this.cacheTTLHours * 3600000),
    }));
  }
}
```

### Historical Archive Provider

```typescript
// packages/features/episodes/src/lib/server/providers/historical/archive-org-provider.ts

import { BaseExternalProvider } from '../base-provider';
import type { ExternalSearchParams, ExternalContent, SourceCategory } from '../../../types/external-context';

export class ArchiveOrgProvider extends BaseExternalProvider {
  readonly name = 'Internet Archive';
  readonly category: SourceCategory = 'historical';
  readonly sourceId: string;

  constructor(sourceId: string) {
    super();
    this.sourceId = sourceId;
    this.cacheTTLHours = 720; // Historical content doesn't change - 30 days
  }

  async fetchContent(params: ExternalSearchParams): Promise<ExternalContent[]> {
    const url = new URL('https://archive.org/advancedsearch.php');
    url.searchParams.set('q', params.query);
    url.searchParams.set('output', 'json');
    url.searchParams.set('rows', String(params.pageSize ?? 20));

    const response = await fetch(url.toString());

    if (!response.ok) {
      throw new Error(`Archive.org error: ${response.statusText}`);
    }

    const data = await response.json();

    return (data.response?.docs ?? []).map((doc: Record<string, unknown>) => ({
      id: '',
      externalId: `archive:${doc.identifier}`,
      sourceId: this.sourceId,
      title: doc.title as string,
      description: doc.description as string ?? '',
      content: null,
      url: `https://archive.org/details/${doc.identifier}`,
      authors: doc.creator ? [doc.creator as string] : [],
      publishedAt: doc.date ? new Date(doc.date as string) : new Date(),
      language: (doc.language as string) ?? 'en',
      category: 'historical' as SourceCategory,
      topics: [],
      entities: { people: [], organizations: [], locations: [], topics: [], events: [], extractedAt: new Date() },
      credibilityTier: 'tier_2',
      fetchedAt: new Date(),
      cacheExpiresAt: new Date(Date.now() + this.cacheTTLHours * 3600000),
    }));
  }
}
```

---

## Context Aggregator Service

```typescript
// packages/features/episodes/src/lib/server/services/context-aggregator.ts

import { getSupabaseServerClient } from '@kit/supabase/server-client';
import type { ExternalContextProvider, ExternalSearchParams, ExternalContent, SourceCategory } from '../../types/external-context';
import { NewsAPIProvider } from '../providers/news/newsapi-provider';
import { SemanticScholarProvider } from '../providers/research/semantic-scholar-provider';
import { ArchiveOrgProvider } from '../providers/historical/archive-org-provider';

interface AggregatorSearchResult {
  content: ExternalContent[];
  totalCount: number;
  fromCache: boolean;
  fetchedNew: number;
  providers: string[];
}

export class ExternalContextAggregator {
  private providers: Map<string, ExternalContextProvider> = new Map();
  private providersByCategory: Map<SourceCategory, ExternalContextProvider[]> = new Map();

  async initialize(): Promise<void> {
    const supabase = await getSupabaseServerClient();

    const { data: sources } = await supabase
      .from('external_sources')
      .select('*')
      .eq('is_active', true);

    for (const source of sources ?? []) {
      const provider = this.createProvider(source);
      if (provider) {
        this.providers.set(source.id, provider);
        
        const categoryProviders = this.providersByCategory.get(source.category) ?? [];
        categoryProviders.push(provider);
        this.providersByCategory.set(source.category, categoryProviders);
      }
    }
  }

  private createProvider(source: Record<string, unknown>): ExternalContextProvider | null {
    switch (source.provider_type) {
      case 'newsapi':
        return new NewsAPIProvider(source.id as string);
      case 'semantic_scholar':
        return new SemanticScholarProvider(source.id as string);
      case 'archive_org':
        return new ArchiveOrgProvider(source.id as string);
      default:
        return null;
    }
  }

  async search(params: ExternalSearchParams): Promise<AggregatorSearchResult> {
    // Determine which categories to search
    const categories = Array.isArray(params.category) 
      ? params.category 
      : params.category 
        ? [params.category] 
        : Array.from(this.providersByCategory.keys());

    // Search cache first
    const cachedContent = await this.searchCache(params, categories);
    
    if (cachedContent.length >= (params.pageSize ?? 20)) {
      return {
        content: cachedContent,
        totalCount: cachedContent.length,
        fromCache: true,
        fetchedNew: 0,
        providers: [],
      };
    }

    // Fetch from providers
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
        } catch (error) {
          console.error(`Provider ${provider.name} failed:`, error);
        }
      }
    }

    // Cache fresh content
    const cachedCount = await this.cacheContent(freshContent);

    // Return combined results
    const allContent = [...cachedContent, ...freshContent];
    const uniqueContent = this.deduplicateContent(allContent);

    return {
      content: uniqueContent.slice(0, params.pageSize ?? 20),
      totalCount: uniqueContent.length,
      fromCache: false,
      fetchedNew: cachedCount,
      providers: usedProviders,
    };
  }

  private async searchCache(
    params: ExternalSearchParams, 
    categories: SourceCategory[]
  ): Promise<ExternalContent[]> {
    const supabase = await getSupabaseServerClient();

    let query = supabase
      .from('external_content')
      .select('*, external_sources!inner(*)')
      .in('category', categories)
      .gt('cache_expires_at', new Date().toISOString())
      .order('published_at', { ascending: false })
      .limit(params.pageSize ?? 20);

    if (params.query) {
      query = query.textSearch('title', params.query);
    }

    const { data } = await query;
    return (data ?? []).map(this.rowToExternalContent);
  }

  private async cacheContent(content: ExternalContent[]): Promise<number> {
    if (content.length === 0) return 0;

    const supabase = await getSupabaseServerClient();
    
    const { data, error } = await supabase
      .from('external_content')
      .upsert(
        content.map(c => ({
          external_id: c.externalId,
          source_id: c.sourceId,
          title: c.title,
          description: c.description,
          content: c.content,
          url: c.url,
          authors: c.authors,
          published_at: c.publishedAt.toISOString(),
          language: c.language,
          category: c.category,
          topics: c.topics,
          entities: c.entities,
          doi: c.doi,
          journal: c.journal,
          citations: c.citations,
          peer_reviewed: c.peerReviewed,
          image_url: c.imageUrl,
          credibility_tier: c.credibilityTier,
          fetched_at: c.fetchedAt.toISOString(),
          cache_expires_at: c.cacheExpiresAt.toISOString(),
        })),
        { onConflict: 'external_id' }
      )
      .select('id');

    return data?.length ?? 0;
  }

  private deduplicateContent(content: ExternalContent[]): ExternalContent[] {
    const seen = new Set<string>();
    return content.filter(c => {
      if (seen.has(c.externalId)) return false;
      seen.add(c.externalId);
      return true;
    });
  }

  private rowToExternalContent(row: Record<string, unknown>): ExternalContent {
    return {
      id: row.id as string,
      externalId: row.external_id as string,
      sourceId: row.source_id as string,
      title: row.title as string,
      description: row.description as string,
      content: row.content as string | null,
      url: row.url as string,
      authors: row.authors as string[],
      publishedAt: new Date(row.published_at as string),
      language: row.language as string,
      category: row.category as SourceCategory,
      topics: row.topics as string[],
      entities: row.entities as ExternalContent['entities'],
      doi: row.doi as string | undefined,
      journal: row.journal as string | undefined,
      citations: row.citations as number | undefined,
      peerReviewed: row.peer_reviewed as boolean | undefined,
      imageUrl: row.image_url as string | undefined,
      credibilityTier: row.credibility_tier as 'tier_1' | 'tier_2' | 'tier_3',
      biasLabel: row.bias_label as string | undefined,
      fetchedAt: new Date(row.fetched_at as string),
      cacheExpiresAt: new Date(row.cache_expires_at as string),
    };
  }
}

// Singleton
let aggregatorInstance: ExternalContextAggregator | null = null;

export async function getContextAggregator(): Promise<ExternalContextAggregator> {
  if (!aggregatorInstance) {
    aggregatorInstance = new ExternalContextAggregator();
    await aggregatorInstance.initialize();
  }
  return aggregatorInstance;
}
```

---

## Content Type Integration

Update memory strategies to use the unified provider:

```typescript
// Addition to memory-strategies.ts

/**
 * Get external content requirements per content type
 */
export function getExternalContentRequirements(contentType: ContentType): {
  categories: SourceCategory[];
  requiresPeerReview: boolean;
  minCredibilityTier: 'tier_1' | 'tier_2' | 'tier_3';
} {
  switch (contentType) {
    case 'DOCUMENTARY':
      return {
        categories: ['research', 'encyclopedia', 'official'],
        requiresPeerReview: true,
        minCredibilityTier: 'tier_1',
      };
    case 'NEWS':
      return {
        categories: ['news'],
        requiresPeerReview: false,
        minCredibilityTier: 'tier_2',
      };
    case 'MOVIE':
    case 'MOVIE_SEQUEL':
    case 'SERIES_HARD':
    case 'SERIES_EPISODIC':
    default:
      return {
        categories: [],
        requiresPeerReview: false,
        minCredibilityTier: 'tier_3',
      };
  }
}
```

---

## Acceptance Criteria

- [x] `ExternalContextProvider` interface defined with all methods — `types/external-context.ts`
- [x] `ExternalContent` unified data model created — `types/external-context.ts`
- [x] `external_sources` table created — migration `20260211200000`
- [x] `external_content` table created — migration `20260211200000`
- [x] `NewsAPIProvider` implements interface — `providers/newsapi-provider.ts`
- [x] `SemanticScholarProvider` implements interface — `providers/semantic-scholar-provider.ts`
- [x] `ArchiveOrgProvider` implements interface — `providers/archive-org-provider.ts`
- [x] `ExternalContextAggregator` routes to correct providers — `services/context-aggregator.ts`
- [x] Cache TTL varies by content type (6h news, 168h research, 720h historical)
- [ ] Content types correctly map to provider categories — *audit: no longer true* — no mapping exists (`getExternalContentRequirements` never in git history); `requiresExternalContext` only feeds `includeSources` (`packages/features/episodes/src/lib/canon/memory-strategies.ts:222`), read only by tests
- [ ] RLS policies protect data access — authenticated read, admin write for cache — *audit: no longer true* — private uploads now land here (`packages/features/episodes/src/server/source-upload-actions.ts:101`); the read policy is `USING (true)` for every signed-in user — reproduced as KB-26
- [x] Full-text search works on cached content — generated `fts` tsvector + GIN index (migration `20260211200001`)

---

## Testing

### Unit Tests

```typescript
describe('ExternalContextProvider', () => {
  it('NewsAPIProvider should implement interface', () => {
    const provider = new NewsAPIProvider('source-id');
    expect(provider.category).toBe('news');
    expect(provider.getCacheTTL()).toBe(6);
  });

  it('SemanticScholarProvider should implement interface', () => {
    const provider = new SemanticScholarProvider('source-id');
    expect(provider.category).toBe('research');
    expect(provider.getCacheTTL()).toBe(168); // 7 days
  });

  it('ArchiveOrgProvider should implement interface', () => {
    const provider = new ArchiveOrgProvider('source-id');
    expect(provider.category).toBe('historical');
    expect(provider.getCacheTTL()).toBe(720); // 30 days
  });
});

describe('ExternalContextAggregator', () => {
  it('should route to correct providers by category', async () => {
    const aggregator = await getContextAggregator();
    
    const newsResults = await aggregator.search({
      query: 'climate change',
      category: 'news',
    });
    
    expect(newsResults.providers.some(p => p.includes('News'))).toBe(true);
  });

  it('should search multiple categories', async () => {
    const aggregator = await getContextAggregator();
    
    const results = await aggregator.search({
      query: 'black holes',
      category: ['news', 'research'],
    });
    
    expect(results.content.length).toBeGreaterThan(0);
  });
});
```

---

## Estimated Effort

| Task | Time |
|------|------|
| Interface and types | 2 hours |
| Database migration | 1 hour |
| Base provider class | 1 hour |
| NewsAPI provider | 2 hours |
| Semantic Scholar provider | 2 hours |
| Archive.org provider | 2 hours |
| Aggregator service | 3 hours |
| Content type integration | 1 hour |
| Testing | 3 hours |
| **Total** | **~17 hours** (L) |

---

## Dependencies

- None (foundational architecture)

## Blocks

- **FILM-1130**: Update to use `external_sources` table
- **FILM-1131**: Update to use `external_content` table
- **FILM-1132**: Update to use `ExternalContextAggregator`
- **FILM-1120**: Integrate with research providers for fact verification

## Remaining (audit 2026-09-23)

| Criterion | Why it is open | Closed by |
|---|---|---|
| Content types correctly map to provider categories | The `getExternalContentRequirements` mapping in "Content Type Integration" was never written (no match in code or `git log -S`). `CONTENT_TYPE_CONFIGS` has only a `requiresExternalContext` boolean (`packages/features/episodes/src/lib/canon/content-type-configs.ts:128`), which names no categories; it feeds `includeSources` in `getMemoryOptionsForContentType` (`packages/features/episodes/src/lib/canon/memory-strategies.ts:222`), which only tests read. Callers pass a category by hand | unassigned |
| RLS policies protect data access — authenticated read, admin write for cache | The policies are as designed: `external_content` SELECT is `TO authenticated USING (true)` (`apps/web/supabase/migrations/20260211200000_create_external_context_tables.sql:150`). But FILM-1141's upload now writes a user's uploaded document text into this table with no project or account column (`packages/features/episodes/src/server/source-upload-actions.ts:101`), so any signed-in user of any account can select it — reproduced by the coordinator in a rolled-back transaction | KB-26 |
