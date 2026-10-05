/**
 * Translate Dialogue Handler
 *
 * Translates English dialogue lines to the target language. The work is the
 * `dialogue_translation` stage of `@kit/generation` (FILM-1901): the stage
 * reads the lines still to translate (one part per scene), `run.write`
 * reaches the stage's writer, whose Translation Orchestrator writes every line in one quality-verified pass
 * (translateDialogue → verifyTranslation → re-translate divergent lines,
 * max 1 cycle), each part is checked against the stage's schema, and
 * commit inserts the translated dialogue_lines rows.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

import { dialogueTranslationStage, runStage } from '@kit/generation';
import {
  type LlmJobPayload,
  parseLlmJobPayload,
} from '@kit/prompt-engine/llm-job-payloads';
import type { Database } from '@kit/supabase/database';

import { stageRunDeps, workerCtx } from '../utils/stage-runtime';

interface TranslateDialogueResult {
  success: boolean;
  data: {
    translatedCount: number;
    orchestratorSteps?: number;
    verificationScore?: number;
    verdict?: string;
    languages?: string[];
    failures?: Array<{ language: string; error: string }>;
  };
}

export async function processTranslateDialogue(
  payload: Record<string, unknown>,
  supabase: SupabaseClient<Database>,
  deps: { translate?: typeof translateOneLanguage } = {},
): Promise<TranslateDialogueResult> {
  const data = parseLlmJobPayload('translate-dialogue', payload);
  const translate = deps.translate ?? translateOneLanguage;

  // FILM-2007: a localization into several languages is one run (one
  // translation run per episode may be open), translated one language after
  // another; the dub job of each language waits for its own lines
  const languages = [
    data.targetLanguage,
    ...(data.additionalLanguages ?? []).filter(
      (language) => language !== data.targetLanguage,
    ),
  ];

  if (languages.length === 1) {
    return translate(supabase, data, data.targetLanguage);
  }

  const results: TranslateDialogueResult[] = [];
  const failures: Array<{ language: string; error: string }> = [];

  for (const language of languages) {
    try {
      results.push(await translate(supabase, data, language));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      console.error(
        `[Translate Dialogue] ${language} failed; the other languages go on: ${message}`,
      );
      failures.push({ language, error: message });
    }
  }

  if (results.length === 0) {
    throw new Error(
      `Translation failed for every language: ${failures
        .map((f) => `${f.language}: ${f.error}`)
        .join('; ')}`,
    );
  }

  return {
    success: true,
    data: {
      translatedCount: results.reduce(
        (sum, result) => sum + result.data.translatedCount,
        0,
      ),
      languages: languages.filter(
        (language) => !failures.some((f) => f.language === language),
      ),
      ...(failures.length > 0 ? { failures } : {}),
    },
  };
}

async function translateOneLanguage(
  supabase: SupabaseClient<Database>,
  data: LlmJobPayload<'translate-dialogue'>,
  targetLanguage: string,
): Promise<TranslateDialogueResult> {
  console.log(
    `[Translate Dialogue] Starting AGENTIC pipeline for episode ${data.episodeId} to ${targetLanguage}`,
  );

  const ctx = workerCtx(supabase, data);
  const target = {
    episodeId: data.episodeId,
    targetLanguage,
    preserveTiming: data.preserveTiming,
  };

  const { commit, run } = await runStage(
    dialogueTranslationStage,
    ctx,
    target,
    stageRunDeps(),
  );
  const orchestrated = run.diagnostics as
    | {
        orchestratorSteps: number;
        verificationScore?: number;
        verdict?: string;
      }
    | undefined;

  if (commit.status === 'skipped' || !orchestrated) {
    return { success: true, data: { translatedCount: 0 } };
  }

  console.log(
    `[Translate Dialogue] Agentic pipeline complete. Steps: ${orchestrated.orchestratorSteps}, ` +
      `Lines: ${commit.data.translatedCount}, Score: ${orchestrated.verificationScore?.toFixed(2) ?? 'N/A'}`,
  );

  return {
    success: true,
    data: {
      translatedCount: commit.data.translatedCount,
      orchestratorSteps: orchestrated.orchestratorSteps,
      verificationScore: orchestrated.verificationScore,
      verdict: orchestrated.verdict,
    },
  };
}
