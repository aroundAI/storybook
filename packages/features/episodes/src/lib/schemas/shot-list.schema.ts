import { z } from 'zod';

// ============================================================================
// Boundary Validation Schemas (for parsing raw DB JSONB fields)
// ============================================================================

/**
 * Schema for parsing primary_subject JSONB column from the database.
 * Use with `.nullish().parse()` at data boundaries instead of `as` casting.
 */
export const PrimarySubjectSchema = z.object({
  type: z.enum(['character', 'location', 'object']),
  name: z.string(),
});

/**
 * Schema for parsing generation_metadata JSONB column from the database.
 * Permissive `.passthrough()` to allow extra fields from different LLM providers.
 */
export const ShotMetadataSchema = z
  .object({
    characters: z.array(z.string()).optional(),
    locations: z.array(z.string()).optional(),
    location: z.string().optional(),
    timeOfDay: z.string().optional(),
    mood: z.string().optional(),
    shotType: z.string().optional(),
    veoPrompt: z
      .object({
        fullPrompt: z.string().optional(),
        shotLine: z.string().optional(),
        timeline: z
          .array(
            z.object({
              character: z.string().nullish(),
              type: z.string().optional(),
            }),
          )
          .optional(),
      })
      .optional(),
    referenceImages: z
      .object({
        characters: z
          .array(z.object({ name: z.string(), url: z.string() }))
          .optional(),
        locations: z
          .array(z.object({ name: z.string(), url: z.string() }))
          .optional(),
      })
      .optional(),
  })
  .passthrough();

/**
 * Schema for generating a shot list from screenplay/story
 */
export const GenerateShotListSchema = z.object({
  episodeId: z.string().uuid(),
  shotDurationMin: z.number().min(3).max(10).default(5),
  shotDurationMax: z.number().min(3).max(10).default(8),
  videoProvider: z
    .enum(['veo-3.1', 'kling', 'runway', 'luma'])
    .default('veo-3.1'),
  provider: z.enum(['anthropic', 'openai', 'google']).optional(),
  model: z.string().optional(),
});

/**
 * Shot type enum matching prompt template output
 * Expanded to support animation styles (2.5D, Disney/Pixar aesthetic)
 */
export const ShotTypeSchema = z.enum([
  // Shot sizes (standard progression)
  'extreme-wide',
  'wide',
  'medium-wide',
  'medium',
  'medium-close-up',
  'close-up',
  'extreme-close-up',

  // Multi-character compositions (animation-friendly)
  'two-shot',
  'three-shot',
  'group-shot',
  'over-shoulder',

  // Character framing (2D/2.5D animation)
  'full-body',
  'profile',
  'three-quarter',

  // Dramatic angles
  'low-angle',
  'high-angle',
  'dutch-angle',
  'bird-eye',

  // Special purpose
  'pov',
  'insert',
  'establishing',
  'reaction',
  'silhouette',
  'tracking',
]);

/**
 * Camera direction - free-form string to allow LLM creativity
 * Examples: static, pan_left, zoom_in_slow, push_in_slow, dolly_in, etc.
 */
export const PromptCameraDirectionSchema = z.string();

/**
 * Time of day enum - expanded for cinematographic lighting descriptions
 */
export const TimeOfDaySchema = z.enum([
  'dawn',
  'morning',
  'midday',
  'afternoon',
  'golden-hour',
  'dusk',
  'night',
  'day', // Generic fallback
]);

/**
 * Timeline event type within a shot
 */
export const TimelineEventTypeSchema = z.enum([
  'action',
  'dialogue',
  'transition',
  'reaction',
]);

/**
 * Single timeline event within a shot (timestamp-based)
 */
export const TimelineEventSchema = z.object({
  startTime: z.string(), // "00:00" format
  endTime: z.string(), // "03:00" format
  type: TimelineEventTypeSchema,
  character: z.string().nullish(), // Can be undefined, null, or empty (for ambient/sfx)
  content: z.string(),
  emotion: z.string().nullable().optional(),
});

/**
 * VEO 3.1 Structured Prompt Components (V2 - Timeline-based)
 * Designed for Ingredients-to-Video workflow with reference images
 */
export const VeoPromptSchema = z.object({
  // Shot line: Camera setup and positioning
  shotLine: z.string().describe('Camera shot type and positioning'),
  // Timeline: Timestamped action/dialogue/transition events
  timeline: z
    .array(TimelineEventSchema)
    .describe('Timestamped events in the shot'),
  // Audio: Ambient sounds, SFX
  audio: z.string().describe('Ambient sounds, SFX description'),
  // Style: Visual aesthetic, lighting, mood
  style: z.string().describe('Visual aesthetic, lighting, mood'),
  // Avoid: Elements to exclude
  avoid: z
    .string()
    .describe('Elements to exclude: subtitles, watermarks, etc.'),
  // Combined prompt ready for VEO 3.1
  fullPrompt: z.string().describe('Complete formatted prompt for copy/paste'),
});

/**
 * Reference image for a character or location
 */
export const ReferenceImageSchema = z.object({
  name: z.string(),
  url: z.string().url(),
  type: z.enum(['character', 'location']),
});

/**
 * Reference images grouped by type
 */
export const ShotReferenceImagesSchema = z.object({
  characters: z.array(ReferenceImageSchema.omit({ type: true })),
  locations: z.array(ReferenceImageSchema.omit({ type: true })),
});

/**
 * Dialogue timing for a shot (from pre-calculated timeline)
 */
export const ShotDialogueTimingSchema = z.object({
  startSeconds: z.number(),
  durationSeconds: z.number(),
  characterName: z.string(),
  text: z.string(),
  emotion: z.string().nullable(),
});

/**
 * Shot metadata from LLM
 */
export const GeneratedShotMetadataSchema = z.object({
  location: z.string(),
  timeOfDay: TimeOfDaySchema,
  mood: z.string().optional(),
  lighting: z.string().optional(),
});

/**
 * Individual generated shot from LLM
 * Enhanced with VEO 3.1 structured prompt components
 */
export const GeneratedShotSchema = z.object({
  sequenceNumber: z.number(),
  sceneNumber: z.number(),
  shotNumber: z.number(),
  shotType: ShotTypeSchema,
  cameraDirection: PromptCameraDirectionSchema,
  description: z.string(),
  action: z.string(),
  prompt: z.string(), // Legacy simple prompt (kept for backward compatibility)
  characters: z.array(z.string()),
  duration: z.number().min(3).max(10),
  metadata: GeneratedShotMetadataSchema,
  // VEO 3.1 Enhanced Fields
  veoPrompt: VeoPromptSchema.optional(), // Structured 7-component prompt
  referenceImages: ShotReferenceImagesSchema.optional(), // Character/location images
  dialogueTiming: z.array(ShotDialogueTimingSchema).optional(), // Dialogue in this shot
  missingAssets: z
    .object({
      characters: z.array(z.string()), // Characters without images
      locations: z.array(z.string()), // Locations without images
    })
    .optional(), // For warning display
});

/**
 * Shot list metadata summary
 */
export const ShotListMetadataSchema = z.object({
  totalShots: z.number(),
  totalDuration: z.number(),
  shotTypes: z.object({
    wide: z.number(),
    medium: z.number(),
    closeUp: z.number(),
  }),
  locations: z.array(z.string()),
  characters: z.array(z.string()),
});

/**
 * Complete shot list output from LLM
 */
export const ShotListOutputSchema = z.object({
  shots: z.array(GeneratedShotSchema),
  metadata: ShotListMetadataSchema,
});

/**
 * Full LLM response structure
 */
export const ShotListGenerationOutputSchema = z.object({
  shotList: ShotListOutputSchema,
});

// Type exports
export type GenerateShotListInput = z.infer<typeof GenerateShotListSchema>;
export type ShotType = z.infer<typeof ShotTypeSchema>;
export type PromptCameraDirection = z.infer<typeof PromptCameraDirectionSchema>;
export type TimeOfDay = z.infer<typeof TimeOfDaySchema>;
export type GeneratedShotMetadata = z.infer<typeof GeneratedShotMetadataSchema>;
export type GeneratedShot = z.infer<typeof GeneratedShotSchema>;
export type ShotListMetadata = z.infer<typeof ShotListMetadataSchema>;
export type ShotListOutput = z.infer<typeof ShotListOutputSchema>;
export type ShotListGenerationOutput = z.infer<
  typeof ShotListGenerationOutputSchema
>;

// VEO 3.1 Enhanced Type Exports
export type TimelineEventType = z.infer<typeof TimelineEventTypeSchema>;
export type TimelineEvent = z.infer<typeof TimelineEventSchema>;
export type VeoPrompt = z.infer<typeof VeoPromptSchema>;
export type ReferenceImage = z.infer<typeof ReferenceImageSchema>;
export type ShotReferenceImages = z.infer<typeof ShotReferenceImagesSchema>;
export type ShotDialogueTiming = z.infer<typeof ShotDialogueTimingSchema>;

// =============================================================================
// Scene-by-Scene Shot List Generation Types
// =============================================================================

/**
 * Result from generating shots for a single scene
 * Used by the scene-by-scene pipeline
 */
export const SceneGenerationResultSchema = z.object({
  sceneNumber: z.number(),
  shots: z.array(GeneratedShotSchema.omit({ sequenceNumber: true })),
  sceneSummary: z
    .string()
    .describe('1-sentence summary for next scene context'),
});

export type SceneGenerationResult = z.infer<typeof SceneGenerationResultSchema>;

/**
 * Single scene shot output from LLM
 * Matches scene-shot-generation.json template output
 */
export const SceneShotOutputSchema = z.object({
  shotNumber: z.number(),
  shotType: ShotTypeSchema,
  cameraDirection: PromptCameraDirectionSchema,
  description: z.string(),
  characters: z.array(z.string()),
  duration: z.number().min(3).max(10),
  metadata: GeneratedShotMetadataSchema,
  veoPrompt: VeoPromptSchema,
  // Shorts candidate fields
  shortsCandidate: z.boolean().optional().default(false),
  shortsMetadata: z
    .object({
      viralScore: z.number().min(1).max(10),
      hookType: z
        .enum([
          'question',
          'reveal',
          'conflict',
          'visual',
          'humor',
          'cliffhanger',
          'character',
          'action',
          'reaction',
        ])
        .nullish(),
      standaloneSummary: z.string().nullish(),
    })
    .nullish(),
  // OpenClaw Shot Intelligence fields
  transitionType: z
    .enum(['continuation', 'cut', 'match_cut', 'j_cut', 'l_cut'])
    .optional()
    .default('cut'),
  frameStrategy: z
    .enum([
      'character_focus',
      'environment_focus',
      'two_shot',
      'group',
      'detail_insert',
    ])
    .optional()
    .default('environment_focus'),
  primarySubject: z
    .object({
      type: z.enum(['character', 'location', 'object']),
      name: z.string(),
    })
    .optional(),
  firstFrameDescription: z.string().nullish(),
  lastFrameDescription: z.string().nullish(),
  locationArea: z.string().nullish(),
  locationEnvironmentDescription: z.string().nullish(),
});

export type SceneShotOutput = z.infer<typeof SceneShotOutputSchema>;

/**
 * Full output from scene-shot-generation.json template
 */
export const SceneShotGenerationOutputSchema = z.object({
  shots: z.array(SceneShotOutputSchema),
  sceneSummary: z.string(),
});

export type SceneShotGenerationOutput = z.infer<
  typeof SceneShotGenerationOutputSchema
>;

/**
 * Response from generateShotListAction
 */
export interface GenerateShotListResponse {
  success: boolean;
  shots: GeneratedShot[];
  shotsCreated: number;
  metadata: {
    totalShots: number;
    totalDuration: number;
    shotTypes: { wide: number; medium: number; closeUp: number };
    locations: string[];
    characters: string[];
    processingMethod?: 'parallel-batches' | 'scene-by-scene' | 'monolithic';
  };
}

/**
 * Data for batch creating shots in the database
 */
export interface BatchShotDefinition {
  sceneNumber: number;
  shotNumber: number;
  description: string;
  prompt: string;
  durationSeconds: number;
  cameraDirection: string;
  characters: string[];
  metadata: Record<string, unknown>;
}
