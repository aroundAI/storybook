import 'server-only';

import { z } from 'zod';

import {
  ALL_STAGES,
  CheckErrorSchema,
  type StageKey,
  StageKeySchema,
} from '@kit/generation';

/**
 * Every registered stage, in the order StageKeySchema lists them. Read
 * from ALL_STAGES rather than the registry: using the list is what makes a
 * bundler load the stage modules, which register themselves (FILM-1908).
 */
export function registeredStages(): [StageKey, ...StageKey[]] {
  const registered = new Set(ALL_STAGES.map((stage) => stage.key));
  const keys = StageKeySchema.options.filter((key) => registered.has(key));

  if (keys.length === 0) {
    throw new Error('No generation stage is registered');
  }

  return keys as [StageKey, ...StageKey[]];
}

export const StageArg = z
  .enum(registeredStages())
  .describe(
    'The generation stage, from the stage registry. get_workflow_guide says what each needs and the order they run in.',
  );

const uuid = z.string().uuid();

/** EDD "MCP tool contracts": flat, with the stage's own inputs in options. */
export const StartGenerationInput = {
  stage: StageArg,
  episodeId: uuid
    .optional()
    .describe('The episode, for an episode stage (story, screenplay, shots).'),
  projectId: uuid
    .optional()
    .describe(
      'The project, for a project stage; taken from the episode when an episode is given.',
    ),
  assetId: uuid.optional().describe('The asset, for asset_description.'),
  sceneNumber: z
    .number()
    .int()
    .positive()
    .optional()
    .describe('One scene, for a stage that works on a single scene.'),
  options: z
    .record(z.unknown())
    .optional()
    .describe(
      "The stage's own inputs beyond the target (a refinement's feedback, a language). Fields the episode already holds (title, logline, target duration, content style) are read from it; a value given here overrides it.",
    ),
};

export const BriefRefSchema = z.object({
  partKey: z.string(),
  label: z.string(),
  index: z.number().int(),
  total: z.number().int(),
});
export type BriefRef = z.infer<typeof BriefRefSchema>;

export const GetBriefInput = {
  runId: uuid.describe('The run start_generation returned.'),
  partKey: z
    .string()
    .min(1)
    .max(100)
    .describe(
      "The part, as the run lists it: 'story', 'reel_scout', 'scene:4'.",
    ),
};

export const SubmitGenerationInput = {
  runId: uuid.describe('The run start_generation returned.'),
  partKey: z
    .string()
    .min(1)
    .max(100)
    .describe('The part this output answers, as its brief named it.'),
  output: z
    .unknown()
    .describe(
      "The part's output, matching the brief's outputSchema. Up to about 100 KB; a larger stage is split into parts.",
    ),
  model: z
    .string()
    .max(100)
    .optional()
    .describe(
      'The model you wrote this with. Stored as self-reported, beside the client name.',
    ),
};

export const RunIdInput = {
  runId: uuid.describe('The run start_generation returned.'),
};

export const SubmitGenerationResultSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('accepted'),
    partKey: z.string(),
    next: BriefRefSchema.nullable(),
    remaining: z.number().int().nonnegative(),
  }),
  z.object({
    status: z.literal('rejected'),
    partKey: z.string(),
    errors: z.array(CheckErrorSchema),
  }),
]);
export type SubmitGenerationResult = z.infer<
  typeof SubmitGenerationResultSchema
>;

/** What `generation_run_parts.validation` holds, written by this module only. */
export const PartValidationSchema = z.object({
  status: z.enum(['accepted', 'rejected']).optional(),
  hash: z.string().optional(),
  model: z.string().optional(),
  result: SubmitGenerationResultSchema.optional(),
  failures: z
    .array(
      z.object({
        at: z.string(),
        hash: z.string().optional(),
        errors: z.array(CheckErrorSchema),
      }),
    )
    .default([]),
});
export type PartValidation = z.infer<typeof PartValidationSchema>;
