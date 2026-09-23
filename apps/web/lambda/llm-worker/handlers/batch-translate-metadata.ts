/**
 * Batch Translate Metadata Handler
 *
 * Translates multiple content items (full videos, shorts groups) across
 * multiple languages in a SINGLE LLM call.
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
  _supabase: SupabaseClient,
): Promise<BatchTranslateResult> {
  // SQS payload: cast, not validated (KB-33).
  const data = payload as unknown as BatchTranslatePayload;

  console.log(`[Batch Translate] Processing ${data.items.length} items`);

  if (data.items.length === 0) {
    return { success: true, data: { items: [] } };
  }

  // Build input for LLM - include id and targetLanguage for each item
  const itemsForPrompt = data.items.map((item) => ({
    id: item.id,
    targetLanguage: item.targetLanguage,
    title: item.title,
    description: item.description,
  }));

  const { executeLLM } = await import('@kit/prompt-engine/server');

  try {
    // SINGLE LLM CALL for all items across all languages
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
        items: JSON.stringify(itemsForPrompt, null, 2),
        itemCount: data.items.length,
      },
      context: { name: 'batch-translate-metadata', accountId: 'system' },
    });

    // Match results by id (order doesn't matter)
    const translationsMap = new Map(
      result.data?.translations?.map((t) => [t.id, t]) || [],
    );

    // Build output with original metadata enriched
    const translatedItems: TranslatedItem[] = data.items.map((item) => {
      const translation = translationsMap.get(item.id);
      return {
        id: item.id,
        translatedTitle: translation?.title || item.title,
        translatedDescription: translation?.description || item.description,
        targetLanguage: item.targetLanguage,
        contentType: item.contentType,
        groupId: item.groupId,
      };
    });

    console.log(`[Batch Translate] Complete: ${translatedItems.length} items`);

    return { success: true, data: { items: translatedItems } };
  } catch (error) {
    console.error('[Batch Translate] LLM call failed:', error);

    // Fallback: return original text for all items
    const fallbackItems: TranslatedItem[] = data.items.map((item) => ({
      id: item.id,
      translatedTitle: item.title,
      translatedDescription: item.description,
      targetLanguage: item.targetLanguage,
      contentType: item.contentType,
      groupId: item.groupId,
    }));

    return { success: true, data: { items: fallbackItems } };
  }
}
