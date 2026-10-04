import { z } from 'zod';

/**
 * The delivery presets a StorybookStudio render is made for (FILM-2003,
 * FILM-2017). A fixed list: `episode_renders.preset` carries the same CHECK,
 * and request_render_upload refuses anything else. `aspect` is the frame the
 * preset renders; `master` is the clean full-quality file and may be any
 * aspect. Zod only, so the fork copies this file unchanged.
 */
export const RENDER_ASPECTS = ['16:9', '9:16', '1:1'] as const;

export const RenderAspectSchema = z.enum(RENDER_ASPECTS);

export type RenderAspect = z.infer<typeof RenderAspectSchema>;

export const RENDER_PRESETS = {
  youtube_16x9: { aspect: '16:9' },
  shorts_9x16: { aspect: '9:16' },
  tiktok_9x16: { aspect: '9:16' },
  reels_9x16: { aspect: '9:16' },
  square_1x1: { aspect: '1:1' },
  master: { aspect: null },
} as const satisfies Record<string, { aspect: RenderAspect | null }>;

export type RenderPreset = keyof typeof RENDER_PRESETS;

export const RENDER_PRESET_NAMES = Object.keys(RENDER_PRESETS) as [
  RenderPreset,
  ...RenderPreset[],
];

export const RenderPresetSchema = z.enum(RENDER_PRESET_NAMES);

/** Whether a render of `preset` may have `aspect`: the preset's own, or any for master. */
export function presetAllowsAspect(
  preset: RenderPreset,
  aspect: RenderAspect,
): boolean {
  const expected = RENDER_PRESETS[preset].aspect;

  return expected === null || expected === aspect;
}

/** A vertical render: offered to TikTok, Reels and YouTube Shorts on the publish page. */
export function isVerticalRender(render: { aspect: string }): boolean {
  return render.aspect === '9:16';
}

/** The only container a render is stored as: keys end in `.mp4`. */
export const RENDER_CONTENT_TYPE = 'video/mp4';

export const RENDER_STATUSES = [
  'uploading',
  'ready',
  'failed',
  'superseded',
] as const;

export type RenderStatus = (typeof RENDER_STATUSES)[number];

/** BCP 47-ish language tag, as `episode_renders.language` holds it ('en', 'pt-BR'). */
export const RenderLanguageSchema = z
  .string()
  .regex(
    /^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})?$/,
    'A language tag such as en or pt-BR',
  );
