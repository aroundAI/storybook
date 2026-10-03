/**
 * Translate Dialogue Handler
 *
 * Translates English dialogue lines to the target language. The work is the
 * `dialogue_translation` stage of `@kit/generation` (FILM-1901): the stage
 * reads the lines still to translate (one part per scene), the Translation
 * Orchestrator writes every line in one quality-verified pass
 * (translateDialogue → verifyTranslation → re-translate divergent lines,
 * max 1 cycle), each part is checked against the stage's schema, and
 * commit inserts the translated dialogue_lines rows.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

import { sanitizeForPrompt } from '@kit/episodes/lib';
import {
  type Brief,
  type GenerateResult,
  dialogueTranslationStage,
  loadDialogueTranslationInputs,
  numberedDialogue,
  runStage,
} from '@kit/generation';
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

interface OrchestratedTranslation {
  /** Translated text by source line id; a line the model left blank is absent */
  byLine: Map<string, string>;
  orchestratorSteps: number;
  verificationScore?: number;
  verdict?: string;
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

  // The orchestrator translates every line in one pass; the first part's
  // call runs it, and each part takes its own lines from the result.
  let orchestrated: OrchestratedTranslation | undefined;

  const generate = async (brief: Brief): Promise<GenerateResult> => {
    orchestrated ??= await translateAll(ctx, target);

    const context = brief.context as {
      lines: Array<{ sourceDialogueId: string }>;
    };

    return {
      output: {
        translations: context.lines.flatMap(({ sourceDialogueId }) => {
          const text = orchestrated?.byLine.get(sourceDialogueId);

          return text ? [{ sourceDialogueId, text }] : [];
        }),
      },
    };
  };

  const { commit } = await runStage(dialogueTranslationStage, ctx, target, {
    ...stageRunDeps(),
    generate,
  });

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

async function translateAll(
  ctx: ReturnType<typeof workerCtx>,
  target: {
    episodeId: string;
    targetLanguage: string;
    preserveTiming: boolean;
  },
): Promise<OrchestratedTranslation> {
  const inputs = await loadDialogueTranslationInputs(ctx, target);
  const { linesToTranslate } = inputs;

  const { runTranslationOrchestrator } = await import(
    '@kit/episodes/agent/translation-orchestrator'
  );

  const orchestratorResult = await runTranslationOrchestrator({
    episodeId: target.episodeId,
    targetLanguage: target.targetLanguage,
    targetLanguageName: inputs.targetLanguageName,
    preserveTiming: target.preserveTiming,
    accountId: ctx.accountId,
    dialogueLines: numberedDialogue(linesToTranslate, target.preserveTiming),
    lineCount: linesToTranslate.length,
    targetAudience: sanitizeForPrompt(inputs.targetAudience),
  });

  if (!orchestratorResult.success) {
    throw new Error(
      `Translation Orchestrator failed: ${orchestratorResult.error ?? 'Unknown error'}`,
    );
  }

  // Strip numbered prefixes (e.g. "1. ", "23. ") and surrounding quotes: the
  // prompt asks for lines "numbered to match the input", which must not be
  // stored in the dialogue text.
  const cleaned = orchestratorResult.translations.map((t) =>
    t.replace(/^\d+\.\s*/, '').replace(/^["']|["']$/g, ''),
  );

  const byLine = new Map<string, string>();

  linesToTranslate.forEach((line, index) => {
    const text = cleaned[index];

    if (text) byLine.set(line.id, text);
  });

  return {
    byLine,
    orchestratorSteps: orchestratorResult.orchestratorSteps,
    verificationScore: orchestratorResult.verificationScore,
    verdict: orchestratorResult.verdict,
  };
}
