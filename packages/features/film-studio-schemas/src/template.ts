import { z } from 'zod';

import { UUIDSchema } from './common';
import { StudioProjectSettingsSchema } from './project';

// Template Category
export const TemplateCategorySchema = z.enum([
  'series',
  'film',
  'shorts',
  'documentary',
  'educational',
]);

// Character Role
export const CharacterRoleSchema = z.enum([
  'protagonist',
  'antagonist',
  'supporting',
  'minor',
]);

// Sample Character for template
export const SampleCharacterSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().optional(),
  physicalAttributes: z
    .object({
      age: z.string().optional(),
      gender: z.string().optional(),
      height: z.string().optional(),
      build: z.string().optional(),
      hairColor: z.string().optional(),
      eyeColor: z.string().optional(),
      distinctiveFeatures: z.string().optional(),
    })
    .optional(),
  personality: z.string().optional(),
  role: CharacterRoleSchema.optional(),
});

// Time of Day
export const TimeOfDaySchema = z.enum([
  'dawn',
  'morning',
  'afternoon',
  'evening',
  'night',
  'any',
]);

// Weather
export const WeatherSchema = z.enum([
  'sunny',
  'cloudy',
  'rainy',
  'snowy',
  'stormy',
  'foggy',
  'any',
]);

// Sample Location for template
export const SampleLocationSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().optional(),
  visualStyle: z.string().optional(),
  timeOfDay: TimeOfDaySchema.optional(),
  weather: WeatherSchema.optional(),
});

// Plot Point for story structure
export const PlotPointSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  position: z.number().min(0).max(100).optional(), // Percentage through story
});

// Story Structure for template
export const StoryStructureSchema = z.object({
  acts: z.number().int().min(1).max(5).optional(),
  episodeCount: z.number().int().min(1).optional(),
  episodeDuration: z.number().positive().optional(),
  plotPoints: z.array(PlotPointSchema).optional(),
});

// Style Guide for template
export const StyleGuideSchema = z.object({
  tone: z.string().optional(),
  colorPalette: z.array(z.string()).optional(),
  visualReferences: z.array(z.string().url()).optional(),
  audioStyle: z.string().optional(),
});

// Sample Episode for template
export const SampleEpisodeSchema = z.object({
  title: z.string().min(1).max(255),
  description: z.string().optional(),
  premiseTemplate: z.string().optional(),
});

// Full Template Data (stored as JSONB)
export const TemplateDataSchema = z.object({
  projectSettings: StudioProjectSettingsSchema,
  sampleCharacters: z.array(SampleCharacterSchema).optional(),
  sampleLocations: z.array(SampleLocationSchema).optional(),
  storyStructure: StoryStructureSchema.optional(),
  styleGuide: StyleGuideSchema.optional(),
  sampleEpisodes: z.array(SampleEpisodeSchema).optional(),
});

// Base Template Schema
export const BaseTemplateSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().max(2000).optional(),
  thumbnailUrl: z.string().url().optional().nullable(),
  category: TemplateCategorySchema,
  genre: z.string().max(50).optional().nullable(),
  targetDurationMinutes: z.number().int().positive().optional().nullable(),
});

// Create Template Schema (for custom templates)
export const CreateTemplateSchema = BaseTemplateSchema.extend({
  accountId: UUIDSchema,
  isPublic: z.boolean().default(false),
  templateData: TemplateDataSchema,
});

// Update Template Schema
export const UpdateTemplateSchema = BaseTemplateSchema.partial().extend({
  id: UUIDSchema,
  isPublic: z.boolean().optional(),
  templateData: TemplateDataSchema.optional(),
});

// Get Templates Schema (with filtering)
export const GetTemplatesSchema = z.object({
  accountId: UUIDSchema.optional(),
  category: TemplateCategorySchema.optional(),
  includeSystem: z.boolean().default(true),
  includeCustom: z.boolean().default(true),
  limit: z.number().int().min(1).max(100).default(50),
  offset: z.number().int().min(0).default(0),
});

// Get Single Template Schema
export const GetTemplateSchema = z.object({
  templateId: UUIDSchema,
});

// Delete Template Schema
export const DeleteTemplateSchema = z.object({
  templateId: UUIDSchema,
});

// Create Project From Template Schema
export const CreateProjectFromTemplateSchema = z.object({
  templateId: UUIDSchema,
  accountSlug: z.string().min(1),
  projectName: z.string().min(1).max(255),
  projectDescription: z.string().max(1000).optional(),
});

// Save Project As Template Schema
export const SaveProjectAsTemplateSchema = z.object({
  projectId: UUIDSchema,
  accountId: UUIDSchema,
  templateName: z.string().min(1).max(255),
  templateDescription: z.string().max(2000).optional(),
  category: TemplateCategorySchema,
  genre: z.string().max(50).optional(),
  isPublic: z.boolean().default(false),
  includeCharacters: z.boolean().default(true),
  includeLocations: z.boolean().default(true),
});

// Type exports
export type TemplateCategory = z.infer<typeof TemplateCategorySchema>;
export type CharacterRole = z.infer<typeof CharacterRoleSchema>;
export type SampleCharacter = z.infer<typeof SampleCharacterSchema>;
export type TimeOfDay = z.infer<typeof TimeOfDaySchema>;
export type Weather = z.infer<typeof WeatherSchema>;
export type SampleLocation = z.infer<typeof SampleLocationSchema>;
export type PlotPoint = z.infer<typeof PlotPointSchema>;
export type StoryStructure = z.infer<typeof StoryStructureSchema>;
export type StyleGuide = z.infer<typeof StyleGuideSchema>;
export type SampleEpisode = z.infer<typeof SampleEpisodeSchema>;
export type TemplateData = z.infer<typeof TemplateDataSchema>;
export type BaseTemplate = z.infer<typeof BaseTemplateSchema>;
export type CreateTemplateInput = z.infer<typeof CreateTemplateSchema>;
export type UpdateTemplateInput = z.infer<typeof UpdateTemplateSchema>;
export type GetTemplatesInput = z.infer<typeof GetTemplatesSchema>;
export type GetTemplateInput = z.infer<typeof GetTemplateSchema>;
export type DeleteTemplateInput = z.infer<typeof DeleteTemplateSchema>;
export type CreateProjectFromTemplateInput = z.infer<
  typeof CreateProjectFromTemplateSchema
>;
export type SaveProjectAsTemplateInput = z.infer<
  typeof SaveProjectAsTemplateSchema
>;
