/**
 * The `dialogue_translation` stage (FILM-1901): the episode's English
 * dialogue in another language. Target: episode + language. Parts: one per
 * scene that still has untranslated lines. Output: one translation per
 * source line, keyed by the line's id.
 *
 * Commit owns what `handlers/translate-dialogue.ts` wrote: the translated
 * dialogue_lines rows, with a line the writer left out falling back to the
 * English text, and the refusal to save a set that is mostly untranslated.
 * The job keeps no generation_jobs row, as today.
 */
import { z } from 'zod';

import dialogueTranslation from '@kit/prompt-engine/prompts/audio-generation/dialogue-translation.json';
import { sanitizeForPrompt } from '@kit/shared/prompt-sanitiser';

import { type PromptFile, buildBrief } from '../brief';
import { applyCommit } from '../commit-plan';
import { registerStage } from '../registry';
import type {
  Brief,
  CheckError,
  CommitResult,
  Ctx,
  PartSpec,
  StageDefinition,
} from '../types';
import { memoised } from './shared/memo';

const LOG = '[Translate Dialogue]';

// ---------------------------------------------------------------------------
// Languages (shared with the Translation skill)
// ---------------------------------------------------------------------------

export const LANGUAGE_NAMES: Record<string, string> = {
  hi: 'Hindi',
  es: 'Spanish',
  pt: 'Portuguese',
  fr: 'French',
  de: 'German',
  ja: 'Japanese',
  ko: 'Korean',
  zh: 'Chinese',
  ar: 'Arabic',
  bn: 'Bengali',
};

export const LANGUAGE_CODE_MAP: Record<string, string> = Object.fromEntries(
  Object.entries(LANGUAGE_NAMES).map(([code, name]) => [
    name.toLowerCase(),
    code,
  ]),
);

export const LANGUAGE_STYLE_GUIDES: Record<string, string> = {
  hi: `HINDI STYLE: Natural spoken Hinglish in Devanagari script.

TARGET TONE: How a 10-year-old Indian kid actually talks at home — mixing Hindi and English naturally.
Write EVERYTHING in Devanagari script (including English loanwords → transliterate them).

CORE PRINCIPLE: If an Indian kid would say it that way in real life, it's correct.

USE COMMON HINDI WORDS (everyone knows these):
  दोपहर, सुबह, रात, खाना, पानी, दोस्त, कहानी, रास्ता, जगह, आवाज़,
  चुपचाप, अंधेरा, डर, हिम्मत, मज़ा, तैयार, ज़रूर, सच में, पक्का

REPLACE FORMAL/TEXTBOOK HINDI WITH ENGLISH LOANWORDS (Indians use these daily):
  ❌ गश्त → ✅ पैट्रोलिंग
  ❌ संदिग्ध → ✅ सस्पेक्ट
  ❌ प्रमाण → ✅ एविडेंस
  ❌ आक्रमण → ✅ अटैक
  ❌ सैनिक → ✅ सोल्जर
  ❌ अभियान → ✅ मिशन
  ❌ संकेत → ✅ सिग्नल
  ❌ निरीक्षण → ✅ चेक
  ❌ योजना → ✅ प्लान
  ❌ समस्या → ✅ प्रॉब्लम

ENGLISH WORDS TO TRANSLITERATE (write in Devanagari):
  team → टीम, cool → कूल, perfect → परफेक्ट, ready → रेडी,
  sorry → सॉरी, thanks → थैंक्स, okay → ओके, actually → एक्चुअली

EXAMPLE TRANSLATIONS:
  ❌ "दोपहर की गश्त बहुत शांत है" (textbook Hindi)
  ❌ "Afternoon patrol बहुत शांत है" (unnecessary English)
  ✅ "दोपहर की पैट्रोलिंग आज बहुत शांत है" (natural Hinglish)

  ❌ "यह बहुत संदिग्ध लग रहा है" (formal)
  ✅ "ये बहुत सस्पिशस लग रहा है" (how kids actually talk)

  ❌ "हमें एक योजना बनानी होगी" (formal)
  ✅ "हमें एक प्लान बनाना होगा" (natural)`,

  bn: `BENGALI STYLE: Banglish for young Bengali audience.
Similar to Hinglish — urban Bengali youth naturally mix English words.
Keep commonly-understood English nouns. Use Bengali script for Bengali portions.
Grammar should be Bengali with English words mixed in naturally.`,

  _default: `TRANSLATION STYLE: Full translation to target language.
Use MODERN COLLOQUIAL language — how young speakers actually talk TODAY.
Avoid formal/literary vocabulary. Use the everyday register.
Translate ALL content words (except proper nouns and audio tags).`,
};

export const DEFAULT_TARGET_DEMOGRAPHIC =
  'children and young teens (ages 6-15)';

export function languageStyleGuide(languageCode: string): string {
  return LANGUAGE_STYLE_GUIDES[languageCode] ?? LANGUAGE_STYLE_GUIDES._default!;
}

// ---------------------------------------------------------------------------
// Target and output
// ---------------------------------------------------------------------------

/** The episode and the language, as the `translate-dialogue` job names them. */
export const DialogueTranslationTargetSchema = z.object({
  episodeId: z.string().uuid(),
  targetLanguage: z.string().min(1),
  preserveTiming: z.boolean(),
});
export type DialogueTranslationTarget = z.infer<
  typeof DialogueTranslationTargetSchema
>;

/**
 * One part's output: a translation per source line of that scene. The
 * `dialogue-translation` prompt returns numbered text lines; this is the
 * structured form both modes commit. A line the writer leaves out is not
 * an error here: commit stores the English text for it, as today.
 */
export const DialogueTranslationPartOutputSchema = z.object({
  translations: z.array(
    z.object({
      sourceDialogueId: z.string().uuid(),
      text: z.string().regex(/\S/, 'A translation needs text'),
    }),
  ),
});
export type DialogueTranslationPartOutput = z.infer<
  typeof DialogueTranslationPartOutputSchema
>;

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

export interface SourceDialogueLine {
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

export interface DialogueTranslationInputs {
  /** Every English line, in sequence order */
  englishLines: SourceDialogueLine[];
  /** The lines without a translation in the target language yet */
  linesToTranslate: SourceDialogueLine[];
  targetLanguageName: string;
  /** From episode metadata; '' when unset */
  targetAudience: string;
}

export function loadDialogueTranslationInputs(
  ctx: Ctx,
  target: DialogueTranslationTarget,
): Promise<DialogueTranslationInputs> {
  return memoised(
    ctx,
    `dialogue_translation:${target.episodeId}:${target.targetLanguage}`,
    async () => {
      const { data: englishLines, error: fetchError } = await ctx.client
        .from('dialogue_lines')
        .select(
          `
            id, episode_id, character_asset_id, shot_id, text,
            sequence_number, scene_number, timeline_start_seconds,
            estimated_duration_seconds
        `,
        )
        .eq('episode_id', target.episodeId)
        .eq('language', 'en')
        .order('sequence_number', { ascending: true });

      if (fetchError) {
        throw new Error(`Failed to fetch dialogue: ${fetchError.message}`);
      }

      const lines = (englishLines || []) as SourceDialogueLine[];

      if (lines.length === 0) {
        console.log(`${LOG} No English lines to translate`);

        return {
          englishLines: [],
          linesToTranslate: [],
          targetLanguageName: languageName(target.targetLanguage),
          targetAudience: '',
        };
      }

      const { data: episodeData } = await ctx.client
        .from('episodes')
        .select('metadata')
        .eq('id', target.episodeId)
        .single();

      const targetAudience =
        ((episodeData?.metadata as Record<string, unknown>)
          ?.target_audience as string) || '';

      const { data: existing } = await ctx.client
        .from('dialogue_lines')
        .select('source_dialogue_id')
        .eq('episode_id', target.episodeId)
        .eq('language', target.targetLanguage);

      const existingSourceIds = new Set(
        (existing || []).map((e) => e.source_dialogue_id),
      );

      const linesToTranslate = lines.filter(
        (l) => !existingSourceIds.has(l.id),
      );

      if (linesToTranslate.length === 0) {
        console.log(`${LOG} All lines already translated`);
      }

      return {
        englishLines: lines,
        linesToTranslate,
        targetLanguageName: languageName(target.targetLanguage),
        targetAudience,
      };
    },
  );
}

export function languageName(code: string): string {
  return LANGUAGE_NAMES[code] || code;
}

/**
 * The numbered list the prompt takes: `1. "text" (max 2.5s)`. Stored
 * dialogue, defused for the model (KB-101).
 */
export function numberedDialogue(
  lines: ReadonlyArray<SourceDialogueLine>,
  preserveTiming: boolean,
): string {
  return lines
    .map((l, i) => {
      const timing =
        preserveTiming && l.estimated_duration_seconds
          ? ` (max ${l.estimated_duration_seconds.toFixed(1)}s)`
          : '';

      return `${i + 1}. "${sanitizeForPrompt(l.text)}"${timing}`;
    })
    .join('\n');
}

/** Scenes in order of first appearance, each with its lines in order. */
export function linesByScene(
  lines: ReadonlyArray<SourceDialogueLine>,
): Array<{ sceneNumber: number; lines: SourceDialogueLine[] }> {
  const scenes = new Map<number, SourceDialogueLine[]>();

  for (const line of lines) {
    const scene = scenes.get(line.scene_number);

    if (scene) scene.push(line);
    else scenes.set(line.scene_number, [line]);
  }

  return [...scenes.entries()].map(([sceneNumber, sceneLines]) => ({
    sceneNumber,
    lines: sceneLines,
  }));
}

function partKey(sceneNumber: number) {
  return `scene-${sceneNumber}`;
}

async function partLines(
  ctx: Ctx,
  target: DialogueTranslationTarget,
  part: PartSpec,
) {
  const inputs = await loadDialogueTranslationInputs(ctx, target);
  const scene = linesByScene(inputs.linesToTranslate)[part.index];

  if (!scene || partKey(scene.sceneNumber) !== part.key) {
    throw new Error(`${LOG} part ${part.key} matches no scene`);
  }

  return { inputs, scene };
}

// ---------------------------------------------------------------------------
// Stage
// ---------------------------------------------------------------------------

export interface DialogueTranslationCommitData {
  translatedCount: number;
}

export const dialogueTranslationStage: StageDefinition<
  DialogueTranslationTarget,
  DialogueTranslationPartOutput,
  DialogueTranslationCommitData
> = {
  key: 'dialogue_translation',
  targetType: 'episode',
  targetSchema: DialogueTranslationTargetSchema,
  outputSchema: DialogueTranslationPartOutputSchema,

  async parts(ctx, target) {
    const inputs = await loadDialogueTranslationInputs(ctx, target);
    const scenes = linesByScene(inputs.linesToTranslate);

    return scenes.map((scene, index) => ({
      key: partKey(scene.sceneNumber),
      index,
      total: scenes.length,
      label: `Scene ${scene.sceneNumber}: ${scene.lines.length} line${scene.lines.length === 1 ? '' : 's'} into ${inputs.targetLanguageName}`,
    }));
  },

  async prepare(ctx, target, part): Promise<Brief> {
    const { inputs, scene } = await partLines(ctx, target, part);
    const timingRule = target.preserveTiming
      ? 'Constrained for lip-sync: within 20% of the original length'
      : 'Unconstrained: a natural translation is preferred';

    return buildBrief({
      stage: 'dialogue_translation',
      part,
      prompt: dialogueTranslation as PromptFile,
      outputSchema: DialogueTranslationPartOutputSchema,
      variables: {
        dialogue_lines: numberedDialogue(scene.lines, target.preserveTiming),
        target_language: inputs.targetLanguageName,
        preserve_timing: target.preserveTiming,
        language_style_guide: languageStyleGuide(target.targetLanguage),
        target_demographic:
          sanitizeForPrompt(inputs.targetAudience) ||
          DEFAULT_TARGET_DEMOGRAPHIC,
      },
      context: {
        episodeId: target.episodeId,
        sceneNumber: scene.sceneNumber,
        targetLanguage: target.targetLanguage,
        targetLanguageName: inputs.targetLanguageName,
        preserveTiming: target.preserveTiming,
        lines: scene.lines.map((line, index) => ({
          number: index + 1,
          sourceDialogueId: line.id,
          text: line.text,
          maxSeconds: target.preserveTiming
            ? line.estimated_duration_seconds
            : null,
        })),
      },
      constraints: {
        oneTranslationPerLine: true,
        sourceDialogueIds: scene.lines.map((line) => line.id),
        keepAudioTags: true,
        keepCharacterNames: true,
        timing: timingRule,
      },
      targetVersion: null,
      rubricVariables: {
        target_language: inputs.targetLanguageName,
        timing_rule: timingRule,
      },
    });
  },

  async check(ctx, target, out, part): Promise<CheckError[]> {
    const { scene } = await partLines(ctx, target, part);
    const ids = new Set(scene.lines.map((line) => line.id));
    const seen = new Set<string>();
    const errors: CheckError[] = [];

    out.translations.forEach((translation, index) => {
      const path = `translations.${index}.sourceDialogueId`;

      if (!ids.has(translation.sourceDialogueId)) {
        errors.push({
          path,
          code: 'unknown_line',
          message: `${translation.sourceDialogueId} is not a line of ${part.label}`,
        });
      } else if (seen.has(translation.sourceDialogueId)) {
        errors.push({
          path,
          code: 'duplicate_line',
          message: `${translation.sourceDialogueId} is translated twice`,
        });
      }

      seen.add(translation.sourceDialogueId);
    });

    return errors;
  },

  async commit(ctx, _run, target, outputs) {
    const inputs = await loadDialogueTranslationInputs(ctx, target);
    const { linesToTranslate, targetLanguageName } = inputs;

    if (linesToTranslate.length === 0) {
      return {
        status: 'skipped',
        reason:
          inputs.englishLines.length === 0
            ? 'no-english-lines'
            : 'already-translated',
        data: { translatedCount: 0 },
      } satisfies CommitResult<DialogueTranslationCommitData>;
    }

    const translated = new Map(
      outputs
        .flatMap((output) => output.translations)
        .map((t) => [t.sourceDialogueId, t.text]),
    );

    // Refuse to save English as the target language
    const missingOrIdentical = linesToTranslate.filter((line) => {
      const text = translated.get(line.id);

      return !text || text === line.text;
    }).length;

    if (missingOrIdentical > linesToTranslate.length * 0.5) {
      throw new Error(
        `Translation validation failed: ${missingOrIdentical}/${linesToTranslate.length} lines are missing or identical to English. ` +
          `Refusing to save untranslated text as ${targetLanguageName}.`,
      );
    }

    if (missingOrIdentical > 0) {
      console.warn(
        `${LOG} ${missingOrIdentical}/${linesToTranslate.length} lines fell back to English — proceeding with partial translation`,
      );
    }

    const newLines = linesToTranslate.map((line) => ({
      episode_id: line.episode_id,
      character_asset_id: line.character_asset_id,
      shot_id: line.shot_id,
      text: translated.get(line.id) || line.text,
      sequence_number: line.sequence_number,
      scene_number: line.scene_number,
      timeline_start_seconds: line.timeline_start_seconds,
      estimated_duration_seconds: line.estimated_duration_seconds,
      language: target.targetLanguage,
      source_dialogue_id: line.id,
      status: 'pending',
    }));

    await applyCommit(ctx, {
      ops: [{ op: 'insert', table: 'dialogue_lines', rows: newLines }],
    });

    return {
      status: 'committed',
      data: { translatedCount: newLines.length },
    };
  },
};

registerStage(dialogueTranslationStage);
