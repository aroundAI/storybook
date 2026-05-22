/**
 * News Story Service
 * Phase 11: FILM-1132
 *
 * Orchestrates news story discovery using the unified ExternalContextAggregator
 * (FILM-1135), entity extraction (FILM-1131), and balanced perspective filtering
 * (FILM-1130).
 */
import type {
  ExternalContent,
  ExternalSearchParams,
  ExtractedEntities,
} from '../../../types/external-context';
import { getBalancedSources } from '../../../types/news-sources';
import { escapeXml } from '../../utils/escape-xml';
import { getContextAggregator } from './context-aggregator';
import { extractEntitiesFromArticle, mergeEntities } from './entity-extractor';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface StoryCluster {
  topic: string;
  headline: string;
  articles: ExternalContent[];
  perspectives: {
    left: ExternalContent[];
    center: ExternalContent[];
    right: ExternalContent[];
  };
  entities: ExtractedEntities;
  importance: number;
}

export interface DiscoverStoriesOptions {
  date: Date;
  topics?: string[];
  maxStories?: number;
  /** Required for executeLLM context logging */
  accountId: string;
}

export interface TopicContextResult {
  articles: ExternalContent[];
  entities: ExtractedEntities;
  summary: string;
}

/** Max articles to run entity extraction on per topic (budget-conscious) */
const MAX_ENTITY_EXTRACTION_ARTICLES = 5;

/** Default number of story clusters to return */
const DEFAULT_MAX_STORIES = 10;

/** Page size when discovering stories for a full day */
const DISCOVER_PAGE_SIZE = 100;

/** Page size when fetching context for a single topic */
const TOPIC_CONTEXT_PAGE_SIZE = 20;

/** Minimum importance score for a story cluster */
const MIN_IMPORTANCE_FLOOR = 0.1;

/** Max people entities used in cluster key */
const CLUSTER_KEY_MAX_PEOPLE = 2;

/** Max org entities used in cluster key */
const CLUSTER_KEY_MAX_ORGS = 1;

// ─── Service ─────────────────────────────────────────────────────────────────

export class NewsStoryService {
  /**
   * Discover top stories for a date with balanced coverage.
   *
   * Flow: search → extract entities → cluster → balance perspectives
   */
  async discoverTopStories(
    options: DiscoverStoriesOptions,
  ): Promise<StoryCluster[]> {
    const {
      date,
      topics,
      maxStories = DEFAULT_MAX_STORIES,
      accountId,
    } = options;

    const aggregator = await getContextAggregator();

    // Build search params — use date as from/to range
    const startOfDay = new Date(date);
    startOfDay.setUTCHours(0, 0, 0, 0);
    const endOfDay = new Date(date);
    endOfDay.setUTCHours(23, 59, 59, 999);

    const searchParams: ExternalSearchParams = {
      query: topics?.length ? topics.join(' OR ') : 'latest news today',
      category: 'news',
      from: startOfDay,
      to: endOfDay,
      pageSize: DISCOVER_PAGE_SIZE,
    };

    const result = await aggregator.search(searchParams);
    const articles = result.content;

    if (articles.length === 0) return [];

    // Cluster by entity overlap
    const clusters = await this.clusterByStory(articles, accountId);

    // Balance perspectives and cap
    return clusters
      .slice(0, maxStories)
      .map((cluster) => this.balanceCluster(cluster));
  }

  /**
   * Get rich context for a specific news topic.
   *
   * Flow: search → extract entities → merge → summarize
   */
  async getTopicContext(
    topic: string,
    accountId: string,
  ): Promise<TopicContextResult> {
    const aggregator = await getContextAggregator();

    const result = await aggregator.search({
      query: topic,
      category: 'news',
      pageSize: TOPIC_CONTEXT_PAGE_SIZE,
    });

    const articles = result.content;

    // Extract entities from top 5 articles (budget-conscious)
    const entityResults = await Promise.all(
      articles
        .slice(0, MAX_ENTITY_EXTRACTION_ARTICLES)
        .map((a) =>
          extractEntitiesFromArticle(a.title, a.content ?? '', { accountId }),
        ),
    );

    const mergedEntities = mergeEntities(entityResults);

    // Generate topic summary
    const summary = await this.summarizeTopic(topic, articles, accountId);

    return { articles, entities: mergedEntities, summary };
  }

  // ─── Private Helpers ─────────────────────────────────────────────────────

  /** Max articles to run entity extraction on (controls LLM cost) */
  private static readonly MAX_ARTICLES_TO_EXTRACT = 30;

  /** Max articles per perspective bucket in balanced output */
  private static readonly MAX_ARTICLES_PER_PERSPECTIVE = 2;

  /** Max headlines to feed into the topic summarization prompt */
  private static readonly MAX_HEADLINES_FOR_SUMMARY = 10;

  /**
   * Cluster articles by entity overlap.
   *
   * Strategy: extract entities, then group by primary person + organization.
   * Simple but effective for news clustering.
   */
  private async clusterByStory(
    articles: ExternalContent[],
    accountId: string,
  ): Promise<StoryCluster[]> {
    // Cap entity extraction to avoid LLM cost explosion
    const toExtract = articles.slice(
      0,
      NewsStoryService.MAX_ARTICLES_TO_EXTRACT,
    );

    // Extract entities (parallel, best-effort)
    const articlesWithEntities = await Promise.all(
      toExtract.map(async (article) => ({
        article,
        entities: await extractEntitiesFromArticle(
          article.title,
          article.content ?? '',
          { accountId },
        ),
      })),
    );

    // Group by cluster key (primary person + org)
    // Note: entity-based clustering works well for named events but may
    // over-merge for generic topics sharing the same key figures.
    const clusters = new Map<
      string,
      Array<{
        article: ExternalContent;
        entities: ExtractedEntities;
      }>
    >();

    for (const item of articlesWithEntities) {
      const key = this.getClusterKey(item.entities);
      const existing = clusters.get(key) ?? [];
      existing.push(item);
      clusters.set(key, existing);
    }

    // Convert to StoryCluster format, sorted by importance
    // Importance = article share with a minimum floor of 0.1
    return Array.from(clusters.entries())
      .map(([topic, items]) => ({
        topic,
        headline: items[0]?.article.title ?? topic,
        articles: items.map((i) => i.article),
        perspectives: { left: [], center: [], right: [] },
        entities: mergeEntities(items.map((i) => i.entities)),
        importance: Math.max(
          MIN_IMPORTANCE_FLOOR,
          items.length / toExtract.length,
        ),
      }))
      .sort((a, b) => b.importance - a.importance);
  }

  /**
   * Build cluster key from first 2 people + first org.
   * Falls back to 'general' for entity-less articles.
   */
  private getClusterKey(entities: ExtractedEntities): string {
    const people =
      entities.people
        ?.slice(0, CLUSTER_KEY_MAX_PEOPLE)
        .map((p) => p.name)
        .join(',') ?? '';
    const orgs =
      entities.organizations
        ?.slice(0, CLUSTER_KEY_MAX_ORGS)
        .map((o) => o.name)
        .join(',') ?? '';

    return people || orgs ? `${people}|${orgs}`.toLowerCase() : 'general';
  }

  /**
   * Tag articles with bias labels and split into perspective groups.
   */
  private balanceCluster(cluster: StoryCluster): StoryCluster {
    const perspectives = getBalancedSources(cluster.articles);

    return {
      ...cluster,
      perspectives: {
        left: perspectives.left.slice(
          0,
          NewsStoryService.MAX_ARTICLES_PER_PERSPECTIVE,
        ),
        center: perspectives.center.slice(
          0,
          NewsStoryService.MAX_ARTICLES_PER_PERSPECTIVE,
        ),
        right: perspectives.right.slice(
          0,
          NewsStoryService.MAX_ARTICLES_PER_PERSPECTIVE,
        ),
      },
    };
  }

  /**
   * Generate topic summary using LLM.
   */
  private async summarizeTopic(
    topic: string,
    articles: ExternalContent[],
    accountId: string,
  ): Promise<string> {
    try {
      const { executeLLM } = await import('@kit/prompt-engine/server');

      const headlines = articles
        .slice(0, NewsStoryService.MAX_HEADLINES_FOR_SUMMARY)
        .map((a) => a.title)
        .join('\n');

      // Escape XML to prevent prompt injection via tag breakout
      const escapedTopic = escapeXml(topic);
      const escapedHeadlines = escapeXml(headlines);

      const result = await executeLLM<{ summary: string }>({
        templateSlug: 'news-generation/topic-summary',
        variables: { topic: escapedTopic, headlines: escapedHeadlines },
        context: { name: 'topic-summary', accountId },
      });

      return result.data.summary;
    } catch (err) {
      console.error('[news-story-service] Failed to summarize topic:', err);

      // Static fallback — never reflect user input to prevent XSS
      return 'News topic summary unavailable.';
    }
  }
}
