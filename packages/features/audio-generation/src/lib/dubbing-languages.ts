/**
 * Supported dubbing languages for multi-language dubbing feature (FILM-512)
 *
 * ISO 639-1 language codes with display names, flags, and native names
 */
export const SUPPORTED_DUBBING_LANGUAGES = [
  { code: 'en', name: 'English', flag: '🇺🇸', nativeName: 'English' },
  { code: 'es', name: 'Spanish', flag: '🇪🇸', nativeName: 'Español' },
  { code: 'fr', name: 'French', flag: '🇫🇷', nativeName: 'Français' },
  { code: 'de', name: 'German', flag: '🇩🇪', nativeName: 'Deutsch' },
  { code: 'it', name: 'Italian', flag: '🇮🇹', nativeName: 'Italiano' },
  { code: 'pt', name: 'Portuguese', flag: '🇧🇷', nativeName: 'Português' },
  { code: 'ja', name: 'Japanese', flag: '🇯🇵', nativeName: '日本語' },
  { code: 'ko', name: 'Korean', flag: '🇰🇷', nativeName: '한국어' },
  { code: 'zh', name: 'Chinese (Mandarin)', flag: '🇨🇳', nativeName: '中文' },
  { code: 'hi', name: 'Hindi', flag: '🇮🇳', nativeName: 'हिन्दी' },
  { code: 'ar', name: 'Arabic', flag: '🇸🇦', nativeName: 'العربية' },
  { code: 'ru', name: 'Russian', flag: '🇷🇺', nativeName: 'Русский' },
] as const;

/**
 * Language code type derived from supported languages
 */
export type LanguageCode = (typeof SUPPORTED_DUBBING_LANGUAGES)[number]['code'];

/**
 * Language info type
 */
export type LanguageInfo = (typeof SUPPORTED_DUBBING_LANGUAGES)[number];

/**
 * Language codes as tuple for Zod enum schema
 */
export const LANGUAGE_CODE_SCHEMA_VALUES = SUPPORTED_DUBBING_LANGUAGES.map(
  (l) => l.code,
) as [LanguageCode, ...LanguageCode[]];

/**
 * Get language info by code
 */
export function getLanguageInfo(code: string): LanguageInfo | undefined {
  return SUPPORTED_DUBBING_LANGUAGES.find((l) => l.code === code);
}

/**
 * Get language display name by code
 */
export function getLanguageName(code: string): string {
  return getLanguageInfo(code)?.name ?? code.toUpperCase();
}

/**
 * Get language native name by code
 */
export function getLanguageNativeName(code: string): string {
  return getLanguageInfo(code)?.nativeName ?? code.toUpperCase();
}

/**
 * Get language flag emoji by code
 */
export function getLanguageFlag(code: string): string {
  return getLanguageInfo(code)?.flag ?? '🌐';
}

/**
 * Validate language code is supported
 */
export function isValidLanguageCode(code: string): code is LanguageCode {
  return SUPPORTED_DUBBING_LANGUAGES.some((l) => l.code === code);
}

/**
 * ElevenLabs multilingual model for dubbed audio generation
 * NOTE: This should be fetched from project audio settings
 * This export is kept for backward compatibility but should not be used in new code
 * @deprecated Use getProjectTTSModel() from project-audio-settings.ts instead
 */
export const MULTILINGUAL_VOICE_MODEL = 'eleven_multilingual_v2';

/**
 * Dubbing cost estimation constants (in cents)
 */
export const DUBBING_COSTS = {
  /**
   * LLM cost per 1000 characters translated
   * Based on Claude 3.5 Sonnet: ~$0.003/1K input + $0.015/1K output
   * Estimated total ~$0.02 per 1K chars for translation
   */
  TRANSLATION_PER_1000_CHARS: 2,

  /**
   * Voice generation cost per 1000 characters
   * Based on ElevenLabs: $0.30 per 1K characters
   */
  VOICE_PER_1000_CHARS: 30,
} as const;
