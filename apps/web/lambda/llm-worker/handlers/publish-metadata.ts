/**
 * Publish Metadata Handler
 *
 * Translates title/description to target language.
 * No database writes - returns translated text.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

interface PublishMetadataPayload {
    title: string;
    description: string;
    targetLanguage: string;
}

interface PublishMetadataResult {
    success: boolean;
    data: {
        translatedTitle: string;
        translatedDescription: string;
        targetLanguage: string;
    };
}

export async function processPublishMetadata(
    payload: Record<string, unknown>,
    _supabase: SupabaseClient,
): Promise<PublishMetadataResult> {
    const data = payload as PublishMetadataPayload;

    console.log(`[Publish Metadata] Translating to ${data.targetLanguage}`);

    // Skip translation for English
    if (data.targetLanguage === 'en') {
        return {
            success: true,
            data: {
                translatedTitle: data.title,
                translatedDescription: data.description,
                targetLanguage: data.targetLanguage,
            },
        };
    }

    // Execute LLM
    const { executeLLM } = await import('@kit/prompt-engine/server');

    try {
        const result = await executeLLM<{ title: string; description: string }>({
            templateSlug: 'publishing/translate-metadata',
            variables: {
                title: data.title,
                description: data.description,
                targetLanguage: data.targetLanguage,
            },
            context: {
                name: 'translate-metadata',
                accountId: 'system',
            },
        });

        console.log('[Publish Metadata] Translation complete');

        return {
            success: true,
            data: {
                translatedTitle: result.data?.title || data.title,
                translatedDescription: result.data?.description || data.description,
                targetLanguage: data.targetLanguage,
            },
        };
    } catch (error) {
        console.error('[Publish Metadata] Error:', error);
        // Return original on error
        return {
            success: true,
            data: {
                translatedTitle: data.title,
                translatedDescription: data.description,
                targetLanguage: data.targetLanguage,
            },
        };
    }
}
