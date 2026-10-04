/**
 * Localizing an episode by per-line TTS (FILM-2007): the languages it
 * offers, the `dub-episode` message the voice worker takes, and the small
 * rules both sides share. Pure (zod only), so the web app, the MCP tool and
 * the voice Lambda read the same definitions.
 *
 * README open question 6 (ElevenLabs Dubbing or per-line TTS) is the
 * owner's; the lead default is per-line TTS over the existing pipeline:
 * the `dialogue_translation` stage translates, then each line is voiced
 * with its speaker's voice on the team's own ElevenLabs key.
 */
import { z } from 'zod';

/**
 * The languages an episode can be localized into: the BCP-47 primary
 * language subtags that both the dialogue translation stage names (it has a
 * style guide or a name for each) and ElevenLabs' multilingual TTS models
 * speak. English is the source and is not a target. Region subtags
 * (`pt-BR`) are refused rather than guessed: the translation and the voice
 * are per language here.
 */
export const LOCALIZE_LANGUAGES = [
  'ar',
  'de',
  'es',
  'fr',
  'hi',
  'ja',
  'ko',
  'pt',
  'zh',
] as const;

export type LocalizeLanguage = (typeof LOCALIZE_LANGUAGES)[number];

/** The language the episode's dialogue is written in. */
export const SOURCE_DIALOGUE_LANGUAGE = 'en';

const LANGUAGE_SET: ReadonlySet<string> = new Set(LOCALIZE_LANGUAGES);

/** Why a language code is refused, or null when it is one we localize into. */
export function localizeLanguageProblem(code: string): string | null {
  if (LANGUAGE_SET.has(code)) return null;

  if (code === SOURCE_DIALOGUE_LANGUAGE) {
    return 'en is the language the dialogue is written in, not a target';
  }

  const primary = code.split(/[-_]/)[0]?.toLowerCase() ?? '';

  if (primary !== code && LANGUAGE_SET.has(primary)) {
    return `${code}: region and script subtags are not supported; use ${primary}`;
  }

  if (code !== code.toLowerCase() && LANGUAGE_SET.has(code.toLowerCase())) {
    return `${code}: language subtags are lowercase; use ${code.toLowerCase()}`;
  }

  return `${code} is not a language StoryBook can voice; use one of ${LOCALIZE_LANGUAGES.join(', ')}`;
}

export const LocalizeLanguagesSchema = z
  .array(z.string().min(1).max(35))
  .min(1)
  .max(LOCALIZE_LANGUAGES.length)
  .superRefine((codes, ctx) => {
    codes.forEach((code, index) => {
      const problem = localizeLanguageProblem(code);

      if (problem) {
        ctx.addIssue({ code: 'custom', path: [index], message: problem });
      } else if (codes.indexOf(code) !== index) {
        ctx.addIssue({
          code: 'custom',
          path: [index],
          message: `${code} is listed twice`,
        });
      }
    });
  })
  .transform((codes) => codes as LocalizeLanguage[]);

/**
 * TTS models that speak English only. A dub needs a multilingual model; a
 * project set to one of these is voiced with `eleven_multilingual_v2`.
 */
export const ENGLISH_ONLY_TTS_MODELS: ReadonlySet<string> = new Set([
  'eleven_monolingual_v1',
  'eleven_english_sts_v1',
  'eleven_english_sts_v2',
  'eleven_turbo_v2',
  'eleven_flash_v2',
]);

export const DUB_FALLBACK_TTS_MODEL = 'eleven_multilingual_v2';

export function dubTtsModel(projectModel: string): string {
  return ENGLISH_ONLY_TTS_MODELS.has(projectModel)
    ? DUB_FALLBACK_TTS_MODEL
    : projectModel;
}

const VoiceSettings = z.object({
  stability: z.number().min(0).max(1).default(0.5),
  similarityBoost: z.number().min(0).max(1).default(0.75),
  style: z.number().min(0).max(1).optional(),
  speed: z.number().min(0.25).max(4).optional(),
});

/**
 * What the dub works from. The Studio's master delivery (FILM-2003) carries
 * a captions file but no dialogue stems, so today it is always the
 * episode's own dialogue lines (their text, translated, and the duration of
 * their audio, which the dub is fitted against). A stems source is the
 * shape a switch to ElevenLabs Dubbing would add.
 */
export const DubSourceSchema = z.object({
  kind: z.literal('dialogue_lines'),
  lines: z.number().int().nonnegative(),
  withAudio: z.number().int().nonnegative(),
});

export const DubEpisodeMessageSchema = z.object({
  kind: z.literal('dub-episode'),
  dubbedVersionId: z.string().uuid(),
  episodeId: z.string().uuid(),
  accountId: z.string().uuid(),
  userId: z.string().uuid(),
  language: z.enum(LOCALIZE_LANGUAGES),
  ttsModel: z.string().min(1),
  /** Character asset id → the voice it speaks with, as start_voice_render builds them */
  voiceAssignments: z.record(
    z.string().uuid(),
    z.object({
      voiceId: z.string().min(1),
      settings: VoiceSettings.optional(),
    }),
  ),
  /** The run translating this episode, when the language needed one */
  translationRunId: z.string().uuid().nullable(),
  source: DubSourceSchema,
  requestedAt: z.string().datetime(),
  /** How many times the job has waited for its translation */
  waits: z.number().int().nonnegative().default(0),
});

export type DubEpisodeMessage = z.infer<typeof DubEpisodeMessageSchema>;
export type DubEpisodeMessageInput = z.input<typeof DubEpisodeMessageSchema>;

/** Lines voiced per message; the rest go on in a follow-up message (Lambda timeout 5 min). */
export const DUB_LINES_PER_MESSAGE = 15;

/** Seconds a job waits for its translation before looking again. */
export const DUB_WAIT_SECONDS = 60;

/** Waits before a job gives up on a translation that never arrives (30 min). */
export const DUB_MAX_WAITS = 30;

/** A dubbed version still being made; a second request for it is refused. */
export const DUB_IN_FLIGHT_STATUSES: ReadonlySet<string> = new Set([
  'translating',
  'voicing',
  'syncing',
]);

/** After this long without an update an in-flight dub is taken as dead. */
export const DUB_STALE_MS = 60 * 60 * 1000;

/**
 * Seconds of MP3 audio in `bytes`, at ElevenLabs' default output
 * (`mp3_44100_128`, 128 kbit/s constant bitrate).
 */
export function mp3Seconds(bytes: number): number {
  return Math.round(((bytes * 8) / 128_000) * 100) / 100;
}

/**
 * `dubbed_dialogue_lines.timing_adjustment`: the speed factor that fits the
 * dub into the time the source line took, clamped to the column's 0.5..2.
 * 1 when either duration is unknown.
 */
export function timingAdjustment(
  dubSeconds: number | null,
  sourceSeconds: number | null,
): number {
  if (!dubSeconds || !sourceSeconds || dubSeconds <= 0 || sourceSeconds <= 0) {
    return 1;
  }

  const factor = dubSeconds / sourceSeconds;

  return Math.round(Math.min(2, Math.max(0.5, factor)) * 100) / 100;
}
