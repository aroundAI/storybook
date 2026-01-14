/**
 * Continuity Analysis Handler
 *
 * Analyzes story continuity across episodes.
 * No database writes - returns analysis to frontend.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

interface ContinuityAnalysisPayload {
    projectId: string;
    seasonId?: string;
    episodeIds: string[];
    accountId: string;
    userId: string;
}

interface ContinuityIssue {
    type: 'character' | 'location' | 'timeline' | 'plot';
    severity: 'low' | 'medium' | 'high';
    description: string;
    episodes: number[];
    suggestion: string;
}

interface ContinuityAnalysisResult {
    success: boolean;
    data: {
        issues: ContinuityIssue[];
        summary: string;
        overallScore: number;
    };
}

export async function processContinuityAnalysis(
    payload: Record<string, unknown>,
    supabase: SupabaseClient,
): Promise<ContinuityAnalysisResult> {
    const data = payload as ContinuityAnalysisPayload;

    console.log(`[Continuity Analysis] Processing for ${data.episodeIds.length} episodes`);

    // Fetch episodes with story data
    const { data: episodes, error: fetchError } = await supabase
        .from('episodes')
        .select('id, number, title, story_data')
        .in('id', data.episodeIds)
        .order('number', { ascending: true });

    if (fetchError || !episodes?.length) {
        throw new Error(`Failed to fetch episodes: ${fetchError?.message}`);
    }

    // Extract story summaries for analysis
    const episodeSummaries = episodes.map(ep => {
        const storyData = ep.story_data as Record<string, unknown> | null;
        return {
            number: ep.number,
            title: ep.title,
            summary: storyData?.episodeSummary || storyData?.fullStory?.toString().substring(0, 500) || '',
            characters: storyData?.characters || [],
            keyEvents: storyData?.keyEvents || [],
        };
    });

    // Execute LLM
    const { executeLLM } = await import('@kit/prompt-engine/server');

    try {
        const result = await executeLLM<{
            issues: ContinuityIssue[];
            summary: string;
            overallScore: number;
        }>({
            templateSlug: 'continuity-analysis',
            variables: {
                episodes: JSON.stringify(episodeSummaries, null, 2),
                episode_count: episodes.length,
            },
            context: {
                name: 'continuity-analysis',
                accountId: data.accountId,
                userId: data.userId,
            },
        });

        console.log(`[Continuity Analysis] Found ${result.data.issues.length} issues`);

        return {
            success: true,
            data: result.data,
        };
    } catch (error) {
        console.error('[Continuity Analysis] Error:', error);
        return {
            success: true,
            data: {
                issues: [],
                summary: 'Unable to analyze continuity at this time.',
                overallScore: 0,
            },
        };
    }
}
