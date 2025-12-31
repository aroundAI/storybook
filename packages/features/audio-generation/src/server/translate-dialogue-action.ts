'use server';

import 'server-only';

import { z } from 'zod';

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

        const client = getSupabaseServerClient();
        const { data: user, error: authError } = await requireUser(client);

        if (authError || !user) {
            logger.warn({ name: 'translate-dialogue', episodeId: input.episodeId }, 'Unauthorized translation attempt');
            throw new Error('Authentication required');
        }

        // Get episode to retrieve accountId
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data: episode } = await (client as any)
            .from('episodes')
            .select('id, project:projects(account_id)')
            .eq('id', input.episodeId)
            .single();

        const accountId = episode?.project?.account_id ?? 'unknown';

        const ctx = {
            name: 'translate-dialogue',
            episodeId: input.episodeId,
            targetLanguage: input.targetLanguage,
            accountId,
            userId: user.id,
        };

        logger.info(ctx, 'Starting dialogue translation');

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
 * Uses Gemini directly since translation returns plain text, not JSON
 */
async function translateWithLLM(
    lines: DialogueLineRow[],
    targetLanguage: string,
    preserveTiming: boolean,
    logger: Awaited<ReturnType<typeof getLogger>>,
    ctx: { name: string; accountId: string; userId?: string;[key: string]: string | number | undefined },
): Promise<string[]> {
    // Build dialogue lines text
    const linesText = lines
        .map((l, i) => {
            const timing = preserveTiming && l.estimated_duration_seconds
                ? ` (max ${l.estimated_duration_seconds.toFixed(1)}s speaking time)`
                : '';
            return `${i + 1}. "${l.text}"${timing}`;
        })
        .join('\n');

    try {
        // Load LLM config from prompt template (provider, model, temperature from JSON)
        const { loadAndRenderPrompt, getApiKeyForProvider } = await import('@kit/prompt-engine/server');
        const { createLLMClient } = await import('@kit/llm');

        const rendered = await loadAndRenderPrompt('dialogue-translation', {
            target_language: targetLanguage,
            dialogue_lines: linesText,
            preserve_timing: preserveTiming,
        });

        // Get API key using shared utility
        const provider = rendered.llmConfig.provider;
        const apiKey = getApiKeyForProvider(provider);

        if (!apiKey) {
            throw new Error(`No API key found for provider: ${provider}`);
        }

        const llm = createLLMClient({
            provider: provider as 'gemini' | 'openai' | 'anthropic' | 'deepseek',
            model: rendered.llmConfig.model,
            apiKey,
        });

        const response = await llm.createChatCompletion({
            messages: [
                {
                    role: 'system',
                    content: rendered.systemPrompt,
                },
                {
                    role: 'user',
                    content: rendered.userPrompt,
                },
            ],
            temperature: rendered.llmConfig.temperature,
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
