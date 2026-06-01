import { z } from 'zod';

/**
 * Schema for creating an episode with full context via the Enhanced Create Episode Wizard.
 * Supports attaching facts, creative direction, and optional auto-generation.
 */
export const CreateEpisodeWithContextSchema = z.object({
  projectId: z.string().uuid(),
  seasonId: z.string().uuid().optional(),
  newSeasonName: z.string().min(1).max(255).optional(),

  // Basics
  title: z.string().min(1).max(255),
  description: z.string().max(2000).optional(),

  // Facts
  factIds: z.array(z.string().uuid()).optional(),

  // Creative Direction
  hook: z.string().max(500).optional(),
  targetDuration: z.number().int().min(60).max(7200).optional(),
  contentStyle: z.enum(['dialogue-heavy', 'action-heavy', 'balanced']).optional(),
  visualTone: z.string().max(255).optional(),
  toneNotes: z.string().max(2000).optional(),

  // Auto-generate story after creation
  autoGenerateStory: z.boolean().optional(),
});

export type CreateEpisodeWithContextInput = z.infer<typeof CreateEpisodeWithContextSchema>;
