import { z } from 'zod';

import {
  ContentStyleSchema,
  GenreSchema,
  VideoStyleSchema,
} from '@kit/film-studio-schemas';

/**
 * Schema for updating studio project settings (content generation)
 * These settings affect story/screenplay/shot generation
 */
export const UpdateStudioSettingsSchema = z.object({
  projectId: z.string().uuid(),
  targetAudience: z.string().max(200).optional(),
  genre: GenreSchema.optional(),
  videoStyle: VideoStyleSchema.optional(),
  contentStyle: ContentStyleSchema.optional(),
  defaultEpisodeDuration: z.number().int().min(60).max(7200).optional(),
  contentRating: z.enum(['G', 'PG', 'PG-13', 'R', 'NR']).optional(),
  language: z.string().max(10).optional(),
});

export type UpdateStudioSettingsInput = z.infer<
  typeof UpdateStudioSettingsSchema
>;
