/**
 * Translation Skill
 *
 * Wraps dialogue translation as an agent-callable tool.
 * Uses the `dialogue-translation` prompt template to translate
 * numbered dialogue lines into the target language while preserving
 * emotional tone, cultural context, and optionally lip-sync timing.
 * The language codes and style guides live in `@kit/generation`'s
 * dialogue_translation stage, which renders the same prompt as a brief.
 *
 * Used by the Translation Orchestrator to translate dialogue for
 * multi-language episode output.
 */
import { z } from 'zod';

import type { Skill } from '@kit/agent';
import { createTool, toolError, toolSuccess } from '@kit/agent';
import {
  DEFAULT_TARGET_DEMOGRAPHIC,
  LANGUAGE_CODE_MAP,
  languageStyleGuide,
} from '@kit/generation';

const translateDialogueTool = createTool({
  name: 'translateDialogue',
  description:
    'Translates numbered dialogue lines into a target language. Preserves emotional tone, cultural nuance, and character voice. When preserveTiming is true, translations are constrained to match original syllable/word counts for lip-sync compatibility.',
  parameters: z.object({
    dialogueLines: z
      .string()
      .describe(
        'Numbered dialogue lines to translate (e.g. "1. Hello, world\\n2. How are you?")',
      ),
    targetLanguage: z
      .string()
      .describe('Target language name (e.g. "Hindi", "Spanish", "Japanese")'),
    preserveTiming: z
      .boolean()
      .describe(
        'Whether to constrain translation length for lip-sync compatibility',
      ),
  }),

  execute: async (
    { dialogueLines, targetLanguage, preserveTiming },
    context,
  ) => {
    try {
      const { executeLLM } = await import('@kit/prompt-engine/server');

      // Look up language-specific style guide
      const langCode = LANGUAGE_CODE_MAP[targetLanguage.toLowerCase()] ?? '';
      const styleGuide = languageStyleGuide(langCode);
      const targetDemographic =
        ((context as Record<string, unknown>).targetAudience as string) ||
        DEFAULT_TARGET_DEMOGRAPHIC;

      const result = await executeLLM<string>({
        templateSlug: 'dialogue-translation',
        variables: {
          dialogue_lines: dialogueLines,
          target_language: targetLanguage,
          preserve_timing: preserveTiming,
          language_style_guide: styleGuide,
          target_demographic: targetDemographic,
        },
        context: {
          name: 'agent.translation.translateDialogue',
          accountId: context.accountId,
        },
      });

      // executeLLM returns raw string for output.type="text" prompts
      // Parse numbered lines: "1. [serious] सुबह...\n2. [alert] यिप!..."
      const rawText = result.data;

      const translations = rawText
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.length > 0)
        .map((line) => line.replace(/^\d+\.\s*/, ''));

      return toolSuccess({
        translations,
        count: translations.length,
      });
    } catch (error) {
      return toolError(`Translation failed: ${(error as Error).message}`);
    }
  },

  // Keep translations in summary — they are the core output data.
  // Previously dropped to save context tokens, but this caused Hindi/CJK
  // translations to silently fall back to English (Devanagari tokens are
  // too expensive for the agent LLM to reproduce in its final answer).
  summarizeResult: (result) => {
    if (!result.success || !result.data) return result;
    const d = result.data as Record<string, unknown>;
    return {
      success: true,
      translations: d.translations,
      count: d.count,
      notes: d.notes,
    };
  },
});

export const translationSkill: Skill = {
  name: 'translation',
  description:
    'Translates dialogue lines into a target language while preserving emotional tone, cultural context, and character voice. Optionally constrains translation length for lip-sync timing compatibility.',
  tools: [translateDialogueTool],
  contextPrompt: `You have access to a Dialogue Translator that converts numbered dialogue lines into a target language.

The translator preserves:
- Emotional tone and subtext of each line
- Cultural context and idiomatic equivalence (not literal word-for-word)
- Character voice consistency across all lines
- When preserveTiming is enabled: syllable/word count constraints for lip-sync compatibility

The tool accepts pre-formatted numbered lines and returns an array of translated strings in the same order.`,
  instructions: `1. Pass ALL dialogue lines as a single numbered list to translateDialogue
2. Set preserveTiming=true if the translations will be used for dubbed video with lip-sync requirements
3. If preserveTiming is true, translations must fit within the original timing constraints — shorter is acceptable, longer is not
4. The returned translations array maintains the same ordering as the input lines`,
};
