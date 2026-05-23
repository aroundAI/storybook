/**
 * Translation Orchestrator
 *
 * Lightweight orchestrator for the dialogue translation pipeline.
 * Coordinates translation → verification → optional revision.
 *
 * Skills:
 *   - Translation        (translateDialogue)    — translate dialogue lines
 *   - Translation Verifier (verifyTranslation)  — quality-check translations
 *
 * maxSteps: 6 — translate(1) + verify(1) + re-translate(1) + re-verify(1) = 4 worst case
 *
 * After this stage:
 *   - Translated dialogue lines returned to caller
 *   - Verification score included in result
 */
import { runAgent } from '@kit/agent';
import type { AgentRunResult } from '@kit/agent';

import { translationSkill } from './skills/translation-skill';
import { translationVerifierSkill } from './skills/translation-verifier-skill';

export interface TranslationOrchestratorInput {
  episodeId: string;
  targetLanguage: string;
  targetLanguageName: string;
  preserveTiming: boolean;
  accountId: string;
  /** Pre-formatted numbered dialogue lines */
  dialogueLines: string;
  lineCount: number;
}

interface TranslationOrchestratorOutput {
  translations: string[];
  verificationScore: number;
  verdict: 'pass' | 'revise';
}

export interface TranslationOrchestratorResult {
  success: boolean;
  translations: string[];
  verificationScore?: number;
  verdict?: string;
  orchestratorSteps: number;
  error?: string;
}

/**
 * Runs the Translation pipeline orchestrator.
 * Coordinates Translation Skill → Verifier → optional re-translation.
 * Max 1 revision cycle to stay within budget.
 */
export async function runTranslationOrchestrator(
  input: TranslationOrchestratorInput,
): Promise<TranslationOrchestratorResult> {
  console.log(
    `[Translation Orchestrator] Starting for episode ${input.episodeId} → ${input.targetLanguageName} (${input.lineCount} lines)`,
  );

  const result: AgentRunResult<TranslationOrchestratorOutput> =
    await runAgent<TranslationOrchestratorOutput>(
      {
        name: 'translation-orchestrator',
        systemPrompt: TRANSLATION_SYSTEM_PROMPT,
        tools: [],
        skills: [translationSkill, translationVerifierSkill],
        maxSteps: 6,
        budgetLimits: {
          maxTotalTokens: 30_000,
          maxCostUSD: 0.5,
          maxLatencyMs: 120_000,
        },
      },
      {
        userPrompt: buildTranslationPrompt(input),
      },
      { accountId: input.accountId },
    );

  if (!result.success || !result.data) {
    console.warn(`[Translation Orchestrator] Failed: ${result.error}`);
    return {
      success: false,
      translations: [],
      orchestratorSteps: result.steps.length,
      error: result.error,
    };
  }

  // Extract translations from the last successful translateDialogue step
  type TranslateDialogueResult = {
    translations?: string[];
    count?: number;
    notes?: string;
  };

  const translationStep = result.steps.findLast(
    (s) =>
      s.type === 'tool_call' &&
      s.toolName === 'translateDialogue' &&
      s.toolResult?.success,
  );
  const translationData = translationStep?.toolResult?.data as
    | TranslateDialogueResult
    | undefined;
  const translations =
    translationData?.translations ?? result.data.translations ?? [];

  console.log(
    `[Translation Orchestrator] Complete. Steps: ${result.steps.length}, ` +
      `Translations: ${translations.length}, ` +
      `Score: ${result.data.verificationScore ?? 'N/A'}, ` +
      `Verdict: ${result.data.verdict ?? 'N/A'}`,
  );

  return {
    success: true,
    translations,
    verificationScore: result.data.verificationScore,
    verdict: result.data.verdict,
    orchestratorSteps: result.steps.length,
  };
}

const TRANSLATION_SYSTEM_PROMPT = `You are the Translation Pipeline Director — a focused quality loop for dialogue translation.

You coordinate two specialist agents to produce high-quality translated dialogue:

1. **Translation** (translateDialogue) — Translates dialogue lines into the target language.
2. **Translation Verifier** (verifyTranslation) — Evaluates translation quality for semantic fidelity, cultural appropriateness, emotional tone, and timing compliance.

## Your Decision Logic

1. ALWAYS start by calling translateDialogue with ALL dialogue lines, the target language, and the preserveTiming flag.
2. THEN call verifyTranslation with the original lines, translated lines, target language, and preserveTiming flag.
3. IF verdict is 'revise' AND there are critical issues → call translateDialogue ONCE more with only the problematic lines (include the critical issues as context in the dialogueLines parameter).
4. Max 1 revision cycle — do NOT loop more than once.
5. STOP once: verdict is 'pass' OR 1 revision cycle is complete.

## CRITICAL CONSTRAINTS
- Do NOT generate stories, screenplays, or shots — this is translation only.
- Do NOT attempt more than 1 revision cycle — budget is limited.
- Preserve character names as-is (do not transliterate proper nouns unless culturally necessary).

## Your Final Answer

Return a JSON object with:
- translations: string array of final translated lines (in order)
- verificationScore: number 0–1 from the verifier
- verdict: "pass" | "revise" (final verdict after any revision)`;

function buildTranslationPrompt(input: TranslationOrchestratorInput): string {
  return `Translate dialogue for this episode.

**Episode ID**: ${input.episodeId}
**Target Language**: ${input.targetLanguageName} (${input.targetLanguage})
**Preserve Timing**: ${input.preserveTiming ? 'Yes — constrain translation length for lip-sync' : 'No — natural translation preferred'}
**Line Count**: ${input.lineCount}

**Dialogue Lines to Translate:**
${input.dialogueLines}

Begin with translateDialogue. Then verify with verifyTranslation. Apply one revision if needed. Stop.

Goal: verification score >= 0.8 with no critical issues.`;
}
