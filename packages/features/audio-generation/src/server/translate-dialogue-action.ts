'use server';

import 'server-only';

import { z } from 'zod';

import { enhanceAction } from '@kit/next/actions';
import { getLogger } from '@kit/shared/logger';
import { requireUser } from '@kit/supabase/require-user';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

/**
 * Schema for translate dialogue action
 */
const TranslateDialogueSchema = z.object({
  episodeId: z.string().uuid(),
  targetLanguage: z.enum([
    'hi',
    'es',
    'pt',
    'fr',
    'de',
    'ja',
    'ko',
    'zh',
    'ar',
    'bn',
  ]),
  preserveTiming: z.boolean().default(true),
});

export type LocalizeDialogueInput = z.infer<typeof TranslateDialogueSchema>;

export interface LocalizeDialogueResult {
  success: boolean;
  translatedCount: number;
  error?: string;
}

interface _DialogueLineRow {
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
 * In production, queues via SQS for background processing.
 */
export const translateDialogueToLanguageAction = enhanceAction(
  async (input): Promise<LocalizeDialogueResult & { queued?: boolean }> => {
    const logger = await getLogger();

    const client = getSupabaseServerClient();
    const { data: user, error: authError } = await requireUser(client);

    if (authError || !user) {
      logger.warn(
        { name: 'translate-dialogue', episodeId: input.episodeId },
        'Unauthorized translation attempt',
      );
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

    logger.info(ctx, 'Processing dialogue translation request');

    // Always queue to Lambda for processing
    const { queueLlmJob } = await import('@kit/prompt-engine/server');

    await queueLlmJob({
      jobType: 'translate-dialogue',
      userId: user.id,
      payload: {
        episodeId: input.episodeId,
        targetLanguage: input.targetLanguage,
        preserveTiming: input.preserveTiming,
        accountId,
        userId: user.id,
      },
    });

    logger.info(ctx, 'Dialogue translation job queued');
    return { success: true, translatedCount: 0, queued: true };
  },
  { schema: TranslateDialogueSchema },
);

/**
 * Parse numbered translations from LLM output
 */
function _parseNumberedTranslations(
  content: string,
  expectedCount: number,
): string[] {
  const lines = content.split('\n').filter((l) => l.trim());
  const translations: string[] = [];

  for (const line of lines) {
    // Match patterns like "1. translation" or "1: translation" or just "translation"
    const match = line.match(/^\d+[.:)]\s*["']?(.+?)["']?\s*$/);
    if (match?.[1]) {
      translations.push(match[1].trim());
    } else if (
      !line.match(/^\d+[.:)]/) &&
      translations.length < expectedCount
    ) {
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
