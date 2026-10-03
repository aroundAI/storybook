/**
 * Batch Translate Metadata Handler
 *
 * Translates multiple content items (full videos, shorts groups) across
 * multiple languages in a SINGLE LLM call. The work is the
 * `publish_metadata` stage of `@kit/generation` (FILM-1901): prepare builds
 * the brief, the executor writes, the reply is checked against the stage's
 * schema, and commit returns every item with its translation or, when the
 * model skipped it, its own text. Nothing is written: the publish draft
 * lives in the publish screen, which receives this result over WebSocket.
 *
 * A failed or rejected model reply falls back to the original text for
 * every item, as it always did: publishing does not block on translation.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

import {
  type Brief,
  type GenerateResult,
  type TranslatedPublishItem,
  publishMetadataStage,
  runStage,
} from '@kit/generation';
import { parseLlmJobPayload } from '@kit/prompt-engine/llm-job-payloads';
import type { Database } from '@kit/supabase/database';

import { stageRunDeps, workerCtx } from '../utils/stage-runtime';

interface BatchTranslateResult {
  success: boolean;
  data: {
    items: TranslatedPublishItem[];
  };
}

async function generateWithExecuteLLM(brief: Brief): Promise<GenerateResult> {
  const { executeLLM } = await import('@kit/ai-gateway');

  const result = await executeLLM<unknown>({
    templateSlug: brief.prompt.slug,
    variables: brief.prompt.variables,
    context: { name: 'batch-translate-metadata', accountId: 'system' },
  });

  return { output: result.data };
}

export async function processBatchTranslateMetadata(
  payload: Record<string, unknown>,
  supabase: SupabaseClient<Database>,
): Promise<BatchTranslateResult> {
  const data = parseLlmJobPayload('batch-translate-metadata', payload);

  console.log(`[Batch Translate] Processing ${data.items.length} items`);

  if (data.items.length === 0) {
    return { success: true, data: { items: [] } };
  }

  try {
    const { commit } = await runStage(
      publishMetadataStage,
      workerCtx(supabase, {
        accountId: data.accountId,
        userId: data.userId ?? 'system',
      }),
      { items: data.items },
      { ...stageRunDeps(), generate: generateWithExecuteLLM },
    );

    console.log(
      `[Batch Translate] Complete: ${commit.data.items.length} items`,
    );

    return { success: true, data: { items: commit.data.items } };
  } catch (error) {
    console.error('[Batch Translate] LLM call failed:', error);

    // Fallback: return original text for all items
    const fallbackItems: TranslatedPublishItem[] = data.items.map((item) => ({
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
