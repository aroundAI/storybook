import { describe, expect, it } from 'vitest';

import {
  BRAND_DEFAULTS,
  BrandPatchSchema,
  BrandSchema,
  EDIT_POLICY_DEFAULTS,
  EditPolicyPatchSchema,
  EditPolicySchema,
  applyBrandPatch,
  applyEditPolicyPatch,
  readStoredBrand,
  readStoredEditPolicy,
} from '../src';

describe('BrandSchema', () => {
  it("parses '{}' to the full default brand", () => {
    expect(BrandSchema.parse({})).toEqual({
      fonts: { heading: 'Inter', body: 'Inter' },
      colors: {
        primary: '#2563EB',
        secondary: '#F59E0B',
        background: '#000000',
        captionText: '#FFFFFF',
        captionBackground: '#000000',
      },
      captionStyle: {
        fontSize: 48,
        position: 'bottom',
        maxCharsPerLine: 32,
        background: 'box',
        emphasis: 'none',
        emphasisWords: [],
      },
      logo: { assetId: null, position: 'top-right', opacity: 0.8 },
      introAssetId: null,
      outroAssetId: null,
      transitionStyle: 'cut',
      musicStyle: [],
    });
    expect(BRAND_DEFAULTS).toEqual(BrandSchema.parse({}));
  });

  it('fills the rest of a nested group when one field is given', () => {
    const brand = BrandSchema.parse({ colors: { captionText: '#FF0000' } });

    expect(brand.colors).toEqual({
      ...BRAND_DEFAULTS.colors,
      captionText: '#FF0000',
    });
  });

  it.each(['red', '#FFF', '#GGGGGG', 'FF0000', '#FF00001', ''])(
    'refuses the colour %j',
    (captionText) => {
      const result = BrandSchema.safeParse({ colors: { captionText } });

      expect(result.success).toBe(false);
      expect(result.error?.issues[0]?.path).toEqual(['colors', 'captionText']);
    },
  );

  it('accepts #RRGGBB and #RRGGBBAA', () => {
    expect(
      BrandSchema.safeParse({
        colors: { captionText: '#a1b2c3', captionBackground: '#000000CC' },
      }).success,
    ).toBe(true);
  });

  it('refuses an unknown transition style and caption position', () => {
    expect(BrandSchema.safeParse({ transitionStyle: 'wipe' }).success).toBe(
      false,
    );
    expect(
      BrandSchema.safeParse({ captionStyle: { position: 'left' } }).success,
    ).toBe(false);
  });

  it('refuses a logo asset id that is not a uuid, and an opacity above 1', () => {
    expect(BrandSchema.safeParse({ logo: { assetId: 'x' } }).success).toBe(
      false,
    );
    expect(BrandSchema.safeParse({ logo: { opacity: 1.5 } }).success).toBe(
      false,
    );
  });
});

describe('EditPolicySchema', () => {
  it("parses '{}' to the full default policy", () => {
    expect(EditPolicySchema.parse({})).toEqual({
      targetDurationSeconds: null,
      minShotLength: 1.2,
      maxShotLength: 6,
      transitions: { preferred: ['cut', 'dissolve'], maxDuration: 0.4 },
      music: { enabled: true, duckUnderDialogue: true, duckDb: -8 },
      captions: { enabled: true, style: 'brand' },
      visual: { avoidRepeatedShots: true, avoidExtremeZoom: true },
      loudnessTargetLufs: -14,
      allowDialogueCuts: 'ask',
      maxSilenceSeconds: 1.5,
    });
    expect(EDIT_POLICY_DEFAULTS).toEqual(EditPolicySchema.parse({}));
  });

  it.each([
    [{ minShotLength: 0.1 }, ['minShotLength']],
    [{ maxShotLength: 31 }, ['maxShotLength']],
    [{ minShotLength: 8, maxShotLength: 4 }, ['minShotLength']],
    [{ minShotLength: 7 }, ['minShotLength']],
  ])('refuses the out-of-range shot lengths %j', (input, path) => {
    const result = EditPolicySchema.safeParse(input);

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(path);
  });

  it('refuses an unknown transition and an empty transition list', () => {
    expect(
      EditPolicySchema.safeParse({ transitions: { preferred: ['wipe'] } })
        .success,
    ).toBe(false);
    expect(
      EditPolicySchema.safeParse({ transitions: { preferred: [] } }).success,
    ).toBe(false);
  });

  it('refuses a target duration outside the episode range 60-7200', () => {
    expect(
      EditPolicySchema.safeParse({ targetDurationSeconds: 59 }).success,
    ).toBe(false);
    expect(
      EditPolicySchema.safeParse({ targetDurationSeconds: 300 }).success,
    ).toBe(true);
  });

  it('refuses a positive duck gain', () => {
    expect(EditPolicySchema.safeParse({ music: { duckDb: 3 } }).success).toBe(
      false,
    );
  });
});

describe('dialogue cuts, silence and emphasis words (FILM-2004)', () => {
  it.each(['never', 'ask', 'allow'])('accepts allowDialogueCuts %j', (v) => {
    expect(
      EditPolicySchema.parse({ allowDialogueCuts: v }).allowDialogueCuts,
    ).toBe(v);
  });

  it.each([{ allowDialogueCuts: 'always' }, { allowDialogueCuts: true }])(
    'refuses the dialogue-cut setting %j',
    (input) => {
      const result = EditPolicySchema.safeParse(input);

      expect(result.success).toBe(false);
      expect(result.error?.issues[0]?.path).toEqual(['allowDialogueCuts']);
    },
  );

  it.each([0, -1, 10.5])(
    'refuses maxSilenceSeconds %j',
    (maxSilenceSeconds) => {
      const result = EditPolicySchema.safeParse({ maxSilenceSeconds });

      expect(result.success).toBe(false);
      expect(result.error?.issues[0]?.path).toEqual(['maxSilenceSeconds']);
    },
  );

  it('accepts a silence of 10 seconds, the ceiling', () => {
    expect(
      EditPolicySchema.parse({ maxSilenceSeconds: 10 }).maxSilenceSeconds,
    ).toBe(10);
  });

  it('parses a row stored before these fields existed, with the defaults', () => {
    const { allowDialogueCuts, maxSilenceSeconds, ...oldPolicy } =
      EDIT_POLICY_DEFAULTS;
    const { emphasisWords, ...oldCaptionStyle } = BRAND_DEFAULTS.captionStyle;
    const oldBrand = { ...BRAND_DEFAULTS, captionStyle: oldCaptionStyle };

    expect([allowDialogueCuts, maxSilenceSeconds, emphasisWords]).toEqual([
      'ask',
      1.5,
      [],
    ]);
    expect(readStoredEditPolicy(oldPolicy)).toEqual({
      value: EDIT_POLICY_DEFAULTS,
      issues: [],
    });
    expect(readStoredBrand(oldBrand)).toEqual({
      value: BRAND_DEFAULTS,
      issues: [],
    });
  });

  it('refuses an empty emphasis word and more than 50 words', () => {
    expect(
      BrandSchema.safeParse({ captionStyle: { emphasisWords: [''] } }).success,
    ).toBe(false);
    expect(
      BrandSchema.safeParse({
        captionStyle: {
          emphasisWords: Array.from({ length: 51 }, (_, i) => `w${i}`),
        },
      }).success,
    ).toBe(false);
  });

  it('patches the new fields without resetting the others', () => {
    expect(
      EditPolicyPatchSchema.parse({
        allowDialogueCuts: 'never',
        maxSilenceSeconds: 2,
      }),
    ).toEqual({ allowDialogueCuts: 'never', maxSilenceSeconds: 2 });
    expect(
      applyBrandPatch(BRAND_DEFAULTS, {
        captionStyle: { emphasisWords: ['free'] },
      }).captionStyle,
    ).toEqual({ ...BRAND_DEFAULTS.captionStyle, emphasisWords: ['free'] });
  });
});

describe('readStoredBrand / readStoredEditPolicy', () => {
  it('applies the defaults to a stored {} and to null', () => {
    expect(readStoredBrand({})).toEqual({ value: BRAND_DEFAULTS, issues: [] });
    expect(readStoredEditPolicy(null)).toEqual({
      value: EDIT_POLICY_DEFAULTS,
      issues: [],
    });
  });

  it('falls back to the defaults on an invalid stored object and says why', () => {
    const read = readStoredBrand({ colors: { primary: 'blue' } });

    expect(read.value).toEqual(BRAND_DEFAULTS);
    expect(read.issues).toEqual([
      'colors.primary: Use a hex colour: #RRGGBB or #RRGGBBAA',
    ]);
  });
});

describe('applyBrandPatch / applyEditPolicyPatch', () => {
  it('changes only the named fields, nested groups field by field', () => {
    const current = applyBrandPatch(BRAND_DEFAULTS, {
      colors: { primary: '#111111' },
    });
    const patched = applyBrandPatch(
      current,
      BrandPatchSchema.parse({ colors: { captionText: '#FF0000' } }),
    );

    expect(patched.colors).toEqual({
      ...BRAND_DEFAULTS.colors,
      primary: '#111111',
      captionText: '#FF0000',
    });
    expect(patched.captionStyle).toEqual(BRAND_DEFAULTS.captionStyle);
  });

  it('does not default the fields a patch leaves out', () => {
    expect(BrandPatchSchema.parse({ colors: { primary: '#111111' } })).toEqual({
      colors: { primary: '#111111' },
    });
  });

  it('refuses an unknown key in a patch', () => {
    expect(BrandPatchSchema.safeParse({ colour: {} }).success).toBe(false);
  });

  it('checks the min/max shot rule on the merged policy', () => {
    const patch = EditPolicyPatchSchema.parse({ minShotLength: 7 });

    expect(() => applyEditPolicyPatch(EDIT_POLICY_DEFAULTS, patch)).toThrow(
      /shortest shot/,
    );
    expect(
      applyEditPolicyPatch(EDIT_POLICY_DEFAULTS, {
        minShotLength: 7,
        maxShotLength: 10,
      }),
    ).toMatchObject({ minShotLength: 7, maxShotLength: 10 });
  });

  it('replaces arrays rather than merging them', () => {
    expect(
      applyEditPolicyPatch(EDIT_POLICY_DEFAULTS, {
        transitions: { preferred: ['dip'] },
      }).transitions,
    ).toEqual({ preferred: ['dip'], maxDuration: 0.4 });
  });
});
