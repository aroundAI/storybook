/**
 * Dubbing Translate Handler
 *
 * Translates dialogue for dubbing with timing preservation.
 * Similar to translate-dialogue but optimized for dubbing.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

interface DubbingTranslatePayload {
    episodeId: string;
    targetLanguage: string;
    preserveTiming: boolean;
    accountId: string;
    userId: string;
}

interface DubbingTranslateResult {
    success: boolean;
    data: {
        translatedCount: number;
        targetLanguage: string;
    };
}

export async function processDubbingTranslate(
    payload: Record<string, unknown>,
    supabase: SupabaseClient,
): Promise<DubbingTranslateResult> {
    const data = payload as DubbingTranslatePayload;

    console.log(`[Dubbing Translate] Processing for episode ${data.episodeId} to ${data.targetLanguage}`);

    // Reuse translate-dialogue logic
    const { processTranslateDialogue } = await import('./translate-dialogue');

    const result = await processTranslateDialogue(payload, supabase);

    return {
        success: result.success,
        data: {
            translatedCount: result.data.translatedCount,
            targetLanguage: data.targetLanguage,
        },
    };
}
