import { z } from 'zod';

import {
  BRAND_DEFAULTS,
  type Brand,
  BrandColorsSchema,
  BrandFontsSchema,
  BrandLogoSchema,
  BrandSchema,
  CaptionStyleSchema,
} from './brand.schema';
import {
  EDIT_POLICY_DEFAULTS,
  type EditPolicy,
  EditPolicyObjectSchema,
  EditPolicySchema,
  PolicyCaptionsSchema,
  PolicyMusicSchema,
  PolicyTransitionsSchema,
  PolicyVisualSchema,
} from './edit-policy.schema';

/**
 * Reading and updating `projects.brand` / `projects.edit_policy` in
 * StoryBook. Not part of the copied contract: the fork only needs the two
 * schema files.
 */

export interface StoredSetting<T> {
  value: T;
  /** Why the stored object was not used; empty when it was. */
  issues: string[];
}

function readStored<T>(
  schema: z.ZodType<T, z.ZodTypeDef, unknown>,
  defaults: T,
  stored: unknown,
): StoredSetting<T> {
  const parsed = schema.safeParse(stored ?? {});

  if (parsed.success) {
    return { value: parsed.data, issues: [] };
  }

  return {
    value: defaults,
    issues: parsed.error.issues.map(
      (issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`,
    ),
  };
}

/**
 * The project's brand with every default applied. A stored object that no
 * longer validates (written outside the app) yields the defaults and says
 * why, rather than failing the read.
 */
export function readStoredBrand(stored: unknown): StoredSetting<Brand> {
  return readStored(BrandSchema, BRAND_DEFAULTS, stored);
}

/** The project's edit policy with every default applied; see readStoredBrand. */
export function readStoredEditPolicy(
  stored: unknown,
): StoredSetting<EditPolicy> {
  return readStored(EditPolicySchema, EDIT_POLICY_DEFAULTS, stored);
}

/**
 * A partial brand: any top-level field, and any field of a nested group.
 * `.partial()` leaves a missing field undefined rather than defaulting it,
 * so a patch never resets what it does not name.
 */
export const BrandPatchSchema = z
  .object({
    fonts: BrandFontsSchema.partial(),
    colors: BrandColorsSchema.partial(),
    captionStyle: CaptionStyleSchema.partial(),
    logo: BrandLogoSchema.partial(),
    introAssetId: BrandSchema.shape.introAssetId.removeDefault(),
    outroAssetId: BrandSchema.shape.outroAssetId.removeDefault(),
    transitionStyle: BrandSchema.shape.transitionStyle.removeDefault(),
    musicStyle: BrandSchema.shape.musicStyle.removeDefault(),
  })
  .partial()
  .strict();

/** A partial edit policy; see BrandPatchSchema. */
export const EditPolicyPatchSchema = z
  .object({
    targetDurationSeconds:
      EditPolicyObjectSchema.shape.targetDurationSeconds.removeDefault(),
    minShotLength: EditPolicyObjectSchema.shape.minShotLength.removeDefault(),
    maxShotLength: EditPolicyObjectSchema.shape.maxShotLength.removeDefault(),
    transitions: PolicyTransitionsSchema.partial(),
    music: PolicyMusicSchema.partial(),
    captions: PolicyCaptionsSchema.partial(),
    visual: PolicyVisualSchema.partial(),
    loudnessTargetLufs:
      EditPolicyObjectSchema.shape.loudnessTargetLufs.removeDefault(),
    allowDialogueCuts:
      EditPolicyObjectSchema.shape.allowDialogueCuts.removeDefault(),
    maxSilenceSeconds:
      EditPolicyObjectSchema.shape.maxSilenceSeconds.removeDefault(),
  })
  .partial()
  .strict();

export type BrandPatch = z.infer<typeof BrandPatchSchema>;
export type EditPolicyPatch = z.infer<typeof EditPolicyPatchSchema>;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Top-level fields replace; nested groups merge field by field. */
function mergeOneLevel(
  current: Record<string, unknown>,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...current };

  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;

    const existing = merged[key];
    merged[key] =
      isPlainObject(existing) && isPlainObject(value)
        ? { ...existing, ...value }
        : value;
  }

  return merged;
}

/**
 * The brand after applying `patch` to `current` (a full brand), validated
 * by BrandSchema. Throws a ZodError when the result is not a valid brand.
 */
export function applyBrandPatch(current: Brand, patch: BrandPatch): Brand {
  return BrandSchema.parse(mergeOneLevel(current, patch));
}

/**
 * The policy after applying `patch` to `current`, validated by
 * EditPolicySchema, so the min/max shot rule is checked on the result.
 */
export function applyEditPolicyPatch(
  current: EditPolicy,
  patch: EditPolicyPatch,
): EditPolicy {
  return EditPolicySchema.parse(mergeOneLevel(current, patch));
}
