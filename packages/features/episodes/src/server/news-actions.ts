/**
 * News Server Actions
 * Phase 11: FILM-1132
 */

'use server';

import { enhanceAction } from '@kit/next/actions';
import { z } from 'zod';

import { NewsStoryService } from '../lib/server/services/news-story-service';

const service = new NewsStoryService();

// ─── Discover Top Stories ────────────────────────────────────────────────────

const DiscoverTopStoriesSchema = z.object({
    date: z.string().datetime(),
    topics: z.array(z.string()).optional(),
    maxStories: z.number().int().min(1).max(50).optional(),
});

export const discoverTopStoriesAction = enhanceAction(
    async (params, user) => {
        return service.discoverTopStories({
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
        return service.getTopicContext(params.topic, user.id);
    },
    {
        schema: GetNewsTopicContextSchema,
        auth: true,
    },
);
