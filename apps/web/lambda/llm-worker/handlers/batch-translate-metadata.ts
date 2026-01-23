/**
 * Batch Translate Metadata Handler
 *
 * Translates multiple content items (full videos, shorts groups) in a single LLM call.
 * More efficient than multiple individual calls.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

interface TranslationItem {
    id: string;
    contentType: 'full-video' | 'shorts-group';
    title: string;
    description: string;
    targetLanguage: string;
    groupId?: string;
    groupName?: string;
}

interface BatchTranslatePayload {
    items: TranslationItem[];
}

interface TranslatedItem {
    id: string;
    translatedTitle: string;
    translatedDescription: string;
    targetLanguage: string;
    contentType: 'full-video' | 'shorts-group';
    groupId?: string;
}

interface BatchTranslateResult {
    success: boolean;
    data: {
        items: TranslatedItem[];
    };
}

export async function processBatchTranslateMetadata(
    payload: Record<string, unknown>,
    supabase: SupabaseClient,
): Promise<BatchTranslateResult> {
    const data = payload as BatchTranslatePayload;

    console.log(
        `[Batch Translate] Translating ${data.items.length} items`,
    );

    if (data.items.length === 0) {
        return {
            success: true,
            data: { items: [] },
        };
    }

    // Group items by target language for efficiency
    const itemsByLanguage = data.items.reduce(
        (acc, item) => {
            if (!acc[item.targetLanguage]) {
                acc[item.targetLanguage] = [];
            }
            acc[item.targetLanguage].push(item);
            return acc;
        },
        {} as Record<string, TranslationItem[]>,
    );

    const translatedItems: TranslatedItem[] = [];

    // Execute LLM for each language batch
    const { executeLLM } = await import('@kit/prompt-engine/server');

    for (const [targetLanguage, items] of Object.entries(itemsByLanguage)) {
        console.log(
            `[Batch Translate] Processing ${items.length} items for ${targetLanguage}`,
        );

        try {
            // Build a single prompt with all items for this language
            // Include id and targetLanguage in each item for unambiguous matching
            const itemsForPrompt = items.map((item) => ({
                id: item.id,
                targetLanguage: item.targetLanguage,
                title: item.title,
                description: item.description,
            }));

            const result = await executeLLM<{
                translations: Array<{
                    id: string;
                    targetLanguage: string;
                    title: string;
                    description: string;
                }>;
            }>({
                templateSlug: 'batch-translate-metadata',
                variables: {
                    targetLanguage,
                    items: JSON.stringify(itemsForPrompt, null, 2),
                    itemCount: items.length,
                },
                context: {
                    name: 'batch-translate-metadata',
                    accountId: 'system',
                },
                supabaseClient: supabase,
            });

            // Map results back to items - match by id (order doesn't matter)
            const translationsMap = new Map(
                result.data?.translations?.map((t) => [t.id, t]) || [],
            );

            for (const item of items) {
                const translation = translationsMap.get(item.id);
                translatedItems.push({
                    id: item.id,
                    translatedTitle: translation?.title || item.title,
                    translatedDescription: translation?.description || item.description,
                    targetLanguage,
                    contentType: item.contentType,
                    groupId: item.groupId,
                });
            }
        } catch (error) {
            console.error(
                `[Batch Translate] Error for ${targetLanguage}:`,
                error,
            );
            // Fall back to original text for failed translations
            for (const item of items) {
                translatedItems.push({
                    id: item.id,
                    translatedTitle: item.title,
                    translatedDescription: item.description,
                    targetLanguage,
                    contentType: item.contentType,
                    groupId: item.groupId,
                });
            }
        }
    }

    console.log(
        `[Batch Translate] Complete: ${translatedItems.length} items translated`,
    );

    return {
        success: true,
        data: { items: translatedItems },
    };
}
