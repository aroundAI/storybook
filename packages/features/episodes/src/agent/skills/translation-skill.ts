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

const LANGUAGE_CODE_MAP: Record<string, string> = {
  hindi: 'hi',
  spanish: 'es',
  portuguese: 'pt',
  french: 'fr',
  german: 'de',
  japanese: 'ja',
  korean: 'ko',
  chinese: 'zh',
  arabic: 'ar',
  bengali: 'bn',
};

const LANGUAGE_STYLE_GUIDES: Record<string, string> = {
  hi: `HINDI STYLE: Hinglish for young Indian audience.

VOCABULARY RULES:
- Use Devanagari script for Hindi portions, Roman for English words kept as-is
- Grammar and sentence structure should be Hindi, with English nouns/verbs mixed in naturally
- Common Hindi words are FINE — रहस्य, जाँच-पड़ताल, कहानी, दोस्त, etc.
- REPLACE only formal/bureaucratic Hindi that kids wouldn't naturally use:
  ❌ गश्त → ✅ patrol
  ❌ संदिग्ध → ✅ suspect
  ❌ प्रमाण → ✅ evidence
  ❌ आक्रमण → ✅ attack
  ❌ सैनिक → ✅ soldier
  ❌ अभियान → ✅ mission
  ❌ संकेत → ✅ signal
- Keep commonly-understood English words that Indian kids use daily:
  team, plan, cool, awesome, perfect, ready, start, stop, sorry, thanks, okay, actually, basically
- Translate naturally — if a Hindi word feels natural for a kid, use it. If it feels like a textbook, use English.`,

  bn: `BENGALI STYLE: Banglish for young Bengali audience.
Similar to Hinglish — urban Bengali youth naturally mix English words.
Keep commonly-understood English nouns. Use Bengali script for Bengali portions.
Grammar should be Bengali with English words mixed in naturally.`,

  _default: `TRANSLATION STYLE: Full translation to target language.
Use MODERN COLLOQUIAL language — how young speakers actually talk TODAY.
Avoid formal/literary vocabulary. Use the everyday register.
Translate ALL content words (except proper nouns and audio tags).`,
};

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
      const styleGuide = LANGUAGE_STYLE_GUIDES[langCode] ?? LANGUAGE_STYLE_GUIDES._default!;
      const targetDemographic = (context as Record<string, unknown>).targetAudience as string || 'children and young teens (ages 6-15)';

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
