import { z } from 'zod';

export const GENERATION_MODES = ['server', 'external'] as const;
export type GenerationMode = (typeof GENERATION_MODES)[number];

export const AiSettingsSchema = z.object({
  serverGenerationEnabled: z.boolean(),
  externalGenerationEnabled: z.boolean(),
  defaultMode: z.enum(GENERATION_MODES),
});

export type AiSettings = z.infer<typeof AiSettingsSchema>;

export const AI_SETTINGS_DEFAULTS: AiSettings = {
  serverGenerationEnabled: true,
  externalGenerationEnabled: true,
  defaultMode: 'server',
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
export function aiSettingsProblem(settings: AiSettings): string | null {
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

/** The form's schema: the same rule, shown under the external toggle. */
export const AiSettingsFormSchema = AiSettingsSchema.superRefine(
  (settings, ctx) => {
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
  },
);

/**
 * The action's input. No refinement here: the action refuses a bad
 * combination as a value (production redacts a thrown validation error).
 */
export const UpdateAccountAiSettingsSchema = AiSettingsSchema.extend({
  accountSlug: z.string().min(1),
});
