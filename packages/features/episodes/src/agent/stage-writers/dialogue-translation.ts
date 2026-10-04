import { defineStageWriter } from '@kit/ai-gateway';
import {
  type Ctx,
  type DialogueTranslationTarget,
  dialogueTranslationStage,
  loadDialogueTranslationInputs,
  numberedDialogue,
} from '@kit/generation';

import { sanitizeForPrompt } from '../../lib';

interface OrchestratedTranslation {
  /** Translated text by source line id; a line the model left blank is absent */
  byLine: Map<string, string>;
  orchestratorSteps: number;
  verificationScore?: number;
  verdict?: string;
}

/**
 * The Translation Orchestrator (translateDialogue → verifyTranslation →
 * re-translate divergent lines, max 1 cycle) translates every line in one
 * pass on the first part's brief; each part takes its own lines from it.
 */
export const dialogueTranslationStageWriter = defineStageWriter(
  dialogueTranslationStage,
  (_run, { ctx, target }) => {
    let orchestrated: OrchestratedTranslation | undefined;

    return async (brief) => {
      const first = !orchestrated;
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
        diagnostics: first
          ? {
              orchestratorSteps: orchestrated.orchestratorSteps,
              verificationScore: orchestrated.verificationScore,
              verdict: orchestrated.verdict,
            }
          : undefined,
      };
    };
  },
);

async function translateAll(
  ctx: Ctx,
  target: DialogueTranslationTarget,
): Promise<OrchestratedTranslation> {
  const inputs = await loadDialogueTranslationInputs(ctx, target);
  const { linesToTranslate } = inputs;

  const { runTranslationOrchestrator } = await import(
    '../translation-orchestrator'
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
