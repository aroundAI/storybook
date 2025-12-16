import { z } from 'zod';

/**
 * Caption style presets
 */
export const CaptionStylePresets = [
  'standard',
  'bold',
  'minimal',
  'animated',
] as const;

export type CaptionStylePreset = (typeof CaptionStylePresets)[number];

/**
 * Supported languages for captions
 */
export const SupportedLanguages = [
  'en',
  'es',
  'fr',
  'de',
  'it',
  'pt',
  'ja',
  'ko',
  'zh',
  'ar',
  'hi',
  'ru',
] as const;

export type SupportedLanguage = (typeof SupportedLanguages)[number];

/**
 * Caption status values
 */
export const CaptionStatuses = [
  'pending',
  'transcribing',
  'translating',
  'completed',
  'failed',
] as const;

export type CaptionStatus = (typeof CaptionStatuses)[number];

/**
 * Custom style schema for caption appearance
 */
export const CaptionCustomStyleSchema = z.object({
  fontFamily: z.string().optional(),
  fontSize: z.number().min(12).max(72).optional(),
  fontWeight: z.enum(['normal', 'bold']).optional(),
  color: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/)
    .optional(),
  backgroundColor: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}([0-9A-Fa-f]{2})?$/)
    .optional(),
  textShadow: z.boolean().optional(),
  position: z.enum(['top', 'middle', 'bottom']).optional(),
  textAlign: z.enum(['left', 'center', 'right']).optional(),
  outline: z.boolean().optional(),
  outlineColor: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/)
    .optional(),
});

export type CaptionCustomStyle = z.infer<typeof CaptionCustomStyleSchema>;

/**
 * Word-level timing schema
 */
export const CaptionWordSchema = z.object({
  word: z.string().min(1),
  start: z.number().nonnegative(),
  end: z.number().positive(),
});

export type CaptionWord = z.infer<typeof CaptionWordSchema>;

/**
 * Caption segment schema
 */
export const CaptionSegmentSchema = z.object({
  id: z.string().uuid().optional(),
  captionId: z.string().uuid().optional(),
  startTime: z.number().nonnegative(),
  endTime: z.number().positive(),
  text: z.string().min(1).max(500),
  words: z.array(CaptionWordSchema).optional(),
  speakerId: z.string().uuid().optional().nullable(),
  sequenceNumber: z.number().int().positive(),
  isEdited: z.boolean().optional(),
});

export type CaptionSegment = z.infer<typeof CaptionSegmentSchema>;

/**
 * Caption record schema
 */
export const CaptionSchema = z.object({
  id: z.string().uuid(),
  episodeId: z.string().uuid(),
  language: z.string().length(2),
  stylePreset: z.enum(CaptionStylePresets),
  customStyles: CaptionCustomStyleSchema.optional(),
  status: z.enum(CaptionStatuses),
  sourceCaptionId: z.string().uuid().optional().nullable(),
  segments: z.array(CaptionSegmentSchema).optional(),
  createdAt: z.string().datetime().optional(),
  updatedAt: z.string().datetime().optional(),
});

export type Caption = z.infer<typeof CaptionSchema>;

// ============================================
// Server Action Schemas
// ============================================

/**
 * Generate captions from dialogue audio
 */
export const GenerateCaptionsSchema = z.object({
  episodeId: z.string().uuid(),
  language: z.string().length(2).default('en'),
  stylePreset: z.enum(CaptionStylePresets).default('standard'),
});

export type GenerateCaptionsInput = z.infer<typeof GenerateCaptionsSchema>;

/**
 * Translate captions to another language
 */
export const TranslateCaptionsSchema = z.object({
  sourceCaptionId: z.string().uuid(),
  targetLanguage: z.string().length(2),
  stylePreset: z.enum(CaptionStylePresets).optional(),
});

export type TranslateCaptionsInput = z.infer<typeof TranslateCaptionsSchema>;

/**
 * Get captions for an episode
 */
export const GetCaptionsSchema = z.object({
  episodeId: z.string().uuid(),
  language: z.string().length(2).optional(),
});

export type GetCaptionsInput = z.infer<typeof GetCaptionsSchema>;

/**
 * Update a caption segment
 */
export const UpdateCaptionSegmentSchema = z.object({
  segmentId: z.string().uuid(),
  text: z.string().min(1).max(500),
  startTime: z.number().nonnegative().optional(),
  endTime: z.number().positive().optional(),
  speakerId: z.string().uuid().optional().nullable(),
});

export type UpdateCaptionSegmentInput = z.infer<
  typeof UpdateCaptionSegmentSchema
>;

/**
 * Update caption style
 */
export const UpdateCaptionStyleSchema = z.object({
  captionId: z.string().uuid(),
  stylePreset: z.enum(CaptionStylePresets).optional(),
  customStyles: CaptionCustomStyleSchema.optional(),
});

export type UpdateCaptionStyleInput = z.infer<typeof UpdateCaptionStyleSchema>;

/**
 * Export captions to SRT or VTT
 */
export const ExportCaptionsSchema = z.object({
  captionId: z.string().uuid(),
  format: z.enum(['srt', 'vtt']),
});

export type ExportCaptionsInput = z.infer<typeof ExportCaptionsSchema>;

/**
 * Delete a caption
 */
export const DeleteCaptionSchema = z.object({
  captionId: z.string().uuid(),
});

export type DeleteCaptionInput = z.infer<typeof DeleteCaptionSchema>;

/**
 * Get all languages available for an episode
 */
export const GetAvailableLanguagesSchema = z.object({
  episodeId: z.string().uuid(),
});

export type GetAvailableLanguagesInput = z.infer<
  typeof GetAvailableLanguagesSchema
>;
