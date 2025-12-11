/**
 * Clip generation schemas
 */
import { z } from 'zod';

/**
 * Crop settings schema
 */
export const CropSettingsSchema = z.object({
  type: z.enum(['center', 'left', 'right', 'smart', 'custom']),
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  scale: z.number().min(0.5).max(2),
});

/**
 * Aspect ratio schema
 */
export const AspectRatioSchema = z.enum(['9:16', '1:1', '16:9']);

/**
 * Schema for generateClipAction
 */
export const GenerateClipSchema = z.object({
  episodeId: z.string().uuid(),
  videoUrl: z.string().url(),
  startTime: z.number().min(0),
  endTime: z.number().min(0),
  title: z.string().min(1).max(255),
  cropSettings: CropSettingsSchema,
  aspectRatio: AspectRatioSchema,
});

/**
 * Clip region schema for client-side validation
 */
export const ClipRegionSchema = z.object({
  id: z.string(),
  startTime: z.number().min(0),
  endTime: z.number().min(0),
  title: z.string().min(1).max(255),
  cropSettings: CropSettingsSchema,
  generated: z.boolean().optional(),
  generatedUrl: z.string().url().optional(),
});

/**
 * Type exports
 */
export type GenerateClipInput = z.infer<typeof GenerateClipSchema>;
export type ClipRegionInput = z.infer<typeof ClipRegionSchema>;
