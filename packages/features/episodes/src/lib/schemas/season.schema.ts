import { z } from 'zod';

/**
 * Schema for creating a new season
 * Season number is auto-assigned if not provided
 */
export const CreateSeasonSchema = z.object({
  projectId: z.string().uuid(),
  number: z.number().int().positive().optional(),
  name: z.string().min(1).max(255),
  description: z.string().max(1000).optional(),
  directionNotes: z.string().max(5000).optional(),
});

/**
 * Schema for fetching all seasons for a project
 */
export const GetProjectSeasonsSchema = z.object({
  projectId: z.string().uuid(),
});

/**
 * Schema for updating an existing season
 * All fields except seasonId are optional for partial updates
 */
export const UpdateSeasonSchema = z.object({
  seasonId: z.string().uuid(),
  /** The version read; when given, a season that moved since is refused (FILM-2201) */
  version: z.number().int().positive().optional(),
  name: z.string().min(1).max(255).optional(),
  description: z.string().max(1000).optional(),
  directionNotes: z.string().max(5000).optional(),
});

/**
 * Schema for soft deleting a season
 */
export const DeleteSeasonSchema = z.object({
  seasonId: z.string().uuid(),
});

/**
 * FILM-2201: renumber a project's seasons in the order given (every live
 * season, once)
 */
export const ReorderSeasonsSchema = z.object({
  projectId: z.string().uuid(),
  seasonIds: z.array(z.string().uuid()).min(1).max(500),
});

/** FILM-2201: delete a season and move its episodes to Unsorted */
export const DeleteSeasonKeepEpisodesSchema = z.object({
  seasonId: z.string().uuid(),
  version: z.number().int().positive(),
});

/** FILM-2201: move an episode into a season of its project, or to Unsorted (null) */
export const MoveEpisodeToSeasonSchema = z.object({
  episodeId: z.string().uuid(),
  version: z.number().int().positive(),
  seasonId: z.string().uuid().nullable(),
});

export type CreateSeasonInput = z.infer<typeof CreateSeasonSchema>;
export type GetProjectSeasonsInput = z.infer<typeof GetProjectSeasonsSchema>;
export type UpdateSeasonInput = z.infer<typeof UpdateSeasonSchema>;
export type DeleteSeasonInput = z.infer<typeof DeleteSeasonSchema>;
