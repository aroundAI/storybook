---
id: FILM-1132
title: News Aggregator Service
status: 🟡 PARTIAL
audited: 2026-09-23
priority: high
effort: L
dependencies: [FILM-1135, FILM-1130, FILM-1131]
---

# FILM-1132: News Aggregator Service

## Overview

> [!IMPORTANT]
> This spec has been revised to use the **unified** `ExternalContextAggregator` service defined in [FILM-1135](../providers/FILM-1135-external-context-provider.md). The aggregator handles routing requests to the appropriate providers (news, research, etc.) based on the content category.

This spec focuses on the **news-specific** integration layer that uses the unified aggregator for story discovery and balanced reporting.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                      NewsStoryService                           │
│  (News-specific logic: balanced sources, story clustering)      │
└───────────────────────────────┬─────────────────────────────────┘
                                │ uses
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│                 ExternalContextAggregator                       │
│            (Unified provider from FILM-1135)                    │
│  ┌─────────────┐  ┌────────────────┐  ┌───────────────┐        │
│  │ NewsAPI     │  │ SemanticScholar│  │  Archive.org  │        │
│  │ Provider    │  │ Provider       │  │  Provider     │        │
│  └─────────────┘  └────────────────┘  └───────────────┘        │
└─────────────────────────────────────────────────────────────────┘
```

---

## NewsStoryService

```typescript
// packages/features/episodes/src/lib/server/services/news-story-service.ts

import { ExternalContextAggregator } from './external-context-aggregator';
import { getBalancedSources } from '../../types/news-sources';
import { extractEntitiesFromArticle } from './entity-extractor';
import type { ExternalContent } from '../../types/external-context';

export interface StoryCluster {
  /** Main story topic */
  topic: string;
  /** Representative headline */
  headline: string;
  /** All articles covering this story */
  articles: ExternalContent[];
  /** Sources from different political perspectives */
  perspectives: {
    left: ExternalContent[];
    center: ExternalContent[];
    right: ExternalContent[];
  };
  /** Extracted entities across all articles */
  entities: ExtractedEntities;
  /** Story importance score (0-1) */
  importance: number;
}

export class NewsStoryService {
  private aggregator: ExternalContextAggregator;

  constructor() {
    this.aggregator = new ExternalContextAggregator();
  }

  /**
   * Discover top stories for a date with balanced coverage
   */
  async discoverTopStories(options: {
    date: Date;
    topics?: string[];
    regions?: string[];
    maxStories?: number;
  }): Promise<StoryCluster[]> {
    const { date, topics, regions, maxStories = 10 } = options;

    // Fetch news from multiple sources
    const articles = await this.aggregator.fetch({
      category: 'news',
      query: topics?.join(' OR ') ?? '*',
      fromDate: date,
      toDate: date,
      limit: 100,
    });

    // Cluster articles by story
    const clusters = await this.clusterByStory(articles);

    // Get balanced perspectives for each cluster
    const balancedClusters = clusters
      .slice(0, maxStories)
      .map(cluster => this.balanceCluster(cluster));

    return balancedClusters;
  }

  /**
   * Get context for a specific news topic
   */
  async getTopicContext(topic: string): Promise<{
    articles: ExternalContent[];
    entities: ExtractedEntities;
    summary: string;
  }> {
    const articles = await this.aggregator.fetch({
      category: 'news',
      query: topic,
      limit: 20,
    });

    // Extract and merge entities
    const allEntities = await Promise.all(
      articles.slice(0, 5).map(a => 
        extractEntitiesFromArticle(a.title, a.content ?? '')
      )
    );
    const mergedEntities = this.mergeEntities(allEntities);

    // Generate summary
    const summary = await this.summarizeTopic(topic, articles);

    return { articles, entities: mergedEntities, summary };
  }

  /**
   * Cluster articles by story using entity overlap
   */
  private async clusterByStory(
    articles: ExternalContent[]
  ): Promise<StoryCluster[]> {
    // Extract entities for all articles
    const articlesWithEntities = await Promise.all(
      articles.map(async article => ({
        article,
        entities: await extractEntitiesFromArticle(
          article.title, 
          article.content ?? ''
        ),
      }))
    );

    // Simple clustering: group by overlapping people/organizations
    const clusters: Map<string, typeof articlesWithEntities> = new Map();

    for (const item of articlesWithEntities) {
      const key = this.getClusterKey(item.entities);
      const existing = clusters.get(key) ?? [];
      existing.push(item);
      clusters.set(key, existing);
    }

    // Convert to StoryCluster format
    return Array.from(clusters.entries())
      .map(([topic, items]) => ({
        topic,
        headline: items[0]?.article.title ?? topic,
        articles: items.map(i => i.article),
        perspectives: { left: [], center: [], right: [] },
        entities: this.mergeEntities(items.map(i => i.entities)),
        importance: items.length / articles.length,
      }))
      .sort((a, b) => b.importance - a.importance);
  }

  /**
   * Balance cluster with articles from different perspectives
   */
  private balanceCluster(cluster: StoryCluster): StoryCluster {
    const perspectives = getBalancedSources(
      cluster.articles.map(a => ({ 
        ...a, 
        biasLabel: a.metadata?.biasLabel as BiasLabel | undefined 
      }))
    );

    return {
      ...cluster,
      perspectives: {
        left: perspectives.left.slice(0, 2),
        center: perspectives.center.slice(0, 2),
        right: perspectives.right.slice(0, 2),
      },
    };
  }

  /**
   * Generate cluster key from entities
   */
  private getClusterKey(entities: ExtractedEntities): string {
    const people = entities.people?.slice(0, 2).map(p => p.name).join(',') ?? '';
    const orgs = entities.organizations?.slice(0, 1).map(o => o.name).join(',') ?? '';
    return `${people}|${orgs}`.toLowerCase() || 'general';
  }

  /**
   * Merge entities from multiple articles
   */
  private mergeEntities(entitiesList: ExtractedEntities[]): ExtractedEntities {
    const merged: ExtractedEntities = {
      people: [],
      organizations: [],
      locations: [],
      topics: [],
      events: [],
      extractedAt: new Date(),
    };

    for (const entities of entitiesList) {
      merged.people?.push(...(entities.people ?? []));
      merged.organizations?.push(...(entities.organizations ?? []));
      merged.locations?.push(...(entities.locations ?? []));
      merged.topics?.push(...(entities.topics ?? []));
      merged.events?.push(...(entities.events ?? []));
    }

    // Deduplicate by name
    merged.people = this.dedupeByName(merged.people ?? []);
    merged.organizations = this.dedupeByName(merged.organizations ?? []);
    merged.locations = this.dedupeByName(merged.locations ?? []);
    merged.topics = [...new Set(merged.topics)];

    return merged;
  }

  private dedupeByName<T extends { name: string }>(items: T[]): T[] {
    const seen = new Set<string>();
    return items.filter(item => {
      const key = item.name.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  /**
   * Generate topic summary using LLM
   */
  private async summarizeTopic(
    topic: string, 
    articles: ExternalContent[]
  ): Promise<string> {
    const { executeLLM } = await import('@kit/prompt-engine');
    
    const headlines = articles.slice(0, 10).map(a => a.title).join('\n');
    
    const result = await executeLLM({
      promptId: 'news-generation/topic-summary',
      variables: { topic, headlines },
    });

    return result.content;
  }
}
```

---

## Server Actions

```typescript
// packages/features/episodes/src/server/news-actions.ts

import { z } from 'zod';
import { enhanceAction } from '@kit/next/actions';
import { NewsStoryService } from '../lib/server/services/news-story-service';

const service = new NewsStoryService();

/**
 * Discover top stories for NEWS project type
 */
export const discoverTopStoriesAction = enhanceAction(
  async (params) => {
    return await service.discoverTopStories({
      date: new Date(params.date),
      topics: params.topics,
      maxStories: params.maxStories,
    });
  },
  {
    schema: z.object({
      date: z.string(),
      topics: z.array(z.string()).optional(),
      maxStories: z.number().optional(),
    }),
    auth: true,
  }
);

/**
 * Get context for specific news topic
 */
export const getNewsTopicContextAction = enhanceAction(
  async (params) => {
    return await service.getTopicContext(params.topic);
  },
  {
    schema: z.object({
      topic: z.string(),
    }),
    auth: true,
  }
);
```

---

## Acceptance Criteria

- [x] `NewsStoryService` created using `ExternalContextAggregator`
- [x] `discoverTopStories()` returns clustered stories
- [ ] Stories include balanced perspectives (left, center, right) — *audit: no longer true* — articles never carry a bias label (`packages/features/episodes/src/lib/server/providers/newsapi-provider.ts:94`), so every article lands in `center`
- [x] Entity extraction merges across articles
- [x] Topic context includes summary
- [x] Server actions exported

---

## Estimated Effort

| Task | Time |
|------|------|
| Create NewsStoryService | 3 hours |
| Implement story clustering | 2 hours |
| Create topic-summary prompt | 30 min |
| Server actions | 1 hour |
| Testing | 1.5 hours |
| **Total** | **~8 hours** (L) |

---

## Dependencies

- **FILM-1135**: ExternalContextAggregator
- **FILM-1130**: Seeded news sources in external_sources
- **FILM-1131**: Cache configuration and entity extraction

## Blocks

- **FILM-1133**: News Anchor Role (uses NewsStoryService)
- **FILM-1134**: Producer Role (uses NewsStoryService)

## Remaining (audit 2026-09-23)

| Criterion | Why it is open | Closed by |
|---|---|---|
| Stories include balanced perspectives (left, center, right) | `getBalancedSources` buckets by `article.biasLabel` and sends unlabelled items to `center` (`packages/features/episodes/src/types/news-sources.ts:35`). `NewsAPIProvider` never sets `biasLabel` (`packages/features/episodes/src/lib/server/providers/newsapi-provider.ts:94`), and the aggregator loads sources without `bias_label` or `config` (`packages/features/episodes/src/lib/server/services/context-aggregator.ts:100`), so the seeded outlets' labels never reach an article. Left and right are always empty | unassigned |
