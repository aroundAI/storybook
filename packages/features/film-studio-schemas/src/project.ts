import { z } from 'zod';

import { UUIDSchema } from './common';

// Project Type
export const ProjectTypeSchema = z.enum([
  'short-film',
  'series',
  'documentary',
  'ad',
  'educational',
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

// Studio Project Settings
export const StudioProjectSettingsSchema = z.object({
  projectType: ProjectTypeSchema,
  targetPlatforms: z.array(TargetPlatformSchema).min(1),
  videoStyle: VideoStyleSchema,
  defaultAspectRatio: z
    .string()
    .regex(/^\d+:\d+$/)
    .default('16:9'),
  defaultDuration: z.number().positive().default(5),
  defaultProvider: z.enum(['kling', 'runway', 'luma']).default('kling'),
  audioProvider: z.enum(['elevenlabs', 'suno']).optional(),
  targetAudience: z.string().optional(),
  contentRating: z.enum(['G', 'PG', 'PG-13', 'R', 'NR']).optional(),
  language: z.string().default('en'),
  subtitlesEnabled: z.boolean().default(false),
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
export type CreateProject = z.infer<typeof CreateProjectSchema>;
export type UpdateProject = z.infer<typeof UpdateProjectSchema>;
