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

export const LANG_INFO: Record<
  SupportedLanguage,
  { name: string; flag: string }
> = {
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

export const getLangDisplay = (lang: string): { name: string; flag: string } =>
  LANG_INFO[lang as SupportedLanguage] || {
    name: lang.toUpperCase(),
    flag: '🌐',
  };

/**
 * Which channels each kind of video goes to: the one list the publish
 * screen, its video cards, the upload dialog and scheduling all read. X
 * takes both (owner, 2026-10-01, FILM-1729); the server refuses a video
 * outside X's limits before anything is written.
 */
export const FULL_VIDEO_PLATFORMS = ['youtube', 'facebook', 'twitter'] as const;
export const SHORTS_PLATFORMS = [
  'youtube',
  'instagram',
  'facebook',
  'tiktok',
  'twitter',
] as const;

export function takesVideo(kind: 'full' | 'short', platform: string) {
  const platforms: readonly string[] =
    kind === 'full' ? FULL_VIDEO_PLATFORMS : SHORTS_PLATFORMS;

  return platforms.includes(platform);
}

// Helper to parse comma-separated tags
export const parseTags = (tagsString?: string): string[] =>
  tagsString
    ? tagsString
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean)
    : [];
