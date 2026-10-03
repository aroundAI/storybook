import { describe, expect, it } from 'vitest';

import {
  AI_SETTINGS_DEFAULTS,
  AiSettingsFormSchema,
  BOTH_MODES_OFF_REFUSAL,
  DEFAULT_MODE_OFF_REFUSAL,
  aiSettingsProblem,
} from '../schemas/ai-settings.schema';

describe('team AI settings (FILM-1910)', () => {
  it('accepts either mode alone, or both', () => {
    for (const [server, external, defaultMode] of [
      [true, true, 'server'],
      [true, true, 'external'],
      [true, false, 'server'],
      [false, true, 'external'],
    ] as const) {
      expect(
        aiSettingsProblem({
          serverGenerationEnabled: server,
          externalGenerationEnabled: external,
          defaultMode,
          performanceContextEnabled: false,
        }),
      ).toBeNull();
    }
  });

  it('refuses both modes off', () => {
    expect(
      aiSettingsProblem({
        serverGenerationEnabled: false,
        externalGenerationEnabled: false,
        defaultMode: 'server',
        performanceContextEnabled: false,
      }),
    ).toBe(BOTH_MODES_OFF_REFUSAL);
  });

  it('refuses a default the team does not allow', () => {
    expect(
      aiSettingsProblem({
        serverGenerationEnabled: false,
        externalGenerationEnabled: true,
        defaultMode: 'server',
        performanceContextEnabled: false,
      }),
    ).toBe(DEFAULT_MODE_OFF_REFUSAL);
  });

  it('puts the form error under the toggle that caused it', () => {
    const result = AiSettingsFormSchema.safeParse({
      serverGenerationEnabled: false,
      externalGenerationEnabled: false,
      defaultMode: 'external',
      performanceContextEnabled: true,
    });

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]).toMatchObject({
      path: ['externalGenerationEnabled'],
      message: BOTH_MODES_OFF_REFUSAL,
    });
  });

  it('keeps past-performance context off by default, and requires a stated value (FILM-1912)', () => {
    expect(AI_SETTINGS_DEFAULTS.performanceContextEnabled).toBe(false);

    // A form from before the field existed is refused rather than saved as
    // off, which would silently undo an owner's choice
    const stale = AiSettingsFormSchema.safeParse({
      serverGenerationEnabled: true,
      externalGenerationEnabled: true,
      defaultMode: 'server',
    });
    expect(stale.success).toBe(false);
    expect(stale.error?.issues[0]?.path).toEqual(['performanceContextEnabled']);
  });
});
