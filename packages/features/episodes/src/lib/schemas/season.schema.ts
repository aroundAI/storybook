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
  name: z.string().min(1).max(255).optional(),
  description: z.string().max(1000).optional(),
});

/**
 * Schema for soft deleting a season
 */
export const DeleteSeasonSchema = z.object({
  seasonId: z.string().uuid(),
});

export type CreateSeasonInput = z.infer<typeof CreateSeasonSchema>;
export type GetProjectSeasonsInput = z.infer<typeof GetProjectSeasonsSchema>;
export type UpdateSeasonInput = z.infer<typeof UpdateSeasonSchema>;
export type DeleteSeasonInput = z.infer<typeof DeleteSeasonSchema>;
