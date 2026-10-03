import { z } from 'zod';

export const GENERATION_MODES = ['server', 'external'] as const;
export type GenerationMode = (typeof GENERATION_MODES)[number];

export const AiSettingsSchema = z.object({
  serverGenerationEnabled: z.boolean(),
  externalGenerationEnabled: z.boolean(),
  defaultMode: z.enum(GENERATION_MODES),
  /** FILM-1912: briefs carry past-episode performance; off by default */
  performanceContextEnabled: z.boolean(),
  /**
   * USD a UTC day of Gemini spend through the web app before Generate is
   * refused; null is no cap (owner decision 2026-10-03). Never MCP work,
   * never renders.
   */
  dailyLlmSpendCapUsd: z.number().nullable(),
});

export type AiSettings = z.infer<typeof AiSettingsSchema>;

export const AI_SETTINGS_DEFAULTS: AiSettings = {
  serverGenerationEnabled: true,
  externalGenerationEnabled: true,
  defaultMode: 'server',
  performanceContextEnabled: false,
  dailyLlmSpendCapUsd: null,
};

export const BOTH_MODES_OFF_REFUSAL =
  'Keep at least one way to generate. Allow server generation, external generation, or both.';
export const DEFAULT_MODE_OFF_REFUSAL =
  'The default mode must be one the team allows.';

/**
 * The rule the form, the action and the database constraints
 * (account_ai_settings_a_mode_allowed, _default_mode_allowed) all hold:
 * never both modes off, and the default is an allowed mode. The message,
 * or null when the settings are acceptable.
 */
export function aiSettingsProblem(
  settings: Pick<
    AiSettings,
    'serverGenerationEnabled' | 'externalGenerationEnabled' | 'defaultMode'
  >,
): string | null {
  if (
    !settings.serverGenerationEnabled &&
    !settings.externalGenerationEnabled
  ) {
    return BOTH_MODES_OFF_REFUSAL;
  }

  const defaultAllowed =
    settings.defaultMode === 'server'
      ? settings.serverGenerationEnabled
      : settings.externalGenerationEnabled;

  return defaultAllowed ? null : DEFAULT_MODE_OFF_REFUSAL;
}

export const MAX_DAILY_SPEND_CAP_USD = 100_000;
export const SPEND_CAP_REFUSAL =
  'A daily spend cap is an amount in US dollars above $0, such as 5 or 12.50. Leave it empty for no cap.';

/**
 * The cap rule the form, the action and the column's CHECK
 * (account_ai_settings_daily_llm_spend_cap_positive) hold: none, or whole
 * cents above zero, up to MAX_DAILY_SPEND_CAP_USD.
 */
export function spendCapProblem(cap: number | null): string | null {
  if (cap === null) return null;

  const wholeCents = Math.abs(cap * 100 - Math.round(cap * 100)) < 1e-6;

  return Number.isFinite(cap) &&
    cap > 0 &&
    cap <= MAX_DAILY_SPEND_CAP_USD &&
    wholeCents
    ? null
    : SPEND_CAP_REFUSAL;
}

/**
 * The cap as typed or pasted: empty is no cap (null); `$` and thousands
 * separators are dropped, so "1,250.00" is 1250, not 1. Undefined when it
 * is not an acceptable cap.
 */
export function parseSpendCap(text: string): number | null | undefined {
  const cleaned = text.trim().replace(/^\$/, '').replace(/,/g, '');

  if (cleaned === '') return null;

  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return undefined;

  const cap = Number(cleaned);

  return spendCapProblem(cap) ? undefined : cap;
}

/** The form edits the cap as text; everything else as stored. */
export type AiSettingsFormValues = Omit<AiSettings, 'dailyLlmSpendCapUsd'> & {
  dailyLlmSpendCap: string;
};

export function toFormValues({
  dailyLlmSpendCapUsd,
  ...settings
}: AiSettings): AiSettingsFormValues {
  return {
    ...settings,
    dailyLlmSpendCap:
      dailyLlmSpendCapUsd === null ? '' : dailyLlmSpendCapUsd.toFixed(2),
  };
}

/** Form values the form schema accepted, as the action takes them. */
export function fromFormValues({
  dailyLlmSpendCap,
  ...settings
}: AiSettingsFormValues): AiSettings {
  return {
    ...settings,
    dailyLlmSpendCapUsd: parseSpendCap(dailyLlmSpendCap) ?? null,
  };
}

/**
 * The form's schema: the mode rule, shown under the external toggle, and
 * the cap rule, under the cap field.
 */
export const AiSettingsFormSchema = AiSettingsSchema.omit({
  dailyLlmSpendCapUsd: true,
})
  .extend({ dailyLlmSpendCap: z.string() })
  .superRefine((settings, ctx) => {
    const problem = aiSettingsProblem(settings);

    if (problem) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: problem,
        path: [
          problem === BOTH_MODES_OFF_REFUSAL
            ? 'externalGenerationEnabled'
            : 'defaultMode',
        ],
      });
    }

    if (parseSpendCap(settings.dailyLlmSpendCap) === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: SPEND_CAP_REFUSAL,
        path: ['dailyLlmSpendCap'],
      });
    }
  });

/**
 * The action's input. No refinement here: the action refuses a bad
 * combination as a value (production redacts a thrown validation error).
 */
export const UpdateAccountAiSettingsSchema = AiSettingsSchema.extend({
  accountSlug: z.string().min(1),
});
