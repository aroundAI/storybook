import { DUBBING_COSTS } from './dubbing-languages';

/**
 * Estimate translation cost based on character count
 * Based on Claude 3.5 Sonnet pricing: ~$0.02 per 1K chars
 */
export function estimateTranslationCost(totalCharacters: number): number {
  return Math.ceil(
    (totalCharacters / 1000) * DUBBING_COSTS.TRANSLATION_PER_1000_CHARS,
  );
}

/**
 * Estimate voice generation cost based on character count
 * Based on ElevenLabs pricing: $0.30 per 1K chars
 */
export function estimateVoiceGenerationCost(totalCharacters: number): number {
  return Math.ceil(
    (totalCharacters / 1000) * DUBBING_COSTS.VOICE_PER_1000_CHARS,
  );
}

/**
 * Calculate total characters from dubbed lines
 */
export function calculateTotalCharacters(
  lines: Array<{ translated_text: string }>,
): number {
  return lines.reduce((sum, line) => sum + line.translated_text.length, 0);
}
