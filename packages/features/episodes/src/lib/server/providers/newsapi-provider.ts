/**
 * NewsAPI Provider
 * Phase 11: FILM-1135
 *
 * Fetches news articles from NewsAPI.org.
 * Requires NEWSAPI_KEY environment variable.
 */
import { createHash, randomUUID } from 'node:crypto';

import { vendorUrl } from '@kit/shared/vendors';

import type {
  CredibilityTier,
  ExternalContent,
  ExternalSearchParams,
  SourceCategory,
} from '../../../types/external-context';
import { createEmptyEntities } from '../../../types/external-context';
import { BaseExternalProvider } from './base-provider';

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

/** One `external_sources` row NewsAPI serves, by NewsAPI's own source id. */
export interface NewsAPISource {
  /** The `external_sources` row id. */
  id: string;
  /** NewsAPI's id for it (`config.source_id`), e.g. `reuters`. */
  newsapiId: string;
  credibilityTier: CredibilityTier;
}

/**
 * Every NewsAPI source in one provider (KB-125). A search is one request
 * with `sources=` listing them all, and each article is credited to the row
 * whose NewsAPI id it carries, at that row's tier. It used to be one
 * provider per row, each asking NewsAPI the same unfiltered question and
 * each claiming every answer.
 */
export class NewsAPIProvider extends BaseExternalProvider {
  readonly name = 'NewsAPI';
  readonly category: SourceCategory = 'news';
  /** The provider, not a row: articles carry their own row's id. */
  readonly sourceId = 'newsapi';

  private apiKey: string | null;
  private readonly byNewsapiId: Map<string, NewsAPISource>;

  constructor(sources: NewsAPISource[]) {
    super();
    this.byNewsapiId = new Map(sources.map((s) => [s.newsapiId, s]));
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

    if (this.byNewsapiId.size === 0) return [];

    const url = new URL(`${vendorUrl('newsapi')}/v2/everything`);
    url.searchParams.set('q', params.query);
    url.searchParams.set('sources', [...this.byNewsapiId.keys()].join(','));
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

    // AbortSignal.timeout requires Node 17.3+ / modern Edge runtimes
    const response = await fetch(url.toString(), {
      headers: { 'X-Api-Key': this.apiKey },
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      if (response.status === 429) {
        this.updateRateLimit(0, new Date(Date.now() + 3600000));
      }
      throw new Error(
        `NewsAPI error: ${response.status}${response.statusText ? ' ' + response.statusText : ''}`,
      );
    }

    const data = (await response.json()) as NewsAPIResponse;

    // An article from a source not asked for cannot be credited, so it is
    // dropped rather than attributed to a guess.
    return data.articles.flatMap((article) => {
      const source = article.source.id
        ? this.byNewsapiId.get(article.source.id)
        : undefined;
      return source ? [this.toContent(article, source, params)] : [];
    });
  }

  private toContent(
    article: NewsAPIArticle,
    source: NewsAPISource,
    params: ExternalSearchParams,
  ): ExternalContent {
    const cacheExpiry = this.getCacheExpiryDate();
    const now = new Date();

    return {
      id: randomUUID(), // Temporary client-side ID; replaced by DB on upsert
      externalId: this.generateExternalId(article.url),
      sourceId: source.id,
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
      credibilityTier: source.credibilityTier,
      fetchedAt: now,
      cacheExpiresAt: cacheExpiry,
    };
  }

  private generateExternalId(url: string): string {
    const hash = createHash('sha256').update(url).digest('hex');
    return `newsapi:${hash}`;
  }
}
