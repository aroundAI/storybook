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
  // SCORE Framework fields (for episode continuity)
  episodeSummary: z.string(),
  sentimentScore: z.number().min(0).max(1),
  keyEvents: z.array(z.string()),
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
 * Expanded for cinematographic lighting descriptions
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

export type TimeOfDay = z.infer<typeof TimeOfDaySchema>;

/**
 * Dialogue line in a scene
 */
export const DialogueLineSchema = z.object({
  character: z.string(),
  text: z.string(),
  parenthetical: z.string().nullish(),
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
 * Expanded for animation-friendly compositions (2.5D, multi-character)
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
]);

export type ShotType = z.infer<typeof ShotTypeSchema>;

/**
 * Camera direction for shot - free-form string to allow LLM creativity
 * Examples: static, pan_left, zoom_in_slow, push_in_slow, dolly_in, etc.
 */
export const CameraDirectionSchema = z.string();

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

// ============================================================
// VEO 3.1 Timestamp-Based Shot Schemas (v2)
// ============================================================

/**
 * Timeline event type within a shot
 */
export const TimelineEventTypeSchema = z.enum([
  'action',
  'dialogue',
  'transition',
  'reaction',
]);

export type TimelineEventType = z.infer<typeof TimelineEventTypeSchema>;

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

export type TimelineEvent = z.infer<typeof TimelineEventSchema>;

/**
 * VEO 3.1 Prompt V2 - Timestamp-based format for Ingredients-to-Video workflow
 * Designed for use with reference images (minimal character descriptions)
 */
export const VeoPromptV2Schema = z.object({
  shotLine: z.string(), // "SHOT: Medium two-shot, tracking (thats where the camera is)"
  timeline: z.array(TimelineEventSchema), // Timestamped events
  audio: z.string(), // "AUDIO: Ambient sounds, SFX"
  style: z.string(), // "STYLE: Cinematic, lighting, mood"
  avoid: z.string(), // "AVOID: subtitles, captions, watermarks"
  fullPrompt: z.string(), // Complete formatted prompt
});

export type VeoPromptV2 = z.infer<typeof VeoPromptV2Schema>;

/**
 * Single shot from scene-shot-generation (v2 format)
 * Mirrors the output definition embedded in scene-shot-generation.json
 */
export const SceneShotSchema = z.object({
  shotNumber: z.number(),
  shotType: z.enum([...ShotTypeSchema.options, 'tracking']),
  cameraDirection: CameraDirectionSchema,
  description: z.string(),
  characters: z.array(z.string()),
  duration: z.number().min(3).max(10),
  hookMoment: z.string().optional(),
  emotionalTone: z.string().optional(),
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
  veoPrompt: VeoPromptV2Schema,
  metadata: z.object({
    location: z.string(),
    timeOfDay: TimeOfDaySchema,
    mood: z.string().optional(),
  }),
});

export type SceneShot = z.infer<typeof SceneShotSchema>;

/**
 * Scene-level reel hook types the LLM may return
 */
export const SceneHookTypeSchema = z.enum([
  'humor',
  'reveal',
  'conflict',
  'visual',
  'cliffhanger',
  'character',
  'action',
  'reaction',
  'punchline',
]);

/**
 * Scene shot generation output (per-scene pipeline)
 */
export const SceneShotGenerationOutputSchema = z.object({
  shots: z.array(SceneShotSchema),
  sceneSummary: z.string(),
  sceneViralScore: z.number().min(1).max(10),
  sceneHookType: SceneHookTypeSchema.nullish(),
  sceneStandaloneSummary: z.string().nullish(),
});

export type SceneShotGenerationOutput = z.infer<
  typeof SceneShotGenerationOutputSchema
>;

// ============================================================
// Season Outline Generation Schemas (FILM-314)
// ============================================================

/**
 * Arc position for episode in season structure
 */
export const ArcPositionSchema = z.enum([
  'setup',
  'rising',
  'midpoint',
  'climax',
  'resolution',
]);

export type ArcPosition = z.infer<typeof ArcPositionSchema>;

/**
 * Single episode outline from season generation
 */
export const EpisodeOutlineSchema = z.object({
  number: z.number().int().positive(),
  title: z.string().min(1).max(255),
  premise: z.string().min(10).max(500),
  mainPlot: z.string().min(20).max(1000),
  characterFocus: z.array(z.string()).optional(),
  arcPosition: ArcPositionSchema,
});

export type EpisodeOutline = z.infer<typeof EpisodeOutlineSchema>;

/**
 * Season outline generation prompt output
 */
export const SeasonOutlineOutputSchema = z.object({
  episodes: z.array(EpisodeOutlineSchema),
});

export type SeasonOutlineOutput = z.infer<typeof SeasonOutlineOutputSchema>;
