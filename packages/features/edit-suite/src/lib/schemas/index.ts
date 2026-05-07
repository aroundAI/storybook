import { z } from 'zod';

// ──────────────────────────────────────────
// Enums matching database CHECK constraints
// ──────────────────────────────────────────

export const TrackTypeSchema = z.enum([
  'video',
  'dialogue',
  'music',
  'sfx',
  'ambient',
  'title',
  'upload',
]);
/** Alias for use in row-validation schemas */
export const TrackTypeEnum = TrackTypeSchema;

export const RenderStatusSchema = z.enum([
  'none',
  'queued',
  'rendering',
  'completed',
  'failed',
]);
export const RenderStatusEnum = RenderStatusSchema;

export const TransitionTypeSchema = z.enum([
  'cut',
  'crossfade',
  'fade_black',
  'fade_white',
  'wipe_left',
  'wipe_right',
  'dissolve',
]);
export const TransitionTypeEnum = TransitionTypeSchema;

export const KeyframePropertySchema = z.enum([
  'volume',
  'position_x',
  'position_y',
  'scale',
  'rotation',
  'opacity',
]);
export const KeyframePropertyEnum = KeyframePropertySchema;

export const KeyframeEasingSchema = z.enum([
  'linear',
  'ease_in',
  'ease_out',
  'ease_in_out',
  'hold',
  'bezier',
]);
export const KeyframeEasingEnum = KeyframeEasingSchema;

// ──────────────────────────────────────────
// Edit Project schemas
// ──────────────────────────────────────────

export const CreateEditProjectSchema = z.object({
  episodeId: z.string().uuid(),
  width: z.number().int().positive().default(1920),
  height: z.number().int().positive().default(1080),
  fps: z.number().int().positive().max(120).default(30),
  activeLanguage: z.string().max(10).default('en'),
});

export const GetEditProjectSchema = z.object({
  editProjectId: z.string().uuid(),
});

export const FindEditProjectByEpisodeSchema = z.object({
  episodeId: z.string().uuid(),
});

export const UpdateEditProjectSchema = z.object({
  editProjectId: z.string().uuid(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  fps: z.number().int().positive().max(120).optional(),
  activeLanguage: z.string().max(10).optional(),
  renderStatus: RenderStatusSchema.optional(),
  renderUrl: z.string().url().nullish(),
  renderError: z.string().nullish(),
});

// ──────────────────────────────────────────
// Edit Track schemas
// ──────────────────────────────────────────

export const CreateTrackSchema = z.object({
  editProjectId: z.string().uuid(),
  type: TrackTypeSchema,
  name: z.string().min(1).max(255),
  sortOrder: z.number().int().min(0).default(0),
  volume: z.number().min(0).max(2).default(1.0),
});

export const UpdateTrackSchema = z.object({
  trackId: z.string().uuid(),
  name: z.string().min(1).max(255).optional(),
  sortOrder: z.number().int().min(0).optional(),
  volume: z.number().min(0).max(2).optional(),
  isMuted: z.boolean().optional(),
  isSolo: z.boolean().optional(),
  isLocked: z.boolean().optional(),
  height: z.number().int().positive().optional(),
});

export const DeleteTrackSchema = z.object({
  trackId: z.string().uuid(),
});

// ──────────────────────────────────────────
// Edit Clip schemas
// ──────────────────────────────────────────

export const CreateClipSchema = z.object({
  trackId: z.string().uuid(),
  sourceShotId: z.string().uuid().nullish(),
  sourceDialogueId: z.string().uuid().nullish(),
  sourceDubbedDialogueId: z.string().uuid().nullish(),
  sourceAudioTrackId: z.string().uuid().nullish(),
  sourceUploadUrl: z.string().nullish(),
  mediaUrl: z.string().nullish(),
  thumbnailUrl: z.string().nullish(),
  startMs: z.number().int().min(0),
  endMs: z.number().int().positive(),
  inPointMs: z.number().int().min(0).default(0),
  outPointMs: z.number().int().positive(),
  volume: z.number().min(0).max(2).default(1.0),
  speed: z.number().min(0.25).max(4).default(1.0),
  fadeInMs: z.number().int().min(0).default(0),
  fadeOutMs: z.number().int().min(0).default(0),
  sortOrder: z.number().int().min(0).default(0),
  syncGroupId: z.string().uuid().nullish(),
  language: z.string().max(10).nullish(),
  isActive: z.boolean().default(true),
});

export const UpdateClipSchema = z.object({
  clipId: z.string().uuid(),
  startMs: z.number().int().min(0).optional(),
  endMs: z.number().int().positive().optional(),
  inPointMs: z.number().int().min(0).optional(),
  outPointMs: z.number().int().positive().optional(),
  volume: z.number().min(0).max(2).optional(),
  speed: z.number().min(0.25).max(4).optional(),
  fadeInMs: z.number().int().min(0).optional(),
  fadeOutMs: z.number().int().min(0).optional(),
  sortOrder: z.number().int().min(0).optional(),
  isActive: z.boolean().optional(),
});

export const DeleteClipSchema = z.object({
  clipId: z.string().uuid(),
});

export const SplitClipSchema = z.object({
  clipId: z.string().uuid(),
  splitAtMs: z.number().int().positive(),
});

// ──────────────────────────────────────────
// Edit Transition schemas
// ──────────────────────────────────────────

/** Typed transition params per transition type (discriminated union) */
const CutParams = z.object({}).default({});

const CrossfadeParams = z
  .object({
    curve: z.enum(['linear', 'ease_in', 'ease_out']).default('linear'),
  })
  .default({});

const FadeParams = z
  .object({
    curve: z.enum(['linear', 'ease_in', 'ease_out']).default('linear'),
  })
  .default({});

const WipeParams = z
  .object({
    angle: z.number().min(0).max(360).default(0),
    softness: z.number().min(0).max(1).default(0.1),
  })
  .default({});

const DissolveParams = z
  .object({
    curve: z.enum(['linear', 'ease_in', 'ease_out']).default('linear'),
  })
  .default({});

/**
 * Map from transition type → typed params schema.
 * Used for validation at the action boundary; stored as JSONB in the DB.
 */
const TransitionParamsMap = {
  cut: CutParams,
  crossfade: CrossfadeParams,
  fade_black: FadeParams,
  fade_white: FadeParams,
  wipe_left: WipeParams,
  wipe_right: WipeParams,
  dissolve: DissolveParams,
} as const;

export const CreateTransitionSchema = z
  .object({
    fromClipId: z.string().uuid(),
    toClipId: z.string().uuid(),
    type: TransitionTypeSchema.default('cut'),
    durationMs: z.number().int().min(0).max(5000).default(500),
    params: z.record(z.unknown()).default({}),
  })
  .superRefine((val, ctx) => {
    const paramsSchema = TransitionParamsMap[val.type];

    if (paramsSchema) {
      const result = paramsSchema.safeParse(val.params);

      if (!result.success) {
        result.error.issues.forEach((issue) => {
          ctx.addIssue({
            ...issue,
            path: ['params', ...issue.path],
          });
        });
      }
    }
  });

export const UpdateTransitionSchema = z.object({
  transitionId: z.string().uuid(),
  type: TransitionTypeSchema.optional(),
  durationMs: z.number().int().min(0).max(5000).optional(),
  params: z.record(z.unknown()).optional(),
});

export const DeleteTransitionSchema = z.object({
  transitionId: z.string().uuid(),
});

// ──────────────────────────────────────────
// Edit Keyframe schemas
// ──────────────────────────────────────────

export const CreateKeyframeSchema = z.object({
  clipId: z.string().uuid(),
  property: KeyframePropertySchema,
  offsetMs: z.number().int().min(0),
  value: z.number(),
  easing: KeyframeEasingSchema.default('linear'),
  bezierCp1X: z.number().min(0).max(1).nullish(),
  bezierCp1Y: z.number().min(0).max(1).nullish(),
  bezierCp2X: z.number().min(0).max(1).nullish(),
  bezierCp2Y: z.number().min(0).max(1).nullish(),
});

export const UpdateKeyframeSchema = z.object({
  keyframeId: z.string().uuid(),
  offsetMs: z.number().int().min(0).optional(),
  value: z.number().optional(),
  easing: KeyframeEasingSchema.optional(),
  bezierCp1X: z.number().min(0).max(1).nullish(),
  bezierCp1Y: z.number().min(0).max(1).nullish(),
  bezierCp2X: z.number().min(0).max(1).nullish(),
  bezierCp2Y: z.number().min(0).max(1).nullish(),
});

export const DeleteKeyframeSchema = z.object({
  keyframeId: z.string().uuid(),
});

// ──────────────────────────────────────────
// Dialogue Sync Group schemas
// ──────────────────────────────────────────

export const CreateSyncGroupSchema = z.object({
  editProjectId: z.string().uuid(),
  anchorDialogueId: z.string().uuid(),
  primaryClipId: z.string().uuid().nullish(),
});

// ──────────────────────────────────────────
// Batch operation schemas (auto-assembly + auto-save)
// ──────────────────────────────────────────

const BatchTrackSchema = z.object({
  type: TrackTypeSchema,
  name: z.string().min(1).max(255),
  sortOrder: z.number().int().min(0),
  volume: z.number().min(0).max(2).default(1.0),
});

const BatchClipSchema = z.object({
  trackIndex: z.number().int().min(0),
  sourceShotId: z.string().uuid().nullish(),
  sourceDialogueId: z.string().uuid().nullish(),
  sourceDubbedDialogueId: z.string().uuid().nullish(),
  sourceAudioTrackId: z.string().uuid().nullish(),
  sourceUploadUrl: z.string().nullish(),
  mediaUrl: z.string().nullish(),
  thumbnailUrl: z.string().nullish(),
  startMs: z.number().int().min(0),
  endMs: z.number().int().positive(),
  inPointMs: z.number().int().min(0).default(0),
  outPointMs: z.number().int().positive(),
  volume: z.number().min(0).max(2).default(1.0),
  speed: z.number().min(0.25).max(4).default(1.0),
  fadeInMs: z.number().int().min(0).default(0),
  fadeOutMs: z.number().int().min(0).default(0),
  sortOrder: z.number().int().min(0).default(0),
  language: z.string().max(10).nullish(),
  isActive: z.boolean().default(true),
  syncGroupIndex: z.number().int().min(0).nullish(),
});

const BatchKeyframeSchema = z.object({
  clipIndex: z.number().int().min(0),
  property: KeyframePropertySchema,
  offsetMs: z.number().int().min(0),
  value: z.number(),
  easing: KeyframeEasingSchema.default('linear'),
});

const BatchSyncGroupSchema = z.object({
  anchorDialogueId: z.string().uuid(),
  primaryClipIndex: z.number().int().min(0).nullish(),
});

export const BatchAssembleSchema = z.object({
  episodeId: z.string().uuid(),
  width: z.number().int().positive().default(1920),
  height: z.number().int().positive().default(1080),
  fps: z.number().int().positive().max(120).default(30),
  activeLanguage: z.string().max(10).default('en'),
  tracks: z.array(BatchTrackSchema).min(1).max(50),
  clips: z.array(BatchClipSchema).max(1000),
  keyframes: z.array(BatchKeyframeSchema).max(5000),
  syncGroups: z.array(BatchSyncGroupSchema).max(500),
});

const DirtyClipSchema = z.object({
  id: z.string().uuid(),
  startMs: z.number().int().min(0).optional(),
  endMs: z.number().int().positive().optional(),
  inPointMs: z.number().int().min(0).optional(),
  outPointMs: z.number().int().positive().optional(),
  volume: z.number().min(0).max(2).optional(),
  speed: z.number().min(0.25).max(4).optional(),
  fadeInMs: z.number().int().min(0).optional(),
  fadeOutMs: z.number().int().min(0).optional(),
  sortOrder: z.number().int().min(0).optional(),
  isActive: z.boolean().optional(),
});

const DirtyTrackSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(255).optional(),
  sortOrder: z.number().int().min(0).optional(),
  volume: z.number().min(0).max(2).optional(),
  isMuted: z.boolean().optional(),
  isSolo: z.boolean().optional(),
  isLocked: z.boolean().optional(),
  height: z.number().int().positive().optional(),
});

const DirtyKeyframeSchema = z.object({
  id: z.string().uuid(),
  offsetMs: z.number().int().min(0).optional(),
  value: z.number().optional(),
  easing: KeyframeEasingSchema.optional(),
  bezierCp1X: z.number().min(0).max(1).nullish(),
  bezierCp1Y: z.number().min(0).max(1).nullish(),
  bezierCp2X: z.number().min(0).max(1).nullish(),
  bezierCp2Y: z.number().min(0).max(1).nullish(),
});

export const BatchSaveSchema = z.object({
  editProjectId: z.string().uuid(),
  dirtyClips: z.array(DirtyClipSchema).max(500).default([]),
  dirtyTracks: z.array(DirtyTrackSchema).max(50).default([]),
  dirtyKeyframes: z.array(DirtyKeyframeSchema).max(2000).default([]),
  deletedClipIds: z.array(z.string().uuid()).max(100).default([]),
  deletedKeyframeIds: z.array(z.string().uuid()).max(500).default([]),
  newClips: z.array(CreateClipSchema).max(100).default([]),
  newKeyframes: z.array(CreateKeyframeSchema).max(1000).default([]),
});

// ──────────────────────────────────────────
// Type exports
// ──────────────────────────────────────────

export type TrackType = z.infer<typeof TrackTypeSchema>;
export type RenderStatus = z.infer<typeof RenderStatusSchema>;
export type TransitionType = z.infer<typeof TransitionTypeSchema>;
export type KeyframeProperty = z.infer<typeof KeyframePropertySchema>;
export type KeyframeEasing = z.infer<typeof KeyframeEasingSchema>;

export type CreateEditProjectInput = z.infer<typeof CreateEditProjectSchema>;
export type GetEditProjectInput = z.infer<typeof GetEditProjectSchema>;
export type UpdateEditProjectInput = z.infer<typeof UpdateEditProjectSchema>;

export type CreateTrackInput = z.infer<typeof CreateTrackSchema>;
export type UpdateTrackInput = z.infer<typeof UpdateTrackSchema>;
export type DeleteTrackInput = z.infer<typeof DeleteTrackSchema>;

export type CreateClipInput = z.infer<typeof CreateClipSchema>;
export type UpdateClipInput = z.infer<typeof UpdateClipSchema>;
export type DeleteClipInput = z.infer<typeof DeleteClipSchema>;
export type SplitClipInput = z.infer<typeof SplitClipSchema>;

export type CreateTransitionInput = z.infer<typeof CreateTransitionSchema>;
export type UpdateTransitionInput = z.infer<typeof UpdateTransitionSchema>;
export type DeleteTransitionInput = z.infer<typeof DeleteTransitionSchema>;

export type CreateKeyframeInput = z.infer<typeof CreateKeyframeSchema>;
export type UpdateKeyframeInput = z.infer<typeof UpdateKeyframeSchema>;
export type DeleteKeyframeInput = z.infer<typeof DeleteKeyframeSchema>;

export type CreateSyncGroupInput = z.infer<typeof CreateSyncGroupSchema>;
export type BatchAssembleInput = z.infer<typeof BatchAssembleSchema>;
export type BatchSaveInput = z.infer<typeof BatchSaveSchema>;
