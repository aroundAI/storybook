/**
 * Dialogue query schemas (FILM-506)
 * Zod schemas for fetching dialogue lines
 */
import { z } from 'zod';

/**
 * Schema for fetching dialogue lines for an episode
 */
export const GetDialogueLinesSchema = z.object({
  episodeId: z.string().uuid(),
  language: z.string().optional(),
});

export type GetDialogueLinesSchemaType = z.infer<typeof GetDialogueLinesSchema>;

/**
 * Schema for fetching characters for an episode
 */
export const GetCharactersForEpisodeSchema = z.object({
  episodeId: z.string().uuid(),
});

export type GetCharactersForEpisodeSchemaType = z.infer<
  typeof GetCharactersForEpisodeSchema
>;
