/**
 * Semantic Scholar Provider
 * Phase 11: FILM-1135
 *
 * Fetches academic papers from Semantic Scholar API.
 * Free tier — no API key required (rate-limited to 100 req/5min).
 */

import { BaseExternalProvider } from './base-provider';
import type {
    ExternalSearchParams,
    ExternalContent,
    SourceCategory,
} from '../../../types/external-context';
import { createEmptyEntities } from '../../../types/external-context';

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

    constructor(sourceId: string) {
        super();
        this.sourceId = sourceId;
        this.cacheTTLHours = 168; // 7 days — research papers rarely change
    }

    async fetchContent(params: ExternalSearchParams): Promise<ExternalContent[]> {
        const url = new URL('https://api.semanticscholar.org/graph/v1/paper/search');
        url.searchParams.set('query', params.query);
        url.searchParams.set('limit', String(params.pageSize ?? 20));
        url.searchParams.set(
            'fields',
            'title,abstract,authors,year,venue,citationCount,externalIds',
        );

        if (params.page && params.page > 1) {
            url.searchParams.set('offset', String((params.page - 1) * (params.pageSize ?? 20)));
        }

        const response = await fetch(url.toString(), {
            headers: { Accept: 'application/json' },
            signal: AbortSignal.timeout(10_000),
        });

        if (!response.ok) {
            if (response.status === 429) {
                this.updateRateLimit(0, new Date(Date.now() + 300000)); // 5 min cooldown
            }
            throw new Error(`Semantic Scholar error: ${response.status} ${response.statusText}`);
        }

        const data = (await response.json()) as SemanticScholarResponse;
        const cacheExpiry = this.getCacheExpiryDate();
        const now = new Date();

        return (data.data ?? []).map((paper) => ({
            id: '',
            externalId: `ss:${paper.paperId}`,
            sourceId: this.sourceId,
            title: paper.title,
            description: paper.abstract ?? '',
            content: paper.abstract,
            url: `https://www.semanticscholar.org/paper/${paper.paperId}`,
            authors: paper.authors.map((a) => a.name),
            publishedAt: paper.year ? new Date(`${paper.year}-01-01`) : new Date(),
            language: 'en',
            category: 'research',
            topics: [],
            entities: createEmptyEntities(),
            doi: paper.externalIds?.DOI,
            journal: paper.venue ?? undefined,
            citations: paper.citationCount ?? undefined,
            peerReviewed: true,
            credibilityTier: 'tier_1',
            fetchedAt: now,
            cacheExpiresAt: cacheExpiry,
        }));
    }
}
