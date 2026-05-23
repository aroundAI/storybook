/**
 * Translation Skill
 *
 * Wraps dialogue translation as an agent-callable tool.
 * Uses the `dialogue-translation` prompt template to translate
 * numbered dialogue lines into the target language while preserving
 * emotional tone, cultural context, and optionally lip-sync timing.
 *
 * Used by the Translation Orchestrator to translate dialogue for
 * multi-language episode output.
 */
import { z } from 'zod';

import type { Skill } from '@kit/agent';
import { createTool, toolError, toolSuccess } from '@kit/agent';

interface TranslationResult {
  translations: string[];
  notes?: string;
}

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

      const result = await executeLLM<TranslationResult>({
        templateSlug: 'dialogue-translation',
        variables: {
          dialogue_lines: dialogueLines,
          target_language: targetLanguage,
          preserve_timing: preserveTiming,
        },
        context: {
          name: 'agent.translation.translateDialogue',
          accountId: context.accountId,
        },
      });

      const translations = result.data.translations;

      return toolSuccess({
        translations,
        count: translations.length,
        notes: result.data.notes,
      });
    } catch (error) {
      return toolError(`Translation failed: ${(error as Error).message}`);
    }
  },

  // OPT-2: Keep count + notes, drop full translations array
  summarizeResult: (result) => {
    if (!result.success || !result.data) return result;
    const d = result.data as Record<string, unknown>;
    return {
      success: true,
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
