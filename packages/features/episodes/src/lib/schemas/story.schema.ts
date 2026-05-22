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
 * Input for generating multiple story ideas from a premise
 */
export const GenerateStoryIdeasSchema = z.object({
  episodeId: z.string().uuid(), // Required for context building
  premise: z.string().min(10).max(500),
  numberOfIdeas: z.number().int().min(1).max(5).default(3),
  // genre, style, targetAudience now fetched from episode context via context builder
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
 * Content style affects dialogue density and pacing
 */
export const ContentStyleSchema = z.enum([
  'dialogue-heavy',
  'action-heavy',
  'balanced',
]);

export type ContentStyle = z.infer<typeof ContentStyleSchema>;

/**
 * Schema for generating a full story from a selected idea
 * Uses the story-generation prompt template
 */
export const GenerateFullStorySchema = z.object({
  episodeId: z.string().uuid(),
  version: z.number().int().positive(),
  title: z.string().min(1).max(255),
  logline: z.string().min(10).max(500),
  targetDuration: z.number().int().min(60).max(7200), // 1 min to 2 hours in seconds
  contentStyle: ContentStyleSchema.optional(), // Affects dialogue density
  characters: z.array(CharacterInputSchema).optional(),
  worldDetails: z.string().max(1000).optional(),
  style: z.string().optional(),
  threadCandidates: z
    .array(
      z.object({
        threadId: z.string().uuid(),
        threadName: z.string(),
        action: z.enum(['progress', 'resolve']),
      }),
    )
    .optional(),
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
