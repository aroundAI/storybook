import { z } from 'zod';

/**
 * Story Generation Input Schemas
 *
 * Zod schemas for validating input to story generation server actions.
 * These schemas are used by FILM-305 story generation actions.
 */

// ============================================================
// Story Ideation Input Schema
// ============================================================

/**
 * Schema for generating story ideas from a premise
 * Uses the story-ideation prompt template
 */
export const GenerateStoryIdeasSchema = z.object({
  premise: z
    .string()
    .min(10, 'Premise must be at least 10 characters')
    .max(500, 'Premise must be at most 500 characters'),
  genre: z.string().optional(),
  targetAudience: z.string().optional(),
  style: z.string().optional(),
  numberOfIdeas: z.number().int().min(1).max(5).default(3),
});

export type GenerateStoryIdeasInput = z.infer<typeof GenerateStoryIdeasSchema>;

// ============================================================
// Full Story Generation Input Schema
// ============================================================

/**
 * Character input for story generation
 */
export const CharacterInputSchema = z.object({
  name: z.string().min(1, 'Character name is required'),
  description: z.string().min(1, 'Character description is required'),
});

export type CharacterInput = z.infer<typeof CharacterInputSchema>;

/**
 * Schema for generating a full story from a selected idea
 * Uses the story-generation prompt template
 */
export const GenerateFullStorySchema = z.object({
  episodeId: z.string().uuid(),
  version: z.number().int().positive(),
  title: z.string().min(1).max(255),
  logline: z.string().min(10).max(500),
  targetDuration: z.number().int().min(60).max(600), // 1-10 minutes in seconds
  characters: z.array(CharacterInputSchema).optional(),
  worldDetails: z.string().max(1000).optional(),
  style: z.string().optional(),
});

export type GenerateFullStoryInput = z.infer<typeof GenerateFullStorySchema>;

// ============================================================
// Response Types
// ============================================================

/**
 * Metadata for LLM generation operations
 */
export interface GenerationMetadata {
  provider: string;
  model: string;
  costCents: number;
  tokensUsed: number;
  generatedAt: string;
}
