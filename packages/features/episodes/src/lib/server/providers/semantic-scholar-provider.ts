/**
 * Semantic Scholar Provider
 * Phase 11: FILM-1135
 *
 * Fetches academic papers from Semantic Scholar API.
 * Free tier — no API key required (rate-limited to 100 req/5min).
 */
import { randomUUID } from 'node:crypto';

import { vendorUrl } from '@kit/shared/vendors';

import type {
  CredibilityTier,
  ExternalContent,
  ExternalSearchParams,
  SourceCategory,
} from '../../../types/external-context';
import { createEmptyEntities } from '../../../types/external-context';
import { BaseExternalProvider } from './base-provider';

interface SemanticScholarAuthor {
  authorId: string;
  name: string;
}

interface SemanticScholarExternalIds {
  DOI?: string;
  ArXiv?: string;
  PubMed?: string;
}

interface SemanticScholarPaper {
  paperId: string;
  title: string;
  abstract: string | null;
  authors: SemanticScholarAuthor[];
  year: number | null;
  venue: string | null;
  citationCount: number | null;
  externalIds: SemanticScholarExternalIds | null;
}

interface SemanticScholarResponse {
  total: number;
  data: SemanticScholarPaper[];
}

export class SemanticScholarProvider extends BaseExternalProvider {
  readonly name = 'Semantic Scholar';
  readonly category: SourceCategory = 'research';
  readonly sourceId: string;

  constructor(sourceId: string, credibilityTier: CredibilityTier = 'tier_1') {
    super(credibilityTier);
    this.sourceId = sourceId;
    this.cacheTTLHours = 168; // 7 days — research papers rarely change
  }

  async fetchContent(params: ExternalSearchParams): Promise<ExternalContent[]> {
    const url = new URL(
      `${vendorUrl('semantic-scholar')}/graph/v1/paper/search`,
    );
    url.searchParams.set('query', params.query);
    url.searchParams.set('limit', String(params.pageSize ?? 20));
    url.searchParams.set(
      'fields',
      'title,abstract,authors,year,venue,citationCount,externalIds',
    );

    if (params.page && params.page > 1) {
      url.searchParams.set(
        'offset',
        String((params.page - 1) * (params.pageSize ?? 20)),
      );
    }

    // AbortSignal.timeout requires Node 17.3+ / modern Edge runtimes
    const response = await fetch(url.toString(), {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      if (response.status === 429) {
        this.updateRateLimit(0, new Date(Date.now() + 300000)); // 5 min cooldown
      }
      throw new Error(
        `Semantic Scholar error: ${response.status}${response.statusText ? ' ' + response.statusText : ''}`,
      );
    }

    const data = (await response.json()) as SemanticScholarResponse;
    const cacheExpiry = this.getCacheExpiryDate();
    const now = new Date();

    return (data.data ?? []).map((paper) => ({
      id: randomUUID(), // Temporary client-side ID; replaced by DB on upsert
      externalId: `ss:${paper.paperId}`,
      sourceId: this.sourceId,
      title: paper.title,
      description: paper.abstract ?? '',
      content: paper.abstract,
      url: `https://www.semanticscholar.org/paper/${paper.paperId}`,
      authors: paper.authors.map((a) => a.name),
      publishedAt: paper.year ? new Date(`${paper.year}-01-01`) : new Date(0), // epoch = unknown date
      language: 'en',
      category: 'research',
      topics: [],
      entities: createEmptyEntities(),
      doi: paper.externalIds?.DOI,
      journal: paper.venue ?? undefined,
      citations: paper.citationCount ?? undefined,
      // Note: Not all Semantic Scholar results are peer-reviewed (e.g. ArXiv preprints).
      // Defaulting to true is a V1 simplification; refine with venue-based heuristics later.
      peerReviewed: true,
      credibilityTier: this.credibilityTier,
      fetchedAt: now,
      cacheExpiresAt: cacheExpiry,
    }));
  }
}
