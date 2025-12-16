import { z } from 'zod';

export const AnalyzeSeasonSchema = z.object({
  projectId: z.string().uuid(),
  roadmap: z.string().min(50, 'Roadmap must be at least 50 characters long'),
});

export const GenerateSeasonEpisodesSchema = z.object({
  projectId: z.string().uuid(),
  // Season name for the new season
  seasonName: z.string().optional(),
  // Refined premise from step 2
  premise: z.string().optional(),
  // Validated list of characters to create
  charactersToCreate: z.array(
    z.object({
      name: z.string(),
      description: z.string().optional(),
      role: z.string().optional(),
    }),
  ),
  // Validated list of locations to create
  locationsToCreate: z.array(
    z.object({
      name: z.string(),
      description: z.string().optional(),
      setting: z.string().optional(),
    }),
  ),
  // Mapping of extracted character names to existing asset IDs (from dropdowns)
  // e.g. { "Dante": "uuid-123", "Virgil": "uuid-456" }
  characterMappings: z.record(z.string(), z.string().uuid()),
  // Mapping of extracted location names to existing asset IDs
  locationMappings: z.record(z.string(), z.string().uuid()),
  // Validated list of episodes with character references
  episodes: z.array(
    z.object({
      number: z.number(),
      title: z.string(),
      description: z.string(),
      characterNames: z.array(z.string()).optional(),
      locationNames: z.array(z.string()).optional(),
    }),
  ),
});
