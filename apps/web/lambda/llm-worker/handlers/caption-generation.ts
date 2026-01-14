/**
 * Caption Generation Handler
 *
 * Generates captions/subtitles for video content.
 * No database writes - returns captions to frontend.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

interface CaptionGenerationPayload {
    episodeId: string;
    shotIds?: string[];
    language: string;
    style: 'standard' | 'simplified' | 'described';
    accountId: string;
    userId: string;
}

interface Caption {
    shotId: string;
    startTime: number;
    endTime: number;
    text: string;
    speaker?: string;
}

interface CaptionGenerationResult {
    success: boolean;
    data: {
        captions: Caption[];
        language: string;
        totalCaptions: number;
    };
}

export async function processCaptionGeneration(
    payload: Record<string, unknown>,
    supabase: SupabaseClient,
): Promise<CaptionGenerationResult> {
    const data = payload as CaptionGenerationPayload;

    console.log(`[Caption Generation] Processing for episode ${data.episodeId}`);

    // Fetch dialogue lines for the episode
    const { data: dialogueLines, error: fetchError } = await supabase
        .from('dialogue_lines')
        .select(`
            id, text, sequence_number, scene_number,
            timeline_start_seconds, estimated_duration_seconds,
            shot_id, character_asset_id,
            character:assets(name)
        `)
        .eq('episode_id', data.episodeId)
        .eq('language', data.language === 'en' ? 'en' : data.language)
        .order('sequence_number', { ascending: true });

    if (fetchError) {
        throw new Error(`Failed to fetch dialogue: ${fetchError.message}`);
    }

    if (!dialogueLines?.length) {
        return {
            success: true,
            data: {
                captions: [],
                language: data.language,
                totalCaptions: 0,
            },
        };
    }

    // Convert dialogue lines to captions
    const captions: Caption[] = dialogueLines.map(line => ({
        shotId: line.shot_id || '',
        startTime: line.timeline_start_seconds || 0,
        endTime: (line.timeline_start_seconds || 0) + (line.estimated_duration_seconds || 3),
        text: line.text,
        speaker: (line.character as { name: string } | null)?.name,
    }));

    // If simplified style requested, use LLM to simplify
    if (data.style === 'simplified' && captions.length > 0) {
        const { executeLLM } = await import('@kit/prompt-engine/server');

        try {
            const result = await executeLLM<{ captions: Array<{ text: string }> }>({
                templateSlug: 'caption-simplification',
                variables: {
                    captions: JSON.stringify(captions.map(c => c.text)),
                    style: data.style,
                },
                context: {
                    name: 'caption-generation',
                    accountId: data.accountId,
                    userId: data.userId,
                },
            });

            // Merge simplified text back
            result.data.captions.forEach((simplified, i) => {
                if (captions[i]) {
                    captions[i].text = simplified.text;
                }
            });
        } catch (error) {
            console.error('[Caption Generation] Simplification failed:', error);
            // Continue with original captions
        }
    }

    console.log(`[Caption Generation] Generated ${captions.length} captions`);

    return {
        success: true,
        data: {
            captions,
            language: data.language,
            totalCaptions: captions.length,
        },
    };
}
