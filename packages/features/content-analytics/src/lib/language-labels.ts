import { LANGUAGE_DIMENSIONS } from '@kit/clickhouse';
import type { LanguageDimension } from '@kit/clickhouse';

/**
 * How a language — or the absence of one — is named on screen (FILM-1702).
 *
 * One module because this table used to live in five components, each with
 * `NAMES[code] || code.toUpperCase()`. That shape cannot render "not set":
 * handed an empty code it prints nothing, and handed the old `'en'` default
 * it prints "English" for a publish nobody ever labelled. Everything here
 * takes `string | null`, so the absence is a case the caller must reach
 * rather than a string that happens to be falsy.
 */
const LANGUAGE_NAMES: Record<string, string> = {
  en: 'English',
  hi: 'Hindi',
  es: 'Spanish',
  pt: 'Portuguese',
  fr: 'French',
  de: 'German',
  ja: 'Japanese',
  ko: 'Korean',
  zh: 'Chinese',
  ar: 'Arabic',
  ru: 'Russian',
  it: 'Italian',
};

const LANGUAGE_FLAGS: Record<string, string> = {
  en: '🇺🇸',
  hi: '🇮🇳',
  es: '🇪🇸',
  pt: '🇧🇷',
  fr: '🇫🇷',
  de: '🇩🇪',
  ja: '🇯🇵',
  ko: '🇰🇷',
  zh: '🇨🇳',
  ar: '🇸🇦',
  ru: '🇷🇺',
  it: '🇮🇹',
};

const LANGUAGE_COLORS: Record<string, string> = {
  en: '#3b82f6',
  hi: '#f97316',
  es: '#eab308',
  pt: '#22c55e',
  fr: '#8b5cf6',
  de: '#ef4444',
  ja: '#ec4899',
  ko: '#14b8a6',
  zh: '#f43f5e',
  ar: '#6366f1',
};

/**
 * The video age the per-language medians are measured at — the same
 * checkpoint the Deep Dive's segment table uses, so the two tabs put the
 * same number beside the same language. Here rather than in the server
 * module because the card words its empty case with it.
 */
export const LANGUAGE_CHECKPOINT_DAYS = 30;

/** Neutral, so the unlabelled bucket never reads as one more language. */
const NOT_SET_COLOR = '#9ca3af';
const UNLISTED_COLOR = '#6b7280';

/**
 * What the dimension is called wherever it is named. The active one is
 * always on screen, so a reader never has to guess which language a
 * percentage refers to.
 */
export const LANGUAGE_DIMENSION_LABELS: Record<LanguageDimension, string> = {
  content: 'Content language',
  channel: 'Channel target language',
};

/** The question each dimension answers, shown beside the toggle. */
export const LANGUAGE_DIMENSION_DESCRIPTIONS: Record<
  LanguageDimension,
  string
> = {
  content:
    'Grouped by the language of each published video. A video with no language set is shown as its own group, not counted as English.',
  channel:
    'Grouped by the language each channel is set up to serve, whatever was actually posted there. A video uploaded outside a connected channel has no target.',
};

/**
 * The absent value's name. It differs by dimension because the absence
 * does: a video without a content language was never labelled, while a
 * video without a channel target was never on a connected channel.
 */
const NOT_SET_LABELS: Record<LanguageDimension, string> = {
  content: 'Language not set',
  channel: 'No channel target',
};

export function languageName(
  code: string | null,
  dimension: LanguageDimension = 'content',
): string {
  if (code === null) return NOT_SET_LABELS[dimension];

  return LANGUAGE_NAMES[code] ?? code.toUpperCase();
}

/** Null for "not set": a globe would suggest a language we cannot name. */
export function languageFlag(code: string | null): string | null {
  if (code === null) return null;

  return LANGUAGE_FLAGS[code] ?? '🌐';
}

export function languageColor(code: string | null): string {
  if (code === null) return NOT_SET_COLOR;

  return LANGUAGE_COLORS[code] ?? UNLISTED_COLOR;
}

/**
 * The key a not-set language takes where keys must be strings — a chart
 * series, a `Record`. Longer than `publishes.language` (varchar(5)) can
 * hold, so it can never collide with a real code.
 */
export const LANGUAGE_NOT_SET_KEY = '__not_set__';

export function languageKey(code: string | null): string {
  return code ?? LANGUAGE_NOT_SET_KEY;
}

export function languageFromKey(key: string): string | null {
  return key === LANGUAGE_NOT_SET_KEY ? null : key;
}

/**
 * A dimension from input nobody validated: the actions that call
 * `language-analytics.ts` pass it through from their input, which can be
 * anything; an unknown value falls back to the default rather than indexing
 * a lookup with it.
 */
export function resolveLanguageDimension(value: unknown): LanguageDimension {
  return (
    LANGUAGE_DIMENSIONS.find((dimension) => dimension === value) ?? 'content'
  );
}
