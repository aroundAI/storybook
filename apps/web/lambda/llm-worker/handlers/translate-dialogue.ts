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
import { parseLlmJobPayload } from '@kit/prompt-engine/llm-job-payloads';
import type { Database } from '@kit/supabase/database';

import { stageRunDeps, workerCtx } from '../utils/stage-runtime';

interface TranslateDialogueResult {
  success: boolean;
  data: {
    translatedCount: number;
    orchestratorSteps?: number;
    verificationScore?: number;
    verdict?: string;
  };
}

export async function processTranslateDialogue(
  payload: Record<string, unknown>,
  supabase: SupabaseClient<Database>,
): Promise<TranslateDialogueResult> {
  const data = parseLlmJobPayload('translate-dialogue', payload);

  console.log(
    `[Translate Dialogue] Starting AGENTIC pipeline for episode ${data.episodeId} to ${data.targetLanguage}`,
  );

  const ctx = workerCtx(supabase, data);
  const target = {
    episodeId: data.episodeId,
    targetLanguage: data.targetLanguage,
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
