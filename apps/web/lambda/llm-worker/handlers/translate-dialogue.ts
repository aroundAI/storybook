/**
 * Translate Dialogue Handler
 *
 * Translates English dialogue lines to target language.
 * WRITES TO DATABASE: Inserts new dialogue_lines rows
 */
import type { SupabaseClient } from '@supabase/supabase-js';

interface TranslateDialoguePayload {
    episodeId: string;
    targetLanguage: string;
    preserveTiming: boolean;
    accountId: string;
    userId: string;
}

interface DialogueLine {
    id: string;
    episode_id: string;
    character_asset_id: string | null;
    shot_id: string | null;
    text: string;
    sequence_number: number;
    scene_number: number;
    timeline_start_seconds: number | null;
    estimated_duration_seconds: number | null;
}

interface TranslateDialogueResult {
    success: boolean;
    data: {
        translatedCount: number;
    };
}

const LANGUAGE_NAMES: Record<string, string> = {
    hi: 'Hindi',
    es: 'Spanish',
    pt: 'Portuguese',
    fr: 'French',
    de: 'German',
    ja: 'Japanese',
    ko: 'Korean',
    zh: 'Chinese',
};

export async function processTranslateDialogue(
    payload: Record<string, unknown>,
    supabase: SupabaseClient,
): Promise<TranslateDialogueResult> {
    const data = payload as TranslateDialoguePayload;

    console.log(`[Translate Dialogue] Processing for episode ${data.episodeId} to ${data.targetLanguage}`);

    // 1. Fetch English dialogue lines
    const { data: englishLines, error: fetchError } = await supabase
        .from('dialogue_lines')
        .select(`
            id, episode_id, character_asset_id, shot_id, text,
            sequence_number, scene_number, timeline_start_seconds,
            estimated_duration_seconds
        `)
        .eq('episode_id', data.episodeId)
        .eq('language', 'en')
        .order('sequence_number', { ascending: true });

    if (fetchError) {
        throw new Error(`Failed to fetch dialogue: ${fetchError.message}`);
    }

    const lines = (englishLines || []) as DialogueLine[];

    if (lines.length === 0) {
        console.log('[Translate Dialogue] No English lines to translate');
        return { success: true, data: { translatedCount: 0 } };
    }

    // 2. Check existing translations
    const { data: existing } = await supabase
        .from('dialogue_lines')
        .select('source_dialogue_id')
        .eq('episode_id', data.episodeId)
        .eq('language', data.targetLanguage);

    const existingSourceIds = new Set(
        (existing || []).map((e: { source_dialogue_id: string }) => e.source_dialogue_id)
    );

    const linesToTranslate = lines.filter(l => !existingSourceIds.has(l.id));

    if (linesToTranslate.length === 0) {
        console.log('[Translate Dialogue] All lines already translated');
        return { success: true, data: { translatedCount: 0 } };
    }

    // 3. Translate using LLM
    const targetLangName = LANGUAGE_NAMES[data.targetLanguage] || data.targetLanguage;

    // Build dialogue text for LLM
    const linesText = linesToTranslate
        .map((l, i) => {
            const timing = data.preserveTiming && l.estimated_duration_seconds
                ? ` (max ${l.estimated_duration_seconds.toFixed(1)}s)`
                : '';
            return `${i + 1}. "${l.text}"${timing}`;
        })
        .join('\n');

    const { executeLLM } = await import('@kit/prompt-engine/server');

    const result = await executeLLM<string>({
        templateSlug: 'dialogue-translation',
        variables: {
            target_language: targetLangName,
            dialogue_lines: linesText,
            preserve_timing: data.preserveTiming,
        },
        context: {
            name: 'translate-dialogue',
            accountId: data.accountId,
            userId: data.userId,
        },
    });

    // Parse translations from numbered output
    const translations = parseNumberedTranslations(result.data, linesToTranslate.length);

    // 4. INSERT translated lines
    const newLines = linesToTranslate.map((line, index) => ({
        episode_id: line.episode_id,
        character_asset_id: line.character_asset_id,
        shot_id: line.shot_id,
        text: translations[index] || line.text,
        sequence_number: line.sequence_number,
        scene_number: line.scene_number,
        timeline_start_seconds: line.timeline_start_seconds,
        estimated_duration_seconds: line.estimated_duration_seconds,
        language: data.targetLanguage,
        source_dialogue_id: line.id,
        status: 'pending',
    }));

    const { error: insertError } = await supabase
        .from('dialogue_lines')
        .insert(newLines);

    if (insertError) {
        throw new Error(`Failed to insert translations: ${insertError.message}`);
    }

    console.log(`[Translate Dialogue] Inserted ${newLines.length} translated lines`);

    return {
        success: true,
        data: { translatedCount: newLines.length },
    };
}

function parseNumberedTranslations(content: string, expectedCount: number): string[] {
    const lines = content.split('\n').filter(l => l.trim());
    const translations: string[] = [];

    for (const line of lines) {
        const match = line.match(/^\d+[.:)]\s*["']?(.+?)["']?\s*$/);
        if (match?.[1]) {
            translations.push(match[1].trim());
        } else if (!line.match(/^\d+[.:]/) && translations.length < expectedCount) {
            translations.push(line.trim().replace(/^["']|["']$/g, ''));
        }
    }

    while (translations.length < expectedCount) {
        translations.push('');
    }

    return translations.slice(0, expectedCount);
}
