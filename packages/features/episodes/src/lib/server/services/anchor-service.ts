/**
 * Anchor Service
 * Phase 11: FILM-1133
 *
 * Generates professional broadcast scripts from news articles using the
 * anchor-role LLM prompt. Provides source balance checking utilities.
 */

import type { ExternalContent } from '../../../types/external-context';
import { escapeXml } from '../../utils/escape-xml';
import { getContextAggregator } from './context-aggregator';

// ─── Types ───────────────────────────────────────────────────────────────────

/** A single entry in a broadcast script */
export interface AnchorScriptEntry {
    type: 'ANCHOR' | 'GRAPHIC' | 'TRANSITION';
    content: string;
    durationSeconds?: number;
    sources?: string[];
}

/** Complete anchor script output from the LLM */
export interface AnchorScript {
    script: AnchorScriptEntry[];
    sourcesUsed: string[];
}

/** Result of checking source balance */
export interface SourceBalanceResult {
    isBalanced: boolean;
    biasDistribution: Record<string, number>;
    warnings: string[];
}

export interface GenerateSegmentOptions {
    episodeTitle: string;
    segmentTheme: string;
    /** Target segment duration in seconds */
    targetDuration: number;
    /** Search query for finding relevant articles */
    searchQuery: string;
    /** Required for executeLLM context logging */
    accountId: string;
}

// ─── Constants ───────────────────────────────────────────────────────────────

/** Max articles to feed into the anchor script prompt */
const MAX_ARTICLES_FOR_SCRIPT = 10;

/** Max content length per article in the prompt (chars) */
const MAX_ARTICLE_CONTENT_LENGTH = 500;

/** Fallback duration (seconds) when no articles are found */
const EMPTY_FALLBACK_DURATION_SECONDS = 5;

/** Fallback duration (seconds) when LLM generation fails */
const ERROR_FALLBACK_DURATION_SECONDS = 10;

// ─── Service Functions ───────────────────────────────────────────────────────

/**
 * Generate a broadcast script for a news segment.
 *
 * Flow: search articles → format for prompt → LLM generates script
 */
export async function generateNewsSegment(
    options: GenerateSegmentOptions,
): Promise<AnchorScript> {
    const {
        episodeTitle,
        segmentTheme,
        targetDuration,
        searchQuery,
        accountId,
    } = options;

    const aggregator = await getContextAggregator();

    const result = await aggregator.search({
        query: searchQuery,
        category: 'news',
        pageSize: MAX_ARTICLES_FOR_SCRIPT,
    });

    const articles = result.content;

    if (articles.length === 0) {
        return {
            script: [
                {
                    type: 'ANCHOR',
                    content: 'No recent coverage found for the requested theme',
                    durationSeconds: EMPTY_FALLBACK_DURATION_SECONDS,
                },
            ],
            sourcesUsed: [],
        };
    }

    // Format articles for the prompt
    const formattedArticles = articles
        .map((a, i) => formatArticleForPrompt(a, i + 1))
        .join('\n\n');

    try {
        const { executeLLM } = await import('@kit/prompt-engine/server');

        const llmResult = await executeLLM<AnchorScript>({
            templateSlug: 'news-generation/anchor-role',
            variables: {
                episodeTitle: escapeXml(episodeTitle),
                segmentTheme: escapeXml(segmentTheme),
                targetDuration: String(targetDuration),
                articles: escapeXml(formattedArticles),
            },
            context: {
                name: 'anchor-role',
                accountId,
            },
        });

        return {
            script: llmResult.data.script ?? [],
            sourcesUsed: llmResult.data.sourcesUsed ?? [],
        };
    } catch (err) {
        console.error('[anchor-service] Failed to generate script:', err);

        return {
            script: [
                {
                    type: 'ANCHOR',
                    content: 'Coverage summary for the requested theme',
                    durationSeconds: ERROR_FALLBACK_DURATION_SECONDS,
                },
            ],
            sourcesUsed: [],
        };
    }
}

/**
 * Check source balance across a set of articles.
 *
 * Returns bias distribution and warnings if coverage is one-sided.
 */
export function checkSourceBalance(
    articles: ExternalContent[],
): SourceBalanceResult {
    const biasDistribution: Record<string, number> = {};

    for (const article of articles) {
        const bias = article.biasLabel ?? 'unknown';
        biasDistribution[bias] = (biasDistribution[bias] ?? 0) + 1;
    }

    const warnings: string[] = [];
    const biasLabels = Object.keys(biasDistribution);

    // Warn if all sources share the same bias
    if (biasLabels.length === 1 && articles.length > 1) {
        warnings.push(
            `All ${articles.length} sources have "${biasLabels[0]}" bias`,
        );
    }

    // Warn if no center sources are present
    // NOTE: center_left and center_right intentionally count toward BOTH the
    // center bucket AND the left/right bucket. A "center_left" source provides
    // some center perspective AND some left perspective. This means a set of
    // only center_left articles won't trigger "no center" or "no left" warnings,
    // but will trigger "no right-leaning" if articles.length >= 4.
    const centerCount =
        (biasDistribution['center'] ?? 0) +
        (biasDistribution['center_left'] ?? 0) +
        (biasDistribution['center_right'] ?? 0);

    if (centerCount === 0 && articles.length > 2) {
        warnings.push('No center-leaning sources in coverage');
    }

    // Check left-right balance
    const leftCount =
        (biasDistribution['left'] ?? 0) +
        (biasDistribution['center_left'] ?? 0);
    const rightCount =
        (biasDistribution['right'] ?? 0) +
        (biasDistribution['center_right'] ?? 0);

    if (articles.length >= 4 && (leftCount === 0 || rightCount === 0)) {
        const missing = leftCount === 0 ? 'left-leaning' : 'right-leaning';
        warnings.push(`No ${missing} sources for perspective balance`);
    }

    return {
        isBalanced: warnings.length === 0,
        biasDistribution,
        warnings,
    };
}

/** Format a single article into a text block for the LLM prompt */
function formatArticleForPrompt(
    article: ExternalContent,
    index: number,
): string {
    const source = article.sourceId ?? 'unknown-source';
    const tier = article.credibilityTier ?? 'unknown';
    const bias = article.biasLabel ?? 'unknown';
    const snippet = (article.content ?? article.description ?? '')
        .slice(0, MAX_ARTICLE_CONTENT_LENGTH);

    return [
        `[${index}] ${article.title}`,
        `Source: ${source} | Credibility: ${tier} | Bias: ${bias}`,
        snippet,
    ].join('\n');
}
