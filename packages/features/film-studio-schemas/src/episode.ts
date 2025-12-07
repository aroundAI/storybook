import { z } from 'zod';

import { UUIDSchema } from './common';

// Episode Status
export const EpisodeStatusSchema = z.enum([
  'draft',
  'planning',
  'scripting',
  'in_progress',
  'reviewing',
  'completed',
  'published',
  'archived',
]);

// Episode Metadata
export const EpisodeMetadataSchema = z.object({
  sceneCount: z.number().int().nonnegative().optional(),
  shotCount: z.number().int().nonnegative().optional(),
  totalDuration: z.number().nonnegative().optional(),
  themes: z.array(z.string()).optional(),
  tags: z.array(z.string()).optional(),
  characters: z.array(UUIDSchema).optional(),
  locations: z.array(UUIDSchema).optional(),
  estimatedCost: z.number().nonnegative().optional(),
  targetAudience: z.string().optional(),
});

// Create Episode
export const CreateEpisodeSchema = z.object({
  projectId: UUIDSchema,
  title: z.string().min(1).max(255),
  description: z.string().optional(),
  episodeNumber: z.number().int().positive(),
  seasonNumber: z.number().int().positive().optional(),
  script: z.string().optional(),
  duration: z.number().positive().optional(),
  metadata: EpisodeMetadataSchema.optional(),
});

// Update Episode
export const UpdateEpisodeSchema = CreateEpisodeSchema.partial().extend({
  id: UUIDSchema,
  status: EpisodeStatusSchema.optional(),
});

// Generate Episode from Prompt
export const GenerateEpisodeFromPromptSchema = z.object({
  projectId: UUIDSchema,
  prompt: z.string().min(10).max(5000),
  episodeNumber: z.number().int().positive(),
  targetDuration: z.number().positive().optional(),
  style: z.string().optional(),
  tone: z.string().optional(),
  includeDialogue: z.boolean().default(true),
});

// Scene Schema
export const SceneSchema = z.object({
  sceneNumber: z.number().int().positive(),
  title: z.string().optional(),
  description: z.string(),
  location: z.string().optional(),
  timeOfDay: z.string().optional(),
  characters: z.array(z.string()).optional(),
  duration: z.number().positive().optional(),
  shots: z.array(z.unknown()).optional(), // Will be ShotSchema from shot.ts
});

// Type exports
export type EpisodeStatus = z.infer<typeof EpisodeStatusSchema>;
export type EpisodeMetadata = z.infer<typeof EpisodeMetadataSchema>;
export type CreateEpisode = z.infer<typeof CreateEpisodeSchema>;
export type UpdateEpisode = z.infer<typeof UpdateEpisodeSchema>;
export type GenerateEpisodeFromPrompt = z.infer<
  typeof GenerateEpisodeFromPromptSchema
>;
export type Scene = z.infer<typeof SceneSchema>;
