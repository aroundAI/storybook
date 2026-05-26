import { z } from 'zod';

import { UUIDSchema } from './common';

// Project Type
export const ProjectTypeSchema = z.enum([
  'short-film',
  'series',
  'movie',
  'documentary',
  'ad',
  'educational',
  'news',
]);

// Target Platforms
export const TargetPlatformSchema = z.enum([
  'youtube',
  'tiktok',
  'instagram',
  'facebook',
  'twitter',
  'linkedin',
  'custom',
]);

// Video Style
export const VideoStyleSchema = z.enum([
  'realistic',
  'animated',
  'cartoon',
  'anime',
  'cinematic',
  'documentary',
  'vlog',
  'commercial',
]);

// Genre
export const GenreSchema = z.enum([
  'drama',
  'comedy',
  'action',
  'kids',
  'educational',
  'documentary',
  'horror',
  'sci-fi',
  'fantasy',
  'romance',
  'thriller',
  'general',
]);

// Content Style (affects dialogue density)
export const ContentStyleSchema = z.enum([
  'dialogue-heavy',
  'action-heavy',
  'balanced',
]);

// Studio Project Settings
export const StudioProjectSettingsSchema = z.object({
  projectType: ProjectTypeSchema,
  targetPlatforms: z.array(TargetPlatformSchema).min(1),
  videoStyle: VideoStyleSchema,
  defaultAspectRatio: z
    .string()
    .regex(/^\d+:\d+$/)
    .default('16:9'),
  // Default shot duration in seconds (3-10 seconds per AI video clip)
  defaultDuration: z.number().positive().default(5),
  // Default episode duration in seconds (60-7200, i.e., 1 min to 2 hours)
  defaultEpisodeDuration: z.number().int().min(60).max(7200).default(300),
  defaultProvider: z.enum(['kling', 'runway', 'luma']).default('kling'),
  audioProvider: z.enum(['elevenlabs', 'suno']).optional(),
  // Genre for story/screenplay generation
  genre: GenreSchema.optional(),
  // Content style affects dialogue density
  contentStyle: ContentStyleSchema.default('dialogue-heavy'),
  targetAudience: z.string().optional(),
  contentRating: z.enum(['G', 'PG', 'PG-13', 'R', 'NR']).optional(),
  language: z.string().default('en'),
  subtitlesEnabled: z.boolean().default(false),
  // Recurring story element (appears in every episode)
  // Examples: moral message for kids shows, signature scene location (deli, coffee shop)
  recurringElement: z
    .object({
      enabled: z.boolean().default(false),
      // What/where is the recurring scene
      location: z.string().max(500).optional(), // e.g., "Murray's Deli - corner booth"
      // Purpose/function of the scene
      purpose: z.string().max(1500).optional(), // e.g., "Characters debrief and gain new perspective"
      // Placement in episode
      placement: z
        .enum(['beginning', 'middle', 'end', 'throughout'])
        .default('end'),
      // Specific dialogue patterns or phrases
      dialogueHints: z.string().max(1500).optional(), // e.g., "Use phrases like 'You know what I learned...'"
    })
    .optional(),
  // Cover image for project cards in studio view
  coverImageUrl: z.string().url().optional(),
});

export type StudioProjectSettings = z.infer<typeof StudioProjectSettingsSchema>;

// Project CRUD
export const CreateProjectSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().optional(),
  settings: StudioProjectSettingsSchema.optional(),
});

export const UpdateProjectSchema = CreateProjectSchema.partial().extend({
  id: UUIDSchema,
});

// Type exports
export type ProjectType = z.infer<typeof ProjectTypeSchema>;
export type TargetPlatform = z.infer<typeof TargetPlatformSchema>;
export type VideoStyle = z.infer<typeof VideoStyleSchema>;
export type Genre = z.infer<typeof GenreSchema>;
export type ContentStyle = z.infer<typeof ContentStyleSchema>;
export type CreateProject = z.infer<typeof CreateProjectSchema>;
export type UpdateProject = z.infer<typeof UpdateProjectSchema>;
