/**
 * NewsAPI Provider
 * Phase 11: FILM-1135
 *
 * Fetches news articles from NewsAPI.org.
 * Requires NEWSAPI_KEY environment variable.
 */

import { BaseExternalProvider } from './base-provider';
import type {
    ExternalSearchParams,
    ExternalContent,
    SourceCategory,
} from '../../../types/external-context';
import { createEmptyEntities } from '../../../types/external-context';
import { createHash } from 'node:crypto';

interface NewsAPIArticle {
    source: { id: string | null; name: string };
    author: string | null;
    title: string;
    description: string | null;
    url: string;
    urlToImage: string | null;
    publishedAt: string;
    content: string | null;
}

interface NewsAPIResponse {
    status: string;
    totalResults: number;
    articles: NewsAPIArticle[];
}

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
        if (!this.apiKey) {
            throw new Error('NewsAPI key not configured (NEWSAPI_KEY)');
        }

        const url = new URL('https://newsapi.org/v2/everything');
        url.searchParams.set('q', params.query);
        url.searchParams.set('pageSize', String(params.pageSize ?? 20));
        url.searchParams.set('sortBy', 'relevancy');

        if (params.from) {
            url.searchParams.set('from', params.from.toISOString().split('T')[0]!);
        }
        if (params.to) {
            url.searchParams.set('to', params.to.toISOString().split('T')[0]!);
        }
        if (params.language) {
            url.searchParams.set('language', params.language);
        }

        const response = await fetch(url.toString(), {
            headers: { 'X-Api-Key': this.apiKey },
            signal: AbortSignal.timeout(10_000),
        });

        if (!response.ok) {
            if (response.status === 429) {
                this.updateRateLimit(0, new Date(Date.now() + 3600000));
            }
            throw new Error(`NewsAPI error: ${response.status} ${response.statusText}`);
        }

        const data = (await response.json()) as NewsAPIResponse;
        const cacheExpiry = this.getCacheExpiryDate();
        const now = new Date();

        return data.articles.map((article) => ({
            id: '', // Set by cache manager on insert
            externalId: this.generateExternalId(article.url),
            sourceId: this.sourceId,
            title: article.title,
            description: article.description ?? '',
            content: article.content,
            url: article.url,
            authors: article.author ? [article.author] : [],
            publishedAt: new Date(article.publishedAt),
            language: params.language ?? 'en',
            category: 'news',
            topics: [],
            entities: createEmptyEntities(),
            imageUrl: article.urlToImage ?? undefined,
            credibilityTier: 'tier_2',
            fetchedAt: now,
            cacheExpiresAt: cacheExpiry,
        }));
    }

    private generateExternalId(url: string): string {
        const hash = createHash('sha256').update(url).digest('hex');
        return `newsapi:${hash}`;
    }
}
