/**
 * Translate Dialogue Handler
 *
 * Translates English dialogue lines to target language.
 * Uses the Translation Orchestrator for quality-verified translation:
 *   translateDialogue → verifyTranslation → re-translate divergent lines (max 1 cycle)
 *
 * WRITES TO DATABASE: Inserts new dialogue_lines rows
 */
import type { SupabaseClient } from '@supabase/supabase-js';

interface TranslateDialoguePayload {
  episodeId: string;
  targetLanguage: string;
  preserveTiming: boolean;
  accountId: string;
  userId: string;
}

interface DialogueLine {
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

interface TranslateDialogueResult {
  success: boolean;
  data: {
    translatedCount: number;
    orchestratorSteps?: number;
    verificationScore?: number;
    verdict?: string;
  };
}

const LANGUAGE_NAMES: Record<string, string> = {
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

export async function processTranslateDialogue(
  payload: Record<string, unknown>,
  supabase: SupabaseClient,
): Promise<TranslateDialogueResult> {
  const data = payload as TranslateDialoguePayload;

  console.log(
    `[Translate Dialogue] Starting AGENTIC pipeline for episode ${data.episodeId} to ${data.targetLanguage}`,
  );

  // 1. Fetch English dialogue lines
  const { data: englishLines, error: fetchError } = await supabase
    .from('dialogue_lines')
    .select(
      `
            id, episode_id, character_asset_id, shot_id, text,
            sequence_number, scene_number, timeline_start_seconds,
            estimated_duration_seconds
        `,
    )
    .eq('episode_id', data.episodeId)
    .eq('language', 'en')
    .order('sequence_number', { ascending: true });

  if (fetchError) {
    throw new Error(`Failed to fetch dialogue: ${fetchError.message}`);
  }

  const lines = (englishLines || []) as DialogueLine[];

  if (lines.length === 0) {
    console.log('[Translate Dialogue] No English lines to translate');
    return { success: true, data: { translatedCount: 0 } };
  }

  // 2. Check existing translations
  const { data: existing } = await supabase
    .from('dialogue_lines')
    .select('source_dialogue_id')
    .eq('episode_id', data.episodeId)
    .eq('language', data.targetLanguage);

  const existingSourceIds = new Set(
    (existing || []).map(
      (e: { source_dialogue_id: string }) => e.source_dialogue_id,
    ),
  );

  const linesToTranslate = lines.filter((l) => !existingSourceIds.has(l.id));

  if (linesToTranslate.length === 0) {
    console.log('[Translate Dialogue] All lines already translated');
    return { success: true, data: { translatedCount: 0 } };
  }

  // 3. Prepare formatted dialogue text for orchestrator
  const targetLangName =
    LANGUAGE_NAMES[data.targetLanguage] || data.targetLanguage;

  const linesText = linesToTranslate
    .map((l, i) => {
      const timing =
        data.preserveTiming && l.estimated_duration_seconds
          ? ` (max ${l.estimated_duration_seconds.toFixed(1)}s)`
          : '';
      return `${i + 1}. "${l.text}"${timing}`;
    })
    .join('\n');

  // 4. Run the Translation Orchestrator
  const { runTranslationOrchestrator } = await import(
    '@kit/episodes/agent/translation-orchestrator'
  );

  const orchestratorResult = await runTranslationOrchestrator({
    episodeId: data.episodeId,
    targetLanguage: data.targetLanguage,
    targetLanguageName: targetLangName,
    preserveTiming: data.preserveTiming,
    accountId: data.accountId,
    dialogueLines: linesText,
    lineCount: linesToTranslate.length,
  });

  if (!orchestratorResult.success) {
    throw new Error(
      `Translation Orchestrator failed: ${orchestratorResult.error ?? 'Unknown error'}`,
    );
  }

  const translations = orchestratorResult.translations;

  // 5. Validate translations before insert — refuse to save English as target language
  const missingOrIdentical = linesToTranslate.filter(
    (line, i) => !translations[i] || translations[i] === line.text,
  ).length;

  if (missingOrIdentical > linesToTranslate.length * 0.5) {
    throw new Error(
      `Translation validation failed: ${missingOrIdentical}/${linesToTranslate.length} lines are missing or identical to English. ` +
        `Refusing to save untranslated text as ${targetLangName}.`,
    );
  }

  if (missingOrIdentical > 0) {
    console.warn(
      `[Translate Dialogue] ${missingOrIdentical}/${linesToTranslate.length} lines fell back to English — proceeding with partial translation`,
    );
  }

  // 6. INSERT translated lines
  const newLines = linesToTranslate.map((line, index) => ({
    episode_id: line.episode_id,
    character_asset_id: line.character_asset_id,
    shot_id: line.shot_id,
    text: translations[index] || line.text,
    sequence_number: line.sequence_number,
    scene_number: line.scene_number,
    timeline_start_seconds: line.timeline_start_seconds,
    estimated_duration_seconds: line.estimated_duration_seconds,
    language: data.targetLanguage,
    source_dialogue_id: line.id,
    status: 'pending',
  }));

  const { error: insertError } = await supabase
    .from('dialogue_lines')
    .insert(newLines);

  if (insertError) {
    throw new Error(`Failed to insert translations: ${insertError.message}`);
  }

  console.log(
    `[Translate Dialogue] Agentic pipeline complete. Steps: ${orchestratorResult.orchestratorSteps}, ` +
      `Lines: ${newLines.length}, Score: ${orchestratorResult.verificationScore?.toFixed(2) ?? 'N/A'}`,
  );

  return {
    success: true,
    data: {
      translatedCount: newLines.length,
      orchestratorSteps: orchestratorResult.orchestratorSteps,
      verificationScore: orchestratorResult.verificationScore,
      verdict: orchestratorResult.verdict,
    },
  };
}
