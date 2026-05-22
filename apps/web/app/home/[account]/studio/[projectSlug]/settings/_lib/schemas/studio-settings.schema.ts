import { z } from 'zod';

import {
  ContentStyleSchema,
  GenreSchema,
  VideoStyleSchema,
} from '@kit/film-studio-schemas';

/**
 * Recurring element placement options
 */
const RecurringElementPlacementSchema = z.enum([
  'beginning',
  'middle',
  'end',
  'throughout',
]);

/**
 * Recurring element configuration
 * E.g., a signature scene, opening establishing shot, or episode-ending pattern
 */
const RecurringElementSchema = z.object({
  id: z.string(),
  name: z.string().max(100),
  enabled: z.boolean().default(false),
  location: z.string().max(200).optional(),
  purpose: z.string().max(500).optional(),
  placement: RecurringElementPlacementSchema.default('end'),
  dialogueHints: z.string().max(500).optional(),
});

/**
 * Schema for updating studio project settings (content generation)
 * These settings affect story/screenplay/shot generation
 */
export const UpdateStudioSettingsSchema = z.object({
  projectId: z.string().uuid(),
  description: z.string().max(1000).optional(),
  targetAudience: z.string().max(200).optional(),
  genre: GenreSchema.optional(),
  videoStyle: VideoStyleSchema.optional(),
  contentStyle: ContentStyleSchema.optional(),
  defaultEpisodeDuration: z.number().int().min(60).max(7200).optional(),
  contentRating: z.enum(['G', 'PG', 'PG-13', 'R', 'NR']).optional(),
  language: z.string().max(10).optional(),
  recurringElements: z.array(RecurringElementSchema).max(5).optional(),
  /**
   * Project-level aesthetic style that gets injected into all VEO shot prompts.
   * Used to ensure visual consistency across all generated content.
   * Example: "Noir-inspired with saturated colors, dramatic shadows, and whimsical undertones"
   */
  projectAestheticStyle: z.string().max(500).optional(),
});

export type UpdateStudioSettingsInput = z.infer<
  typeof UpdateStudioSettingsSchema
>;

export type RecurringElement = z.infer<typeof RecurringElementSchema>;

export type RecurringElementPlacement = z.infer<
  typeof RecurringElementPlacementSchema
>;
