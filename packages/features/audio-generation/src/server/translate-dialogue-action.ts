'use server';

import 'server-only';

import { z } from 'zod';

import { createLLMClient } from '@kit/llm';
import { enhanceAction } from '@kit/next/actions';
import { getLogger } from '@kit/shared/logger';
import { requireUser } from '@kit/supabase/require-user';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

import type { SupportedLanguage } from '../lib/types/dialogue.types';
import { SUPPORTED_LANGUAGES } from '../lib/types/dialogue.types';

/**
 * Schema for translate dialogue action
 */
const TranslateDialogueSchema = z.object({
    episodeId: z.string().uuid(),
    targetLanguage: z.enum(['hi', 'es', 'pt']),
    preserveTiming: z.boolean().default(true),
});

export type LocalizeDialogueInput = z.infer<typeof TranslateDialogueSchema>;

export interface LocalizeDialogueResult {
    success: boolean;
    translatedCount: number;
    error?: string;
}

interface DialogueLineRow {
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

/**
 * Translate all English dialogue lines to a target language
 * 
 * Creates new dialogue_lines with:
 * - Same character, shot, timing as original
 * - Translated text
 * - language = target language
 * - source_dialogue_id = original line's ID
 */
export const translateDialogueToLanguageAction = enhanceAction(
    async (input): Promise<LocalizeDialogueResult> => {
        const logger = await getLogger();
        const ctx = {
            name: 'translate-dialogue',
            episodeId: input.episodeId,
            targetLanguage: input.targetLanguage,
        };

        logger.info(ctx, 'Starting dialogue translation');

        const client = getSupabaseServerClient();
        const { data: user, error: authError } = await requireUser(client);

        if (authError || !user) {
            logger.warn(ctx, 'Unauthorized translation attempt');
            throw new Error('Authentication required');
        }

        try {
            // 1. Fetch English dialogue lines for this episode
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const { data: englishLines, error: fetchError } = await (client as any)
                .from('dialogue_lines')
                .select(`
          id,
          episode_id,
          character_asset_id,
          shot_id,
          text,
          sequence_number,
          scene_number,
          timeline_start_seconds,
          estimated_duration_seconds
        `)
                .eq('episode_id', input.episodeId)
                .eq('language', 'en')
                .order('sequence_number', { ascending: true });

            if (fetchError) {
                throw new Error(`Failed to fetch dialogue: ${fetchError.message}`);
            }

            const lines = (englishLines ?? []) as DialogueLineRow[];

            if (lines.length === 0) {
                return { success: true, translatedCount: 0 };
            }

            // 2. Check if translations already exist
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const { data: existing } = await (client as any)
                .from('dialogue_lines')
                .select('source_dialogue_id')
                .eq('episode_id', input.episodeId)
                .eq('language', input.targetLanguage);

            const existingSourceIds = new Set(
                (existing ?? []).map((e: { source_dialogue_id: string }) => e.source_dialogue_id)
            );

            // Filter out already translated lines
            const linesToTranslate = lines.filter(l => !existingSourceIds.has(l.id));

            if (linesToTranslate.length === 0) {
                logger.info(ctx, 'All lines already translated');
                return { success: true, translatedCount: 0 };
            }

            // 3. Translate using LLM
            const targetLangName = SUPPORTED_LANGUAGES[input.targetLanguage as SupportedLanguage];
            const translations = await translateWithLLM(
                linesToTranslate,
                targetLangName,
                input.preserveTiming,
                logger,
                ctx,
            );

            // 4. Insert translated dialogue lines
            const newLines = linesToTranslate.map((line, index) => ({
                episode_id: line.episode_id,
                character_asset_id: line.character_asset_id,
                shot_id: line.shot_id,
                text: translations[index] ?? line.text,
                sequence_number: line.sequence_number,
                scene_number: line.scene_number,
                timeline_start_seconds: line.timeline_start_seconds,
                estimated_duration_seconds: line.estimated_duration_seconds,
                language: input.targetLanguage,
                source_dialogue_id: line.id,
                status: 'pending', // Needs TTS generation
            }));

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const { error: insertError } = await (client as any)
                .from('dialogue_lines')
                .insert(newLines);

            if (insertError) {
                throw new Error(`Failed to insert translations: ${insertError.message}`);
            }

            logger.info(
                { ...ctx, count: newLines.length },
                'Dialogue translated successfully',
            );

            return { success: true, translatedCount: newLines.length };
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown error';
            logger.error({ ...ctx, error: message }, 'Translation failed');
            return { success: false, translatedCount: 0, error: message };
        }
    },
    {
        schema: TranslateDialogueSchema,
    },
);

/**
 * Translate dialogue lines using LLM
 * Preserves ElevenLabs audio tags like [excited], [sigh] in the output
 */
async function translateWithLLM(
    lines: DialogueLineRow[],
    targetLanguage: string,
    preserveTiming: boolean,
    logger: Awaited<ReturnType<typeof getLogger>>,
    ctx: Record<string, unknown>,
): Promise<string[]> {
    const llm = createLLMClient();

    // Build prompt with all lines for batch translation
    const linesText = lines
        .map((l, i) => {
            const timing = preserveTiming && l.estimated_duration_seconds
                ? ` (max ${l.estimated_duration_seconds.toFixed(1)}s speaking time)`
                : '';
            return `${i + 1}. "${l.text}"${timing}`;
        })
        .join('\n');

    const timingInstruction = preserveTiming
        ? `IMPORTANT: Keep each translation roughly the same speaking duration as the original. 
       Shorten or rephrase if needed to maintain similar timing.`
        : '';

    const prompt = `Translate the following dialogue lines to ${targetLanguage}.
${timingInstruction}

Return ONLY the translations, one per line, numbered to match the input.
Do not include any explanation or the original text.

Dialogue to translate:
${linesText}`;

    try {
        const response = await llm.createChatCompletion({
            messages: [
                {
                    role: 'system',
                    content: `You are a professional translator for ${targetLanguage} film/TV dialogue.

TRANSLATION STYLE - CRITICAL:
- Use MODERN COLLOQUIAL language - how young urban speakers actually talk TODAY
- Match the casual, natural energy of the original English
- Avoid formal/literary/textbook translations - these sound unnatural in dialogue
- Use contractions, slang, and natural speech patterns common in the target language
- Code-mixing is acceptable where natural (e.g., Hindi speakers mix English words)

AUDIO TAGS - CRITICAL:
1. PRESERVE all [audio tags] exactly as written - these are ElevenLabs TTS instructions
2. Tags like [excited], [sigh], [whispers], [pauses], [laughs] must STAY IN ENGLISH
3. Only translate the dialogue text AROUND the tags
4. Do not translate, modify, or remove ANY text inside square brackets

EXAMPLES (Modern Colloquial vs Formal):
English: "[nervous] Are you sure about this? [gulps] I don't think I can."
Hindi GOOD: "[nervous] यार, तू sure है? [gulps] मुझसे नहीं होगा।"
Hindi BAD (too formal): "[nervous] क्या आप इसके बारे में सुनिश्चित हैं? [gulps] मुझे नहीं लगता मैं कर सकता।"

Spanish GOOD: "[nervous] ¿Estás seguro de esto? [gulps] No creo que pueda, wey."
Portuguese GOOD: "[nervous] Cara, tu tem certeza? [gulps] Acho que não consigo."

Translate naturally while preserving emotion, character voice, and timing.`,
                },
                {
                    role: 'user',
                    content: prompt,
                },
            ],
            temperature: 0.3,
        });

        const content = response.message.content ?? '';

        // Parse numbered translations
        const translations = parseNumberedTranslations(content, lines.length);

        // Validate audio tag preservation (warning only)
        let tagsPreserved = 0;
        let tagsLost = 0;
        for (let i = 0; i < lines.length; i++) {
            const originalTags: string[] = lines[i]?.text.match(/\[[a-zA-Z\s]+\]/g) ?? [];
            const translatedTags: string[] = translations[i]?.match(/\[[a-zA-Z\s]+\]/g) ?? [];

            for (const tag of originalTags) {
                if (translatedTags.includes(tag)) {
                    tagsPreserved++;
                } else {
                    tagsLost++;
                    logger.warn(
                        { ...ctx, line: i + 1, tag, originalText: lines[i]?.text?.substring(0, 50) ?? '' },
                        'Audio tag lost in translation'
                    );
                }
            }
        }

        if (tagsLost > 0) {
            logger.warn(
                { ...ctx, tagsPreserved, tagsLost },
                'Some audio tags were not preserved during translation'
            );
        }

        logger.info({ ...ctx, translationCount: translations.length, tagsPreserved, tagsLost }, 'LLM translation complete');

        return translations;
    } catch (error) {
        logger.error({ ...ctx, error }, 'LLM translation failed');
        // Return original text as fallback
        return lines.map(l => l.text);
    }
}


/**
 * Parse numbered translations from LLM output
 */
function parseNumberedTranslations(content: string, expectedCount: number): string[] {
    const lines = content.split('\n').filter(l => l.trim());
    const translations: string[] = [];

    for (const line of lines) {
        // Match patterns like "1. translation" or "1: translation" or just "translation"
        const match = line.match(/^\d+[.:)]\s*["']?(.+?)["']?\s*$/);
        if (match?.[1]) {
            translations.push(match[1].trim());
        } else if (!line.match(/^\d+[.:)]/) && translations.length < expectedCount) {
            // Line without number - might be a translation
            translations.push(line.trim().replace(/^["']|["']$/g, ''));
        }
    }

    // Pad with empty strings if we didn't get enough
    while (translations.length < expectedCount) {
        translations.push('');
    }

    return translations.slice(0, expectedCount);
}
