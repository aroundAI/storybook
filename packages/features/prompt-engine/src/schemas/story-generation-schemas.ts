import { z } from 'zod';

/**
 * Story Generation Output Schemas
 *
 * Zod schemas for validating LLM outputs from story generation prompts.
 * These match the output schemas defined in the JSON template files.
 */

// ============================================================
// Story Ideation Schemas
// ============================================================

/**
 * Single story idea from ideation prompt
 */
export const StoryIdeaSchema = z.object({
  title: z.string(),
  logline: z.string(),
  themes: z.array(z.string()),
  hook: z.string(),
  visualPotential: z.string(),
});

export type StoryIdea = z.infer<typeof StoryIdeaSchema>;

/**
 * Story ideation prompt output
 */
export const StoryIdeationOutputSchema = z.object({
  ideas: z.array(StoryIdeaSchema),
});

export type StoryIdeationOutput = z.infer<typeof StoryIdeationOutputSchema>;

// ============================================================
// Story Generation Schemas
// ============================================================

/**
 * Character role in the story
 */
export const CharacterRoleSchema = z.enum([
  'protagonist',
  'antagonist',
  'supporting',
]);

export type CharacterRole = z.infer<typeof CharacterRoleSchema>;

/**
 * Character arc description
 */
export const CharacterArcSchema = z.object({
  name: z.string(),
  role: CharacterRoleSchema,
  arc: z.string(),
});

export type CharacterArc = z.infer<typeof CharacterArcSchema>;

/**
 * Three-act story structure breakdown
 */
export const ActBreakdownSchema = z.object({
  act1: z.string(),
  act2: z.string(),
  act3: z.string(),
});

export type ActBreakdown = z.infer<typeof ActBreakdownSchema>;

/**
 * Complete story structure
 */
export const StorySchema = z.object({
  title: z.string(),
  fullText: z.string(),
  actBreakdown: ActBreakdownSchema,
  characters: z.array(CharacterArcSchema),
  themes: z.array(z.string()),
  tone: z.string(),
  estimatedSceneCount: z.number(),
});

export type Story = z.infer<typeof StorySchema>;

/**
 * Story generation prompt output
 */
export const StoryGenerationOutputSchema = z.object({
  story: StorySchema,
});

export type StoryGenerationOutput = z.infer<typeof StoryGenerationOutputSchema>;

// ============================================================
// Screenplay Conversion Schemas
// ============================================================

/**
 * Time of day for scene
 */
export const TimeOfDaySchema = z.enum(['day', 'night', 'dawn', 'dusk']);

export type TimeOfDay = z.infer<typeof TimeOfDaySchema>;

/**
 * Dialogue line in a scene
 */
export const DialogueLineSchema = z.object({
  character: z.string(),
  text: z.string(),
  parenthetical: z.string().optional(),
});

export type DialogueLine = z.infer<typeof DialogueLineSchema>;

/**
 * Single scene in the screenplay
 */
export const SceneSchema = z.object({
  number: z.number(),
  heading: z.string(),
  location: z.string(),
  timeOfDay: TimeOfDaySchema,
  description: z.string(),
  dialogue: z.array(DialogueLineSchema),
  estimatedDuration: z.number(),
});

export type Scene = z.infer<typeof SceneSchema>;

/**
 * Screenplay metadata
 */
export const ScreenplayMetadataSchema = z.object({
  totalScenes: z.number(),
  estimatedDuration: z.number(),
  locations: z.array(z.string()),
  characters: z.array(z.string()),
});

export type ScreenplayMetadata = z.infer<typeof ScreenplayMetadataSchema>;

/**
 * Complete screenplay structure
 */
export const ScreenplaySchema = z.object({
  scenes: z.array(SceneSchema),
  metadata: ScreenplayMetadataSchema,
});

export type Screenplay = z.infer<typeof ScreenplaySchema>;

/**
 * Screenplay conversion prompt output
 */
export const ScreenplayConversionOutputSchema = z.object({
  screenplay: ScreenplaySchema,
});

export type ScreenplayConversionOutput = z.infer<
  typeof ScreenplayConversionOutputSchema
>;

// ============================================================
// Shot List Generation Schemas
// ============================================================

/**
 * Shot type for cinematography
 */
export const ShotTypeSchema = z.enum([
  'wide',
  'medium',
  'close-up',
  'extreme-close-up',
  'over-shoulder',
  'pov',
]);

export type ShotType = z.infer<typeof ShotTypeSchema>;

/**
 * Camera direction for shot
 */
export const CameraDirectionSchema = z.enum([
  'static',
  'pan_left',
  'pan_right',
  'tilt_up',
  'tilt_down',
  'zoom_in',
  'zoom_out',
  'dolly_in',
  'dolly_out',
]);

export type CameraDirection = z.infer<typeof CameraDirectionSchema>;

/**
 * Shot metadata
 */
export const ShotMetadataSchema = z.object({
  location: z.string(),
  timeOfDay: TimeOfDaySchema,
  mood: z.string().optional(),
  lighting: z.string().optional(),
});

export type ShotMetadata = z.infer<typeof ShotMetadataSchema>;

/**
 * Single shot in the shot list
 */
export const ShotSchema = z.object({
  sequenceNumber: z.number(),
  sceneNumber: z.number(),
  shotNumber: z.number(),
  shotType: ShotTypeSchema,
  cameraDirection: CameraDirectionSchema,
  description: z.string(),
  action: z.string(),
  prompt: z.string(),
  characters: z.array(z.string()),
  duration: z.number().min(3).max(10),
  metadata: ShotMetadataSchema,
});

export type Shot = z.infer<typeof ShotSchema>;

/**
 * Shot type distribution in the shot list
 */
export const ShotTypeDistributionSchema = z.object({
  wide: z.number(),
  medium: z.number(),
  closeUp: z.number(),
});

export type ShotTypeDistribution = z.infer<typeof ShotTypeDistributionSchema>;

/**
 * Shot list metadata
 */
export const ShotListMetadataSchema = z.object({
  totalShots: z.number(),
  totalDuration: z.number(),
  shotTypes: ShotTypeDistributionSchema,
  locations: z.array(z.string()),
  characters: z.array(z.string()),
});

export type ShotListMetadata = z.infer<typeof ShotListMetadataSchema>;

/**
 * Complete shot list structure
 */
export const ShotListSchema = z.object({
  shots: z.array(ShotSchema),
  metadata: ShotListMetadataSchema,
});

export type ShotList = z.infer<typeof ShotListSchema>;

/**
 * Shot list generation prompt output
 */
export const ShotListGenerationOutputSchema = z.object({
  shotList: ShotListSchema,
});

export type ShotListGenerationOutput = z.infer<
  typeof ShotListGenerationOutputSchema
>;
