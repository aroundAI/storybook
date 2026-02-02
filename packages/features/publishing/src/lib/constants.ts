/**
 * Shared language and platform constants for publishing features
 */

export const SUPPORTED_LANGUAGES = [
    'en',
    'hi',
    'es',
    'pt',
    'fr',
    'de',
    'ja',
    'ko',
    'zh',
    'ar',
    'bn',
] as const;

export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];

export const LANG_INFO: Record<SupportedLanguage, { name: string; flag: string }> =
{
    en: { name: 'English', flag: '🇺🇸' },
    hi: { name: 'Hindi', flag: '🇮🇳' },
    es: { name: 'Spanish', flag: '🇪🇸' },
    pt: { name: 'Portuguese', flag: '🇧🇷' },
    fr: { name: 'French', flag: '🇫🇷' },
    de: { name: 'German', flag: '🇩🇪' },
    ja: { name: 'Japanese', flag: '🇯🇵' },
    ko: { name: 'Korean', flag: '🇰🇷' },
    zh: { name: 'Chinese', flag: '🇨🇳' },
    ar: { name: 'Arabic', flag: '🇸🇦' },
    bn: { name: 'Bengali', flag: '🇧🇩' },
};

export const getLangDisplay = (
    lang: string,
): { name: string; flag: string } =>
    LANG_INFO[lang as SupportedLanguage] || {
        name: lang.toUpperCase(),
        flag: '🌐',
    };

// Platform type constants
export const FULL_VIDEO_PLATFORMS = ['youtube', 'facebook'] as const;
export const SHORTS_PLATFORMS = [
    'youtube',
    'instagram',
    'facebook',
    'tiktok',
] as const;

// Helper to parse comma-separated tags
export const parseTags = (tagsString?: string): string[] =>
    tagsString
        ? tagsString
            .split(',')
            .map((t) => t.trim())
            .filter(Boolean)
        : [];
