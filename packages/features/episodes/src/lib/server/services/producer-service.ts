/**
 * Producer Service
 * Phase 11: FILM-1134
 *
 * Plans news episode rundowns (segment ordering, duration allocation, pacing)
 * and orchestrates segment generation via the anchor service (FILM-1133).
 */

import type { AnchorScript } from './anchor-service';
import { NewsStoryService } from './news-story-service';
import type { StoryCluster } from './news-story-service';
import { escapeXml } from '../../utils/escape-xml';

// ─── Types ───────────────────────────────────────────────────────────────────

/** A single segment in an episode rundown */
export interface RundownSegment {
    segmentNumber: number;
    title: string;
    /** Duration in seconds */
    duration: number;
    category: string;
    /** Search query for fetching articles for this segment */
    searchQuery: string;
    priority: 'high' | 'medium' | 'low';
}

/** Complete episode rundown from the LLM */
export interface EpisodeRundown {
    rundown: RundownSegment[];
    /** Total planned runtime in seconds */
    totalRuntime: number;
}

/** A segment with its generated anchor script attached */
export interface OrchestratedSegment extends RundownSegment {
    script: AnchorScript;
}

/** Full orchestrated episode output */
export interface OrchestratedEpisode {
    rundown: EpisodeRundown;
    segments: OrchestratedSegment[];
}

export interface PlanRundownOptions {
    /** Episode title for context */
    episodeTitle: string;
    /** Target duration in minutes */
    totalDuration: number;
    /** Optional topic filters for story discovery */
    topics?: string[];
    /** Required for executeLLM context logging */
    accountId: string;
}

/**
 * Options for full episode orchestration.
 * Extends PlanRundownOptions — extra fields (e.g. voiceTone, style) can be
 * added here in the future without changing the planning interface.
 */
export interface OrchestrateEpisodeOptions extends PlanRundownOptions { }

// ─── Constants ───────────────────────────────────────────────────────────────

/** Max story clusters to include in the producer prompt */
const MAX_STORIES_FOR_RUNDOWN = 15;

/** Fallback segment duration (seconds) when LLM generation fails */
const FALLBACK_SEGMENT_DURATION_SECONDS = 60;

/** Importance score threshold for "high" priority classification */
const HIGH_IMPORTANCE_THRESHOLD = 0.7;

/** Importance score threshold for "medium" priority classification */
const MEDIUM_IMPORTANCE_THRESHOLD = 0.4;

/** Max allowed length for an LLM-generated search query */
const MAX_SEARCH_QUERY_LENGTH = 200;

// ─── Singleton ───────────────────────────────────────────────────────────────

let _newsStoryService: NewsStoryService | null = null;

function getNewsStoryService(): NewsStoryService {
    _newsStoryService ??= new NewsStoryService();

    return _newsStoryService;
}

// ─── Service Functions ───────────────────────────────────────────────────────

/**
 * Plan an episode rundown from discovered stories.
 *
 * Flow: discover stories → format for prompt → LLM plans rundown
 */
export async function planEpisodeRundown(
    options: PlanRundownOptions,
): Promise<EpisodeRundown> {
    const { episodeTitle, totalDuration, topics, accountId } = options;

    // 1. Discover stories using NewsStoryService (singleton)
    const stories = await getNewsStoryService().discoverTopStories({
        date: new Date(),
        topics,
        maxStories: MAX_STORIES_FOR_RUNDOWN,
        accountId,
    });

    if (stories.length === 0) {
        return buildFallbackRundown(totalDuration);
    }

    // 2. Format stories for the prompt
    const formattedStories = stories
        .map((s, i) => formatStoryForPrompt(s, i + 1))
        .join('\n\n');

    // 3. Call the LLM
    try {
        const { executeLLM } = await import('@kit/prompt-engine/server');

        const result = await executeLLM<EpisodeRundown>({
            templateSlug: 'news-generation/producer-role',
            variables: {
                episodeTitle: escapeXml(episodeTitle),
                totalDuration: String(totalDuration),
                stories: escapeXml(formattedStories),
            },
            context: {
                name: 'producer-role',
                accountId,
            },
        });

        return {
            rundown: result.data.rundown ?? [],
            totalRuntime: result.data.totalRuntime ?? totalDuration * 60,
        };
    } catch (err) {
        console.error('[producer-service] Failed to plan rundown:', err);

        return buildFallbackRundown(totalDuration);
    }
}

/**
 * Orchestrate a full news episode: plan rundown then generate each segment.
 *
 * Flow: planEpisodeRundown → generateNewsSegment for each segment
 */
export async function orchestrateNewsEpisode(
    options: OrchestrateEpisodeOptions,
): Promise<OrchestratedEpisode> {
    const { episodeTitle, accountId } = options;

    // 1. Plan the rundown
    const rundown = await planEpisodeRundown(options);

    // 2. Generate each segment sequentially (order matters for continuity)
    const { generateNewsSegment } = await import('./anchor-service');

    const segments: OrchestratedSegment[] = [];

    for (const item of rundown.rundown) {
        try {
            const script = await generateNewsSegment({
                episodeTitle,
                segmentTheme: item.title,
                targetDuration: item.duration,
                searchQuery: sanitizeSearchQuery(item.searchQuery),
                accountId,
            });

            segments.push({ ...item, script });
        } catch (err) {
            console.error(
                `[producer-service] Failed to generate segment ${item.segmentNumber}:`,
                err,
            );

            // Push a fallback segment so the episode still has content
            segments.push({
                ...item,
                script: {
                    script: [
                        {
                            type: 'ANCHOR',
                            content:
                                'Coverage for this segment is temporarily unavailable.',
                            durationSeconds: FALLBACK_SEGMENT_DURATION_SECONDS,
                        },
                    ],
                    sourcesUsed: [],
                },
            });
        }
    }

    return { rundown, segments };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Format a StoryCluster into a text block for the LLM prompt */
function formatStoryForPrompt(story: StoryCluster, index: number): string {
    const category = inferCategory(story.headline);
    const importance =
        story.importance >= HIGH_IMPORTANCE_THRESHOLD
            ? 'high'
            : story.importance >= MEDIUM_IMPORTANCE_THRESHOLD
                ? 'medium'
                : 'low';
    const articleCount = story.articles.length;

    return [
        `[${index}] ${story.headline}`,
        `Topic: ${story.topic} | Category: ${category} | Importance: ${importance} | Sources: ${articleCount}`,
    ].join('\n');
}

/**
 * Infer a broad category from a headline.
 * Used to provide category hints to the LLM.
 * @internal Exported for unit testing.
 */
export function inferCategory(headline: string): string {
    const lower = headline.toLowerCase();

    if (lower.includes('breaking') || lower.includes('urgent')) {
        return 'breaking';
    }

    if (
        lower.includes('election') ||
        lower.includes('congress') ||
        lower.includes('president') ||
        lower.includes('government')
    ) {
        return 'politics';
    }

    if (
        lower.includes('market') ||
        lower.includes('economy') ||
        lower.includes('stock') ||
        lower.includes('trade')
    ) {
        return 'business';
    }

    if (
        lower.includes('ai') ||
        lower.includes('tech') ||
        lower.includes('cyber') ||
        lower.includes('software')
    ) {
        return 'tech';
    }

    if (
        lower.includes('health') ||
        lower.includes('medical') ||
        lower.includes('vaccine') ||
        lower.includes('disease')
    ) {
        return 'health';
    }

    return 'feature';
}

/**
 * Build a fallback rundown when no stories are available or LLM fails.
 * Creates a single generic segment for the full duration.
 */
function buildFallbackRundown(totalDurationMinutes: number): EpisodeRundown {
    const totalSeconds = totalDurationMinutes * 60;

    return {
        rundown: [
            {
                segmentNumber: 1,
                title: 'General News Roundup',
                duration: totalSeconds,
                category: 'feature',
                searchQuery: 'latest news today',
                priority: 'medium',
            },
        ],
        totalRuntime: totalSeconds,
    };
}

/**
 * Sanitize an LLM-generated search query before passing to downstream services.
 *
 * LLM output is untrusted — it could contain injection payloads targeting the
 * search aggregator (e.g. SSRF via crafted URLs, SQL fragments, etc.). This
 * function strips everything except safe characters and truncates to a
 * reasonable length.
 */
export function sanitizeSearchQuery(raw: string): string {
    // Allow only alphanumeric, spaces, hyphens, and basic punctuation
    const cleaned = raw.replace(/[^a-zA-Z0-9\s\-',\.]/g, '').trim();

    if (cleaned.length === 0) {
        return 'latest news today';
    }

    return cleaned.slice(0, MAX_SEARCH_QUERY_LENGTH);
}

