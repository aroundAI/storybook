import { describe, expect, it } from 'vitest';

import {
  AI_SETTINGS_DEFAULTS,
  AiSettingsFormSchema,
  BOTH_MODES_OFF_REFUSAL,
  DEFAULT_MODE_OFF_REFUSAL,
  SPEND_CAP_REFUSAL,
  aiSettingsProblem,
  fromFormValues,
  parseSpendCap,
  spendCapProblem,
  toFormValues,
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
      desktopIntegrationEnabled: false,
      dailyLlmSpendCap: '',
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

  it('keeps StorybookStudio off by default, and requires a stated value (FILM-2005)', () => {
    expect(AI_SETTINGS_DEFAULTS.desktopIntegrationEnabled).toBe(false);

    const stale = AiSettingsFormSchema.safeParse({
      serverGenerationEnabled: true,
      externalGenerationEnabled: true,
      defaultMode: 'server',
      performanceContextEnabled: false,
      dailyLlmSpendCap: '',
    });
    expect(stale.success).toBe(false);
    expect(stale.error?.issues.map((issue) => issue.path)).toEqual([
      ['desktopIntegrationEnabled'],
    ]);

    const on = AiSettingsFormSchema.safeParse({
      ...toFormValues(AI_SETTINGS_DEFAULTS),
      desktopIntegrationEnabled: true,
    });
    expect(on.success).toBe(true);
    expect(on.data && fromFormValues(on.data).desktopIntegrationEnabled).toBe(
      true,
    );
  });
});

describe('the daily spend cap (owner decision 2026-10-03)', () => {
  it('reads an empty field as no cap', () => {
    expect(parseSpendCap('')).toBeNull();
    expect(parseSpendCap('   ')).toBeNull();
  });

  it('reads dollars as typed or pasted, keeping their value', () => {
    expect(parseSpendCap('5')).toBe(5);
    expect(parseSpendCap('12.50')).toBe(12.5);
    expect(parseSpendCap('$0.29')).toBe(0.29);
    expect(parseSpendCap('1,250.00')).toBe(1250);
    expect(parseSpendCap(' 100000 ')).toBe(100000);
  });

  it('refuses zero, a negative, more than two decimals, too much and words', () => {
    for (const text of [
      '0',
      '0.00',
      '-5',
      '1.234',
      '100000.01',
      'five',
      '1.2.3',
    ]) {
      expect(parseSpendCap(text), text).toBeUndefined();
    }
  });

  it('holds the same rule for a number the action receives', () => {
    expect(spendCapProblem(null)).toBeNull();
    expect(spendCapProblem(0.29)).toBeNull();
    expect(spendCapProblem(0)).toBe(SPEND_CAP_REFUSAL);
    expect(spendCapProblem(-1)).toBe(SPEND_CAP_REFUSAL);
    expect(spendCapProblem(1.234)).toBe(SPEND_CAP_REFUSAL);
    expect(spendCapProblem(Number.NaN)).toBe(SPEND_CAP_REFUSAL);
  });

  it('shows a saved cap with cents and saves the field back as the number', () => {
    const values = toFormValues({
      ...AI_SETTINGS_DEFAULTS,
      dailyLlmSpendCapUsd: 12.5,
    });

    expect(values.dailyLlmSpendCap).toBe('12.50');
    expect(fromFormValues(values).dailyLlmSpendCapUsd).toBe(12.5);
    expect(
      fromFormValues({ ...values, dailyLlmSpendCap: '' }).dailyLlmSpendCapUsd,
    ).toBeNull();
    expect(AI_SETTINGS_DEFAULTS.dailyLlmSpendCapUsd).toBeNull();
  });

  it('shows the refusal under the cap field', () => {
    const result = AiSettingsFormSchema.safeParse({
      ...toFormValues(AI_SETTINGS_DEFAULTS),
      dailyLlmSpendCap: '0',
    });

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]).toMatchObject({
      path: ['dailyLlmSpendCap'],
      message: SPEND_CAP_REFUSAL,
    });
  });
});
