/**
 * News Server Actions
 * Phase 11: FILM-1132
 */

'use server';

import { enhanceAction } from '@kit/next/actions';
import { z } from 'zod';

import { NewsStoryService } from '../lib/server/services/news-story-service';

let _service: NewsStoryService | null = null;

function getNewsStoryService(): NewsStoryService {
    _service ??= new NewsStoryService();

    return _service;
}

// ─── Discover Top Stories ────────────────────────────────────────────────────

const DiscoverTopStoriesSchema = z.object({
    date: z.string().datetime(),
    topics: z.array(z.string()).optional(),
    maxStories: z.number().int().min(1).max(50).optional(),
});

export const discoverTopStoriesAction = enhanceAction(
    async (params, user) => {
        return getNewsStoryService().discoverTopStories({
            date: new Date(params.date),
            topics: params.topics,
            maxStories: params.maxStories,
            accountId: user.id,
        });
    },
    {
        schema: DiscoverTopStoriesSchema,
        auth: true,
    },
);

// ─── Get News Topic Context ──────────────────────────────────────────────────

const GetNewsTopicContextSchema = z.object({
    topic: z.string().min(1).max(500),
});

export const getNewsTopicContextAction = enhanceAction(
    async (params, user) => {
        return getNewsStoryService().getTopicContext(params.topic, user.id);
    },
    {
        schema: GetNewsTopicContextSchema,
        auth: true,
    },
);

// ─── Generate News Segment (FILM-1133) ───────────────────────────────────────

const GenerateNewsSegmentSchema = z.object({
    episodeTitle: z.string().min(1),
    segmentTheme: z.string().min(1),
    targetDuration: z.number().int().min(15).max(600),
    searchQuery: z.string().min(1),
});

export const generateNewsSegmentAction = enhanceAction(
    async (params, user) => {
        const { generateNewsSegment } = await import(
            '../lib/server/services/anchor-service'
        );

        return generateNewsSegment({
            ...params,
            accountId: user.id,
        });
    },
    {
        schema: GenerateNewsSegmentSchema,
        auth: true,
    },
);

// ─── Check Source Balance (FILM-1133) ─────────────────────────────────────────

/** Max articles to sample when checking source balance */
const SOURCE_BALANCE_PAGE_SIZE = 20;

const CheckSourceBalanceSchema = z.object({
    searchQuery: z.string().min(1),
});

export const checkSourceBalanceAction = enhanceAction(
    async (params, _user) => {
        const { getContextAggregator } = await import(
            '../lib/server/services/context-aggregator'
        );
        const { checkSourceBalance } = await import(
            '../lib/server/services/anchor-service'
        );

        const aggregator = await getContextAggregator();
        const result = await aggregator.search({
            query: params.searchQuery,
            category: 'news',
            pageSize: SOURCE_BALANCE_PAGE_SIZE,
        });

        return checkSourceBalance(result.content);
    },
    {
        schema: CheckSourceBalanceSchema,
        auth: true,
    },
);
