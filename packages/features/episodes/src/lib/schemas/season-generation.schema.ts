import { z } from 'zod';

export const AnalyzeSeasonSchema = z.object({
  projectId: z.string().uuid(),
  roadmap: z.string().min(50, 'Roadmap must be at least 50 characters long'),
});

/**
 * A single beat/section extracted from the episode roadmap
 * Preserves the original label from the source document
 */
export const EpisodeBeatSchema = z.object({
  label: z.string(), // Original label: "The Mystery", "Act 1", "Cold Open", etc.
  content: z.string(), // The content for that beat
});

/**
 * Flexible episode data extracted from roadmap
 * Works with any episode structure (mystery, anime, drama, sitcom, etc.)
 */
export const ExtractedEpisodeSchema = z.object({
  number: z.number(),
  title: z.string(),

  // Always synthesized - one-paragraph summary
  synopsis: z.string(),

  // Flexible: Array of labeled beats preserving original roadmap structure
  beats: z.array(EpisodeBeatSchema),

  // Optional structured elements if explicitly present
  moral: z.string().nullish(),
  signature_line: z.string().nullish(),

  // References (support both naming conventions)
  character_names: z.array(z.string()).optional(),
  location_names: z.array(z.string()).optional(),
  characterNames: z.array(z.string()).optional(),
  locationNames: z.array(z.string()).optional(),

  // Free-form tags
  tags: z.array(z.string()).optional(),

  // Legacy support: description field from older roadmaps
  description: z.string().optional(),
});

export const GenerateSeasonEpisodesSchema = z.object({
  projectId: z.string().uuid(),

  // Season metadata
  seasonName: z.string().optional(),
  premise: z.string().optional(),
  tone: z.string().optional(),
  targetAudience: z.string().optional(),

  // Characters to create
  charactersToCreate: z.array(
    z.object({
      name: z.string(),
      description: z.string().optional(),
      role: z.string().optional(),
    }),
  ),

  // Locations to create
  locationsToCreate: z.array(
    z.object({
      name: z.string(),
      description: z.string().optional(),
      setting: z.string().optional(),
    }),
  ),

  // Mappings to existing assets
  characterMappings: z.record(z.string(), z.string().uuid()),
  locationMappings: z.record(z.string(), z.string().uuid()),

  // Episodes with flexible structure
  episodes: z.array(ExtractedEpisodeSchema),
});

// Type exports
export type EpisodeBeat = z.infer<typeof EpisodeBeatSchema>;
export type ExtractedEpisode = z.infer<typeof ExtractedEpisodeSchema>;
export type GenerateSeasonEpisodesInput = z.infer<
  typeof GenerateSeasonEpisodesSchema
>;
