import { z } from 'zod';

import { SHOT_DURATION_LIMITS } from '@kit/prompt-engine/llm-job-payloads';
import {
  DialogueLineSchema,
  SceneSchema,
  SceneShotSchema,
  VeoPromptV2Schema,
} from '@kit/prompt-engine/schemas';

/**
 * FILM-1909's edit inputs. Every field but the target and its version is
 * optional and merges over what is stored; the merged scene or shot is then
 * validated with the stage's own output schema and `check()`, so an edit
 * is refused for exactly what a generated part would be.
 */
const episodeId = z.string().uuid().describe('The episode id.');

const version = z
  .number()
  .int()
  .describe(
    'The episode version from get_episode; the edit fails with TARGET_CHANGED if the episode moved since.',
  );

const DialogueLineInput = DialogueLineSchema.extend({
  character: z.string().min(1),
  text: z.string().min(1),
});

export const EditSceneInput = {
  episodeId,
  version,
  sceneNumber: z
    .number()
    .int()
    .positive()
    .describe('The scene to edit (from get_screenplay).'),
  heading: SceneSchema.shape.heading.optional(),
  location: SceneSchema.shape.location.optional(),
  timeOfDay: SceneSchema.shape.timeOfDay.optional(),
  description: SceneSchema.shape.description.optional(),
  estimatedDuration: z.number().positive().optional(),
  action: z.array(z.string()).optional(),
  emotionalPeak: z.string().optional(),
  hookOut: z.string().optional(),
  dialogue: z
    .array(DialogueLineInput)
    .optional()
    .describe(
      "The scene's whole dialogue, in order. Same number of lines: changed lines are edited in place. A different number: the episode's dialogue lines are rebuilt, as a new screenplay rebuilds them, and their voice renders and translations are dropped.",
    ),
  newCharacters: z
    .array(z.string().min(1))
    .optional()
    .describe('Speakers the episode does not have yet, created as assets.'),
  newLocations: z
    .array(z.string().min(1))
    .optional()
    .describe('Locations the episode does not have yet.'),
};

export const EditDialogueLineInput = {
  episodeId,
  version,
  dialogueLineId: z
    .string()
    .uuid()
    .describe('An English line (from get_dialogue).'),
  text: z.string().min(1).optional(),
  character: z.string().min(1).optional().describe('The speaker, by name.'),
  parenthetical: z.string().nullable().optional(),
};

const shot = SceneShotSchema.shape;

export const EditShotInput = {
  episodeId,
  version,
  shotId: z.string().uuid().describe('The shot id (from get_shots).'),
  description: shot.description.optional(),
  durationSeconds: z
    .number()
    .min(SHOT_DURATION_LIMITS.min)
    .max(SHOT_DURATION_LIMITS.max)
    .optional(),
  shotType: shot.shotType.optional(),
  cameraDirection: shot.cameraDirection.optional(),
  characters: shot.characters.optional(),
  location: z.string().min(1).optional(),
  timeOfDay: shot.metadata.shape.timeOfDay.optional(),
  mood: z.string().optional(),
  transitionType: z
    .enum(['continuation', 'cut', 'match_cut', 'j_cut', 'l_cut'])
    .optional(),
  frameStrategy: z
    .enum([
      'character_focus',
      'environment_focus',
      'two_shot',
      'group',
      'detail_insert',
    ])
    .optional(),
  primarySubject: shot.primarySubject,
  firstFrameDescription: z.string().nullable().optional(),
  lastFrameDescription: z.string().nullable().optional(),
  locationArea: z.string().nullable().optional(),
  locationEnvironmentDescription: z.string().nullable().optional(),
  veoPrompt: VeoPromptV2Schema.partial()
    .optional()
    .describe(
      'Any of the VEO prompt components (shotLine, timeline, audio, style, avoid, fullPrompt); the rest are kept.',
    ),
};
