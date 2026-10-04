/**
 * The `shots` stage (FILM-1901, part D): one reel-scout part, then one part
 * per screenplay scene; commit replaces the episode's shots, as
 * `handlers/shot-generation.ts` did before it moved here.
 *
 * Parts are `reel_scout`, `scene:1` … `scene:N`. The stage's outputSchema
 * is the union of the two part shapes, told apart by `kind`; each brief
 * carries only its own part's schema. In server mode the Shot Orchestrator
 * (Reel Scout → Shot Director per scene → Shot Quality) produces every part
 * in one run and the worker splits its result by part.
 */
import { z } from 'zod';

import {
  DEFAULT_SHOT_DURATION,
  SHOT_DURATION_LIMITS,
  wholeShotSeconds,
} from '@kit/prompt-engine/llm-job-payloads';
import reelScoutPrompt from '@kit/prompt-engine/prompts/quality-evaluation/reel-scout.json';
import sceneShotPrompt from '@kit/prompt-engine/prompts/story-generation/scene-shot-generation.json';
import {
  type ReelSceneAnalysis,
  ReelScoutOutputSchema,
  type SceneShot,
  SceneShotGenerationOutputSchema,
  SceneShotSchema,
  reelNoteFor,
} from '@kit/prompt-engine/schemas';
import {
  type ContentStyle,
  calculateContentScaling,
} from '@kit/shared/duration-scaling';
import {
  sanitizeForPrompt,
  sanitizeStrings,
} from '@kit/shared/prompt-sanitiser';
import { whyNoRow } from '@kit/shared/rows';
import type { Json } from '@kit/supabase/database';

import { type PromptFile, buildBrief } from '../brief';
import { applyCommit, eq, is } from '../commit-plan';
import { jobCompletedWrite } from '../jobs';
import { renderPerformanceContext } from '../performance-context';
import { registerStage } from '../registry';
import type {
  Brief,
  CheckError,
  CommitResult,
  Ctx,
  EpisodeContextSnapshot,
  GenerationRun,
  PartSpec,
  StageDefinition,
} from '../types';
import type { AudioCuesTarget } from './audio-cues';
import { logTo, memoPerCtx, nameMatches } from './memo';

const shotSeconds = z
  .number()
  .min(SHOT_DURATION_LIMITS.min)
  .max(SHOT_DURATION_LIMITS.max);

/** The most shots one `regenerate_shots` call may re-plan (FILM-2007). */
export const SHOT_REGENERATION_MAX = 20;

/**
 * A re-plan of some of the episode's shots (FILM-2007): one part per listed
 * shot, and a commit that rewrites those shots in place rather than
 * replacing the shot list. The shots' status and media are reset by the
 * caller when it opens the run; the commit allowlist keeps them out of a
 * stage's reach (FILM-1909).
 */
export const ShotsRegenerationSchema = z.object({
  shotIds: z
    .array(z.string().uuid())
    .min(1)
    .max(SHOT_REGENERATION_MAX)
    .refine((ids) => new Set(ids).size === ids.length, {
      message: 'lists a shot twice',
    }),
  reason: z.string().trim().min(1).max(500),
});

export type ShotsRegeneration = z.infer<typeof ShotsRegenerationSchema>;

export const ShotsTargetSchema = z.object({
  episodeId: z.string().uuid(),
  projectId: z.string().uuid(),
  accountId: z.string().uuid(),
  userId: z.string().uuid(),
  /** How long each shot may run, in seconds (KB-120) */
  shotDuration: z
    .object({ min: shotSeconds, max: shotSeconds })
    .refine((range) => range.min <= range.max, {
      message: 'must not be less than min',
      path: ['max'],
    })
    .default({ ...DEFAULT_SHOT_DURATION }),
  /** Re-plan only these shots (FILM-2007); absent for a whole shot list */
  regenerate: ShotsRegenerationSchema.optional(),
});

export type ShotsTarget = z.infer<typeof ShotsTargetSchema>;

export const REEL_SCOUT_PART = 'reel_scout';

export function scenePartKey(sceneNumber: number) {
  return `scene:${sceneNumber}`;
}

export function sceneNumberOfPart(partKey: string): number | undefined {
  const match = /^scene:(\d+)$/.exec(partKey);

  return match ? Number(match[1]) : undefined;
}

export const ReelScoutPartOutputSchema = ReelScoutOutputSchema.extend({
  kind: z.literal('reel_scout'),
});

export const SceneShotsPartOutputSchema =
  SceneShotGenerationOutputSchema.extend({
    kind: z.literal('scene'),
    sceneNumber: z.number().int().positive(),
  });

/** One re-planned shot, for the `shot:<id>` part of a regeneration. */
export const RegeneratedShotPartOutputSchema = SceneShotSchema.extend({
  kind: z.literal('shot'),
  shotId: z.string().uuid(),
});

export function shotPartKey(shotId: string) {
  return `shot:${shotId}`;
}

export function shotIdOfPart(partKey: string): string | undefined {
  return /^shot:([0-9a-f-]{36})$/i.exec(partKey)?.[1];
}

export const ShotsPartOutputSchema = z.discriminatedUnion('kind', [
  ReelScoutPartOutputSchema,
  SceneShotsPartOutputSchema,
  RegeneratedShotPartOutputSchema,
]);

export type ReelScoutPartOutput = z.infer<typeof ReelScoutPartOutputSchema>;
export type SceneShotsPartOutput = z.infer<typeof SceneShotsPartOutputSchema>;
export type RegeneratedShotPartOutput = z.infer<
  typeof RegeneratedShotPartOutputSchema
>;
export type ShotsPartOutput = z.infer<typeof ShotsPartOutputSchema>;

/** The most shots one scene may carry; the prompt asks for 3 to 8. */
export const SHOTS_PER_SCENE_MAX = 10;

/** A screenplay scene as the Shot Orchestrator receives it. */
export interface ShotsScene {
  number: number;
  heading: string;
  location: string;
  timeOfDay: string;
  description: string;
  action: string[];
  dialogue: Array<{ character: string; text: string; parenthetical?: string }>;
  estimatedDuration?: number;
}

interface StoredScene {
  number: number;
  heading: string;
  location: string;
  timeOfDay: string;
  description: string;
  action?: unknown;
  estimatedDuration?: number;
  // Stored screenplays carry the line as `text` (orchestrator output) or, in
  // older rows, `dialogue`.
  dialogue?: Array<{
    character: string;
    text?: string;
    dialogue?: string;
    parenthetical?: string;
  }>;
}

export interface ShotsEpisode {
  id: string;
  title: string;
  version: number;
  shotList: unknown;
  scenes: ShotsScene[];
  context: EpisodeContextSnapshot;
  shotCountBounds: { totalShotsMin: number; totalShotsMax: number };
}

const loaded = new WeakMap<Ctx, Map<string, Promise<ShotsEpisode>>>();

/**
 * The episode and its screenplay, mapped as the handler mapped them:
 * `screenplay_data` stores action lines in `description`, so the action
 * list is derived from it when the scene stores none, and stored text is
 * defused for the model (KB-101).
 */
export function loadShotsEpisode(
  ctx: Ctx,
  target: ShotsTarget,
): Promise<ShotsEpisode> {
  return memoPerCtx(loaded, ctx, target.episodeId, async () => {
    const { data: episode, error } = await ctx.client
      .from('episodes')
      .select(
        'id, title, version, shot_list, screenplay_data, story_data, target_duration_seconds',
      )
      .eq('id', target.episodeId)
      .single();

    if (error || !episode) {
      throw new Error(whyNoRow(error, 'Episode not found'));
    }

    const screenplay = episode.screenplay_data as {
      scenes?: StoredScene[];
    } | null;

    if (!screenplay?.scenes?.length) {
      throw new Error('Episode must have screenplay generated first');
    }

    const scenes = sanitizeStrings(screenplay.scenes).map(
      (scene): ShotsScene => {
        const stored = Array.isArray(scene.action)
          ? (scene.action as unknown[]).filter(
              (line): line is string => typeof line === 'string',
            )
          : [];
        const action = stored.length
          ? stored
          : (scene.description ?? '')
              .split('\n')
              .map((line) => line.trim())
              .filter(Boolean);

        return {
          number: scene.number,
          heading: scene.heading,
          location: scene.location,
          timeOfDay: scene.timeOfDay,
          description: scene.description,
          action,
          dialogue: (scene.dialogue ?? []).map((line) => ({
            character: line.character,
            text: line.text ?? line.dialogue ?? '',
            parenthetical: line.parenthetical,
          })),
          estimatedDuration: scene.estimatedDuration,
        };
      },
    );

    if (!ctx.episodeContext) {
      throw new Error(
        'The shots stage needs ctx.episodeContext to format characters and locations',
      );
    }

    const context = await ctx.episodeContext(target.episodeId, {});

    const storyData = (episode.story_data ?? {}) as {
      targetDuration?: number;
      contentStyle?: string;
    };
    const scaling = calculateContentScaling({
      targetDurationSeconds:
        episode.target_duration_seconds || storyData.targetDuration || 300,
      contentStyle: (storyData.contentStyle ??
        'dialogue-heavy') as ContentStyle,
    });

    return {
      id: episode.id,
      title: sanitizeForPrompt(episode.title),
      version: episode.version,
      shotList: episode.shot_list,
      scenes,
      context,
      shotCountBounds: {
        totalShotsMin: scaling.shots.totalShotsMin,
        totalShotsMax: scaling.shots.totalShotsMax,
      },
    };
  });
}

function partsFor(scenes: ShotsScene[]): PartSpec[] {
  const total = scenes.length + 1;

  return [
    {
      key: REEL_SCOUT_PART,
      index: 0,
      total,
      label: 'Reel Scout: which scenes stand alone as shorts',
    },
    ...scenes.map((scene, index) => ({
      key: scenePartKey(scene.number),
      index: index + 1,
      total,
      label: `Scene ${scene.number}: ${scene.heading}`,
    })),
  ];
}

/** `Brief.context` of every shots part: what the server orchestrator needs. */
export type ShotsBriefContext = {
  episode: { id: string; title: string; version: number };
  scenes: ShotsScene[];
  charactersVeo: string;
  locationsVeo: string;
  recurringElements: string;
  genre: string;
  targetAudience: string;
  visualStyle: string;
  shotDuration: { min: number; max: number };
};

function shotsContext(
  episode: ShotsEpisode,
  target: ShotsTarget,
): ShotsBriefContext {
  return {
    episode: { id: episode.id, title: episode.title, version: episode.version },
    scenes: episode.scenes,
    charactersVeo: episode.context.charactersVeo ?? '',
    locationsVeo: episode.context.locationsVeo ?? '',
    recurringElements: episode.context.recurringElements ?? '',
    genre: episode.context.genre ?? 'general',
    targetAudience: episode.context.targetAudience ?? 'general',
    visualStyle: episode.context.visualStyle ?? 'cinematic',
    shotDuration: target.shotDuration,
  };
}

function sceneLocations(scene: ShotsScene, known: string[]) {
  return [...known, scene.location, scene.heading].filter(Boolean);
}

const VEO_COMPONENTS = ['shotLine', 'audio', 'style', 'fullPrompt'] as const;

function checkScenePart(
  target: ShotsTarget,
  episode: ShotsEpisode,
  out: SceneShotsPartOutput,
  sceneNumber: number,
): CheckError[] {
  const errors: CheckError[] = [];
  const scene = episode.scenes.find((s) => s.number === sceneNumber);

  if (out.sceneNumber !== sceneNumber) {
    errors.push({
      path: 'sceneNumber',
      code: 'wrong_scene',
      message: `This part is scene ${sceneNumber}, not ${out.sceneNumber}`,
    });
  }

  if (out.shots.length === 0) {
    errors.push({
      path: 'shots',
      code: 'too_few_shots',
      message: `Scene ${sceneNumber} needs at least one shot`,
    });
  }

  if (out.shots.length > SHOTS_PER_SCENE_MAX) {
    errors.push({
      path: 'shots',
      code: 'too_many_shots',
      message: `Scene ${sceneNumber} has ${out.shots.length} shots; at most ${SHOTS_PER_SCENE_MAX}`,
    });
  }

  const characterNames = episode.context.characterNames ?? [];
  const locationNames = scene
    ? sceneLocations(scene, episode.context.locationNames ?? [])
    : (episode.context.locationNames ?? []);
  const { min, max } = target.shotDuration;

  out.shots.forEach((shot, index) => {
    const at = `shots.${index}`;

    if (shot.duration < min || shot.duration > max) {
      errors.push({
        path: `${at}.duration`,
        code: 'duration_out_of_range',
        message: `${shot.duration}s is outside the ${min}–${max}s this episode asked for`,
      });
    }

    if (characterNames.length) {
      for (const name of shot.characters) {
        if (!nameMatches(name, characterNames)) {
          errors.push({
            path: `${at}.characters`,
            code: 'unknown_character',
            message: `"${name}" is not one of the episode's characters: ${characterNames.join(', ')}`,
          });
        }
      }
    }

    if (
      locationNames.length &&
      !nameMatches(shot.metadata.location, locationNames)
    ) {
      errors.push({
        path: `${at}.metadata.location`,
        code: 'unknown_location',
        message: `"${shot.metadata.location}" is not a location of this scene or episode`,
      });
    }

    for (const component of VEO_COMPONENTS) {
      if (!shot.veoPrompt[component].trim()) {
        errors.push({
          path: `${at}.veoPrompt.${component}`,
          code: 'missing_veo_component',
          message: `The VEO prompt's ${component} is empty`,
        });
      }
    }

    if (shot.veoPrompt.timeline.length === 0) {
      errors.push({
        path: `${at}.veoPrompt.timeline`,
        code: 'missing_veo_component',
        message: 'The VEO prompt has no timeline (action and dialogue events)',
      });
    }

    if (!shot.veoPrompt.avoid.trim()) {
      errors.push({
        path: `${at}.veoPrompt.avoid`,
        code: 'missing_negative_prompt',
        message:
          'The negative prompt (avoid) is empty; it must exclude subtitles, captions and watermarks',
      });
    }
  });

  return errors;
}

function checkReelScoutPart(
  episode: ShotsEpisode,
  out: ReelScoutPartOutput,
): CheckError[] {
  const errors: CheckError[] = [];
  const sceneNumbers = new Set(episode.scenes.map((s) => s.number));

  out.sceneAnalyses.forEach((analysis, index) => {
    if (!sceneNumbers.has(analysis.sceneNumber)) {
      errors.push({
        path: `sceneAnalyses.${index}.sceneNumber`,
        code: 'unknown_scene',
        message: `Scene ${analysis.sceneNumber} is not in the screenplay`,
      });
    }
  });

  out.topReelCandidates.forEach((sceneNumber, index) => {
    if (!sceneNumbers.has(sceneNumber)) {
      errors.push({
        path: `topReelCandidates.${index}`,
        code: 'unknown_scene',
        message: `Scene ${sceneNumber} is not in the screenplay`,
      });
    }
  });

  return errors;
}

export interface ShotRow {
  episode_id: string;
  scene_number: number;
  shot_number: number;
  sequence_number: number;
  scene_description: string;
  prompt: string;
  duration_seconds: number;
  camera_direction: string | null;
  status: string;
  shorts_candidate: boolean;
  shorts_metadata: Json | null;
  generation_metadata: Json;
  transition_type: string | null;
  frame_strategy: string | null;
  primary_subject: Json | null;
  first_frame_description: string | null;
  last_frame_description: string | null;
  location_area: string | null;
  location_environment_description: string | null;
}

export interface ShotsCommitData {
  totalShots: number;
  shotsCreated: number;
  metadata: {
    totalDuration: number;
    shotTypes: { wide: number; medium: number; closeUp: number };
    scenesProcessed: number;
  };
  reelCandidateScenes: number[];
  /** A regeneration's re-planned shot ids (FILM-2007) */
  regeneratedShotIds?: string[];
}

function shortsMetadataFor(
  analysis: ReelSceneAnalysis | undefined,
  shot: SceneShot,
  sceneIsCandidate: boolean,
): Json | null {
  if (analysis) {
    return {
      viralScore: analysis.viralScore,
      hookType: analysis.hookType ?? undefined,
      estimatedDurationSeconds:
        analysis.estimatedDurationSeconds ?? shot.duration,
      isReelCandidate: analysis.isReelCandidate,
      whyThisWorksAsReel: analysis.whyThisWorksAsReel ?? null,
      whyItDoesntWork: analysis.whyItDoesntWork ?? null,
      keyMoment: analysis.keyMoment ?? null,
      sceneEmotionalArc: analysis.sceneEmotionalArc ?? null,
      improvementSuggestion: analysis.improvementSuggestion ?? null,
    } as Json;
  }

  return sceneIsCandidate
    ? ({
        estimatedDurationSeconds: shot.duration,
        isReelCandidate: true,
      } as Json)
    : null;
}

/**
 * The rows for the shots table: scene parts in screenplay order, shots in
 * the order each part gave them, `shot_number` counted across scenes as the
 * Shot Director numbered them, `sequence_number` continuing from the
 * episode's highest.
 */
export function buildShotRows(
  episode: ShotsEpisode,
  reelScout: ReelScoutPartOutput | undefined,
  sceneParts: SceneShotsPartOutput[],
  firstSequenceNumber: number,
): {
  rows: ShotRow[];
  totalDuration: number;
  shotTypes: ShotsCommitData['metadata']['shotTypes'];
} {
  const candidates = new Set(reelScout?.topReelCandidates ?? []);
  const analyses = new Map(
    (reelScout?.sceneAnalyses ?? []).map((a) => [a.sceneNumber, a]),
  );
  const byScene = new Map(sceneParts.map((part) => [part.sceneNumber, part]));
  const rows: ShotRow[] = [];
  const shotTypes = { wide: 0, medium: 0, closeUp: 0 };
  let totalDuration = 0;
  let shotNumber = 0;
  let sequenceNumber = firstSequenceNumber;

  for (const scene of episode.scenes) {
    const part = byScene.get(scene.number);

    if (!part) continue;

    const sceneIsCandidate = candidates.has(scene.number);
    const analysis = analyses.get(scene.number);

    for (const shot of part.shots) {
      shotNumber += 1;

      rows.push({
        episode_id: episode.id,
        scene_number: scene.number,
        shot_number: shotNumber,
        sequence_number: sequenceNumber++,
        scene_description: shot.description,
        prompt: shot.veoPrompt.fullPrompt || shot.description,
        duration_seconds: wholeShotSeconds(shot.duration),
        camera_direction: shot.cameraDirection ?? null,
        status: 'pending',
        shorts_candidate: sceneIsCandidate,
        shorts_metadata: shortsMetadataFor(analysis, shot, sceneIsCandidate),
        generation_metadata: {
          shotType: shot.shotType,
          location: shot.metadata.location,
          timeOfDay: shot.metadata.timeOfDay,
          mood: shot.metadata.mood,
          characters: shot.characters ?? [],
          veoPrompt: shot.veoPrompt,
          isReelCandidate: sceneIsCandidate,
        } as Json,
        transition_type: shot.transitionType ?? null,
        frame_strategy: shot.frameStrategy ?? null,
        primary_subject: (shot.primarySubject as Json | undefined) ?? null,
        first_frame_description: shot.firstFrameDescription ?? null,
        last_frame_description: shot.lastFrameDescription ?? null,
        location_area: shot.locationArea ?? null,
        location_environment_description:
          shot.locationEnvironmentDescription ?? null,
      });

      if (shot.shotType === 'wide') shotTypes.wide++;
      else if (shot.shotType === 'medium') shotTypes.medium++;
      else if (shot.shotType?.includes('close')) shotTypes.closeUp++;
      totalDuration += shot.duration;
    }
  }

  return { rows, totalDuration, shotTypes };
}

// ---------------------------------------------------------------------------
// Regeneration (FILM-2007): re-plan the listed shots in place
// ---------------------------------------------------------------------------

/** A stored shot as a re-plan reads it. */
export interface RegeneratingShot {
  id: string;
  scene_number: number | null;
  shot_number: number | null;
  sequence_number: number;
  scene_description: string | null;
  prompt: string;
  duration_seconds: number;
  camera_direction: string | null;
  transition_type: string | null;
  first_frame_description: string | null;
  last_frame_description: string | null;
  generation_metadata: Json | null;
}

const REGENERATING_COLUMNS =
  'id, scene_number, shot_number, sequence_number, scene_description, prompt, duration_seconds, camera_direction, transition_type, first_frame_description, last_frame_description, generation_metadata';

const regenerating = new WeakMap<
  Ctx,
  Map<string, Promise<RegeneratingShot[]>>
>();

/**
 * The listed shots of the episode, in sequence order. A shot that is gone
 * (deleted, or not this episode's) fails the read: a re-plan of it has
 * nowhere to land.
 */
export function loadRegeneratingShots(
  ctx: Ctx,
  target: ShotsTarget,
): Promise<RegeneratingShot[]> {
  const ids = target.regenerate?.shotIds ?? [];

  return memoPerCtx(
    regenerating,
    ctx,
    `${target.episodeId}:${[...ids].sort().join(',')}`,
    async () => {
      const { data, error } = await ctx.client
        .from('shots')
        .select(REGENERATING_COLUMNS)
        .eq('episode_id', target.episodeId)
        .is('deleted_at', null)
        .in('id', ids)
        .order('sequence_number', { ascending: true });

      if (error) throw new Error(`Could not read the shots: ${error.message}`);

      const rows = (data ?? []) as RegeneratingShot[];
      const found = new Set(rows.map((row) => row.id));
      const missing = ids.filter((id) => !found.has(id));

      if (missing.length > 0) {
        throw new Error(
          `Shot(s) ${missing.join(', ')} are not shots of this episode`,
        );
      }

      return rows;
    },
  );
}

function regenerationParts(shots: RegeneratingShot[]): PartSpec[] {
  return shots.map((shot, index) => ({
    key: shotPartKey(shot.id),
    index,
    total: shots.length,
    label: `Shot ${shot.shot_number ?? shot.sequence_number} (scene ${shot.scene_number ?? '?'}): re-plan`,
  }));
}

function regenerationNote(
  shot: RegeneratingShot,
  reason: string,
  neighbours: {
    before: RegeneratingShot | null;
    after: RegeneratingShot | null;
  },
) {
  const describe = (row: RegeneratingShot | null) =>
    row ? sanitizeForPrompt(row.scene_description ?? row.prompt) : 'none';

  return [
    'RE-PLAN ONE SHOT. Ignore the instruction to plan the whole scene: return exactly one shot, the replacement for the shot below, as one object (not a list).',
    `Why it is being re-planned: ${sanitizeForPrompt(reason)}`,
    `The current plan: ${sanitizeForPrompt(shot.prompt)}`,
    `The shot before it: ${describe(neighbours.before)}`,
    `The shot after it: ${describe(neighbours.after)}`,
    'Keep it in the same scene and close to its current length; fix what the reason names.',
  ].join('\n');
}

async function prepareRegeneratedShot(
  ctx: Ctx,
  target: ShotsTarget & { regenerate: ShotsRegeneration },
  part: PartSpec,
): Promise<Brief> {
  const episode = await loadShotsEpisode(ctx, target);
  const shots = await loadRegeneratingShots(ctx, target);
  const shotId = shotIdOfPart(part.key);
  const shot = shots.find((row) => row.id === shotId);

  if (!shot) {
    throw new Error(`Part ${part.key} names no listed shot of this episode`);
  }

  const context = shotsContext(episode, target);
  const scene: ShotsScene = episode.scenes.find(
    (s) => s.number === shot.scene_number,
  ) ?? {
    number: shot.scene_number ?? 0,
    heading: '',
    location: '',
    timeOfDay: '',
    description: shot.scene_description ?? '',
    action: [],
    dialogue: [],
  };

  // Neighbours in the episode, for continuity; read with the shot list
  const { data: around } = await ctx.client
    .from('shots')
    .select(REGENERATING_COLUMNS)
    .eq('episode_id', target.episodeId)
    .is('deleted_at', null)
    .in('sequence_number', [
      shot.sequence_number - 1,
      shot.sequence_number + 1,
    ]);
  const neighbours = {
    before:
      ((around ?? []) as RegeneratingShot[]).find(
        (row) => row.sequence_number === shot.sequence_number - 1,
      ) ?? null,
    after:
      ((around ?? []) as RegeneratingShot[]).find(
        (row) => row.sequence_number === shot.sequence_number + 1,
      ) ?? null,
  };
  const note = regenerationNote(shot, target.regenerate.reason, neighbours);

  const brief = buildBrief({
    stage: 'shots',
    part,
    prompt: sceneShotPrompt as PromptFile,
    variables: {
      scene_number: scene.number,
      total_scenes: episode.scenes.length,
      scene_content: JSON.stringify({
        number: scene.number,
        heading: scene.heading,
        location: scene.location,
        timeOfDay: scene.timeOfDay,
        description: scene.description,
        action: scene.action,
        dialogue: scene.dialogue,
      }),
      episode_metadata: JSON.stringify({
        title: episode.title,
        genre: context.genre,
        targetAudience: context.targetAudience,
        visualStyle: context.visualStyle,
        tone: 'balanced',
      }),
      characters: context.charactersVeo || 'No characters defined.',
      locations: context.locationsVeo || 'No locations defined.',
      previous_scene_summary: '',
      reel_note: '',
      recurring_element: context.recurringElements,
      shot_duration_min: target.shotDuration.min,
      shot_duration_max: target.shotDuration.max,
      performance_context: renderPerformanceContext(ctx.performanceContext),
    },
    context: {
      ...context,
      // Only the scene this shot is in, never the whole screenplay
      scenes: [scene],
      scene,
      regeneration: {
        shotId: shot.id,
        shotNumber: shot.shot_number,
        sequenceNumber: shot.sequence_number,
        reason: target.regenerate.reason,
        currentPlan: {
          description: shot.scene_description,
          prompt: shot.prompt,
          durationSeconds: shot.duration_seconds,
          cameraDirection: shot.camera_direction,
          transitionType: shot.transition_type,
          firstFrameDescription: shot.first_frame_description,
          lastFrameDescription: shot.last_frame_description,
        },
        shotBefore: neighbours.before?.scene_description ?? null,
        shotAfter: neighbours.after?.scene_description ?? null,
      },
    },
    outputSchema: RegeneratedShotPartOutputSchema,
    constraints: {
      kind: 'shot',
      shotId: shot.id,
      sceneNumber: scene.number,
      shotsPerPart: 1,
      shotDuration: target.shotDuration,
      shotDurationLimits: SHOT_DURATION_LIMITS,
      characters: episode.context.characterNames ?? [],
      locations: sceneLocations(scene, episode.context.locationNames ?? []),
      veoComponents: [...VEO_COMPONENTS, 'timeline', 'avoid'],
    },
    targetVersion: episode.version,
    rubricVariables: {
      context_hint: `Re-plan of one shot in scene ${scene.number}`,
    },
  });

  // The prompt file's example is a whole scene: the wrong shape here
  return {
    ...brief,
    instructions: `${brief.instructions}\n\n${note}`,
    example: undefined,
  };
}

function checkRegeneratedShot(
  target: ShotsTarget,
  episode: ShotsEpisode,
  shots: RegeneratingShot[],
  out: ShotsPartOutput,
  part: PartSpec,
): CheckError[] {
  const shotId = shotIdOfPart(part.key);
  const shot = shots.find((row) => row.id === shotId);

  if (!shot) {
    return [
      {
        path: '',
        code: 'unknown_part',
        message: `${part.key} is not a shot this run re-plans`,
      },
    ];
  }

  if (out.kind !== 'shot') {
    return [
      {
        path: 'kind',
        code: 'wrong_part',
        message: `Part ${part.key} takes one re-planned shot (kind: 'shot')`,
      },
    ];
  }

  const errors: CheckError[] = [];

  if (out.shotId !== shot.id) {
    errors.push({
      path: 'shotId',
      code: 'wrong_shot',
      message: `This part re-plans shot ${shot.id}, not ${out.shotId}`,
    });
  }

  const sceneNumber = shot.scene_number ?? 0;
  const { kind: _kind, shotId: _shotId, ...sceneShot } = out;

  return [
    ...errors,
    ...checkScenePart(
      target,
      episode,
      {
        kind: 'scene',
        sceneNumber,
        shots: [sceneShot],
        sceneSummary: '',
        sceneViralScore: 1,
      },
      sceneNumber,
    ).map((error) => ({
      ...error,
      path: error.path.replace(/^shots\.0\.?/, ''),
    })),
  ];
}

/**
 * Rewrites each listed shot's plan in place, keeping its id, scene,
 * numbers, status and media (the caller already queued it and cleared its
 * video), merges the new prompt into its metadata beside the regeneration
 * record, and touches the episode so its version moves and the Studio's
 * package etag with it. No audio pass follows: the cues stand.
 */
async function commitRegeneratedShots(
  ctx: Ctx,
  run: GenerationRun,
  target: ShotsTarget & { regenerate: ShotsRegeneration },
  outputs: ShotsPartOutput[],
): Promise<CommitResult<ShotsCommitData>> {
  const shots = outputs.filter(
    (out): out is RegeneratedShotPartOutput => out.kind === 'shot',
  );
  const now = new Date().toISOString();

  const updates = shots.map((shot) => ({
    op: 'update' as const,
    table: 'shots' as const,
    values: {
      scene_description: shot.description,
      prompt: shot.veoPrompt.fullPrompt || shot.description,
      duration_seconds: wholeShotSeconds(shot.duration),
      camera_direction: shot.cameraDirection ?? null,
      transition_type: shot.transitionType ?? null,
      frame_strategy: shot.frameStrategy ?? null,
      primary_subject: (shot.primarySubject as Json | undefined) ?? null,
      first_frame_description: shot.firstFrameDescription ?? null,
      last_frame_description: shot.lastFrameDescription ?? null,
      location_area: shot.locationArea ?? null,
      location_environment_description:
        shot.locationEnvironmentDescription ?? null,
      generation_metadata: {
        shotType: shot.shotType,
        location: shot.metadata.location,
        timeOfDay: shot.metadata.timeOfDay,
        mood: shot.metadata.mood,
        characters: shot.characters ?? [],
        veoPrompt: shot.veoPrompt,
        replannedAt: now,
        replannedByRunId: run.id ?? null,
      } as Json,
      ...(ctx.originColumnsAvailable ? { generation_origin: run.origin } : {}),
    },
    // Merged, so the regeneration record the opener wrote stays beside it
    merge: ['generation_metadata'],
    match: [
      eq('id', shot.shotId),
      eq('episode_id', target.episodeId),
      is('deleted_at', null),
    ],
    requireRows: true,
  }));

  await applyCommit(ctx, {
    ops: [
      ...updates,
      {
        op: 'update',
        table: 'episodes',
        values: { updated_at: now },
        match: [eq('id', target.episodeId), is('deleted_at', null)],
        requireRows: true,
      },
    ],
  });

  logTo(ctx)(
    `[Shot Regeneration] ${shots.length} shot(s) re-planned in episode ${target.episodeId}: ${target.regenerate.reason}`,
  );

  return {
    status: 'committed',
    data: {
      totalShots: shots.length,
      shotsCreated: 0,
      metadata: {
        totalDuration: shots.reduce((sum, shot) => sum + shot.duration, 0),
        shotTypes: { wide: 0, medium: 0, closeUp: 0 },
        scenesProcessed: 0,
      },
      reelCandidateScenes: [],
      regeneratedShotIds: shots.map((shot) => shot.shotId),
    },
  };
}

function isRegeneration(
  target: ShotsTarget,
): target is ShotsTarget & { regenerate: ShotsRegeneration } {
  return target.regenerate !== undefined;
}

export const shotsStage: StageDefinition<
  ShotsTarget,
  ShotsPartOutput,
  ShotsCommitData
> = {
  key: 'shots',
  targetType: 'episode',
  targetSchema: ShotsTargetSchema,
  outputSchema: ShotsPartOutputSchema,
  orchestrated: true,
  jobTracking: {
    jobType: 'shot_list',
    reference: (target) => ({ type: 'episode', id: target.episodeId }),
  },

  async parts(ctx, target) {
    if (isRegeneration(target)) {
      return regenerationParts(await loadRegeneratingShots(ctx, target));
    }

    const episode = await loadShotsEpisode(ctx, target);

    return partsFor(episode.scenes);
  },

  async prepare(ctx, target, part, earlier) {
    if (isRegeneration(target)) {
      return prepareRegeneratedShot(ctx, target, part);
    }

    const episode = await loadShotsEpisode(ctx, target);
    const context = shotsContext(episode, target);
    const sceneNumbers = episode.scenes.map((s) => s.number);

    if (part.key === REEL_SCOUT_PART) {
      return buildBrief({
        stage: 'shots',
        part,
        prompt: reelScoutPrompt as PromptFile,
        variables: {
          episode_title: episode.title,
          genre: context.genre,
          total_scene_count: episode.scenes.length,
          scenes_json: JSON.stringify(episode.scenes),
        },
        context,
        outputSchema: ReelScoutPartOutputSchema,
        constraints: {
          kind: 'reel_scout',
          sceneNumbers,
          viralScore: 'a number from 1 to 10 per scene',
        },
        targetVersion: episode.version,
        rubricVariables: {},
      });
    }

    const sceneNumber = sceneNumberOfPart(part.key);
    const scene = episode.scenes.find((s) => s.number === sceneNumber);

    if (!scene) {
      throw new Error(`Part ${part.key} names no scene of this episode`);
    }

    // The Reel Scout's priority reaches the model for the scenes it flagged
    // (KB-178, owner 2026-10-03): the reel_scout part runs first, so a scene
    // part reads its accepted output from `earlier`
    const reelScout = earlier?.find(
      (out): out is ReelScoutPartOutput => out.kind === 'reel_scout',
    );
    const reelNote = reelNoteFor(
      scene.number,
      reelScout?.topReelCandidates ?? [],
    );

    return buildBrief({
      stage: 'shots',
      part,
      prompt: sceneShotPrompt as PromptFile,
      variables: {
        scene_number: scene.number,
        total_scenes: episode.scenes.length,
        scene_content: JSON.stringify({
          number: scene.number,
          heading: scene.heading,
          location: scene.location,
          timeOfDay: scene.timeOfDay,
          description: scene.description,
          action: scene.action,
          dialogue: scene.dialogue,
        }),
        episode_metadata: JSON.stringify({
          title: episode.title,
          genre: context.genre,
          targetAudience: context.targetAudience,
          visualStyle: context.visualStyle,
          tone: 'balanced',
        }),
        characters: context.charactersVeo || 'No characters defined.',
        locations: context.locationsVeo || 'No locations defined.',
        previous_scene_summary: '',
        reel_note: reelNote,
        recurring_element: context.recurringElements,
        shot_duration_min: target.shotDuration.min,
        shot_duration_max: target.shotDuration.max,
        performance_context: renderPerformanceContext(ctx.performanceContext),
      },
      context: {
        ...context,
        scene,
        reelNote,
        ...(ctx.performanceContext
          ? { performanceContext: ctx.performanceContext }
          : {}),
      },
      outputSchema: SceneShotsPartOutputSchema,
      constraints: {
        kind: 'scene',
        sceneNumber: scene.number,
        shotDuration: target.shotDuration,
        shotDurationLimits: SHOT_DURATION_LIMITS,
        shotsPerScene: { min: 1, max: SHOTS_PER_SCENE_MAX },
        totalShotsForEpisode: episode.shotCountBounds,
        characters: episode.context.characterNames ?? [],
        locations: sceneLocations(scene, episode.context.locationNames ?? []),
        veoComponents: [...VEO_COMPONENTS, 'timeline', 'avoid'],
        reelPriority:
          'If the reel_scout part listed this scene in topReelCandidates, lead shot 1 with a visual hook',
      },
      targetVersion: episode.version,
      rubricVariables: {
        context_hint: `Scene ${scene.number} of ${episode.scenes.length}`,
      },
    });
  },

  async check(ctx, target, out, part) {
    const episode = await loadShotsEpisode(ctx, target);

    if (isRegeneration(target)) {
      return checkRegeneratedShot(
        target,
        episode,
        await loadRegeneratingShots(ctx, target),
        out,
        part,
      );
    }

    if (part.key === REEL_SCOUT_PART) {
      if (out.kind !== 'reel_scout') {
        return [
          {
            path: 'kind',
            code: 'wrong_part',
            message: 'The reel_scout part takes the Reel Scout analysis',
          },
        ];
      }

      return checkReelScoutPart(episode, out);
    }

    const sceneNumber = sceneNumberOfPart(part.key);

    if (sceneNumber === undefined) {
      return [
        {
          path: '',
          code: 'unknown_part',
          message: `${part.key} is not a part of the shots stage`,
        },
      ];
    }

    if (out.kind !== 'scene') {
      return [
        {
          path: 'kind',
          code: 'wrong_part',
          message: `Part ${part.key} takes that scene's shots`,
        },
      ];
    }

    return checkScenePart(target, episode, out, sceneNumber);
  },

  async commit(ctx, run, target, outputs) {
    if (isRegeneration(target)) {
      return commitRegeneratedShots(ctx, run, target, outputs);
    }

    const log = logTo(ctx);
    const episode = await loadShotsEpisode(ctx, target);
    const reelScout = outputs.find(
      (out): out is ReelScoutPartOutput => out.kind === 'reel_scout',
    );
    const sceneParts = outputs.filter(
      (out): out is SceneShotsPartOutput => out.kind === 'scene',
    );

    const { data: current } = await ctx.client
      .from('episodes')
      .select('status, deleted_at')
      .eq('id', target.episodeId)
      .single();

    if (!current || current.deleted_at) {
      log(
        '[Shot Generation] Episode was deleted during generation. Skipping write.',
      );
      await applyCommit(ctx, {
        ops: [
          jobCompletedWrite(target.episodeId, 'shot_list', {
            skipped: true,
            reason: 'episode-deleted',
          }),
        ],
      });

      return {
        status: 'skipped',
        reason: 'episode-deleted',
        data: {
          totalShots: 0,
          shotsCreated: 0,
          metadata: {
            totalDuration: 0,
            shotTypes: { wide: 0, medium: 0, closeUp: 0 },
            scenesProcessed: episode.scenes.length,
          },
          reelCandidateScenes: [],
        },
      };
    }

    const { data: existingShots } = await ctx.client
      .from('shots')
      .select('sequence_number')
      .eq('episode_id', target.episodeId)
      .is('deleted_at', null)
      .order('sequence_number', { ascending: false })
      .limit(1);

    const { rows, totalDuration, shotTypes } = buildShotRows(
      episode,
      reelScout,
      sceneParts,
      (existingShots?.[0]?.sequence_number ?? 0) + 1,
    );

    if (rows.length === 0) {
      throw new Error('No shots were generated');
    }

    const expectedMin = episode.scenes.length * 2;
    const expectedMax = episode.scenes.length * SHOTS_PER_SCENE_MAX;

    if (rows.length < expectedMin || rows.length > expectedMax) {
      log(
        `[Shot Generation] ${rows.length} shots for ${episode.scenes.length} scenes ` +
          `(expected ${expectedMin}–${expectedMax}; the episode's duration suggests ` +
          `${episode.shotCountBounds.totalShotsMin}–${episode.shotCountBounds.totalShotsMax}). Episode: ${target.episodeId}`,
      );
    }

    const stamped = ctx.originColumnsAvailable
      ? rows.map(
          (row) => ({ ...row, generation_origin: run.origin }) as ShotRow,
        )
      : rows;

    const shotList = {
      generatedAt: new Date().toISOString(),
      totalShots: rows.length,
      totalDuration,
      shotTypes,
      scenesProcessed: episode.scenes.length,
      processingMethod: 'shot-orchestrator',
    };

    // One transaction under a run, with the content_revisions snapshot of
    // the shot list, shots and cues it replaces. Clear, then insert, so a
    // re-run does not stack duplicate shots; cues and tracks were cut for
    // the old shots and go with them. A failed clear now fails the commit
    // instead of leaving the old shots beside the new ones.
    await applyCommit(ctx, {
      ops: [
        {
          op: 'delete',
          table: 'audio_cues',
          match: [eq('episode_id', target.episodeId)],
        },
        {
          op: 'delete',
          table: 'audio_tracks',
          match: [eq('episode_id', target.episodeId)],
        },
        {
          op: 'delete',
          table: 'shots',
          match: [eq('episode_id', target.episodeId)],
        },
        { op: 'insert', table: 'shots', rows: stamped },
        {
          op: 'update',
          table: 'episodes',
          values: {
            shot_list: shotList,
            updated_at: new Date().toISOString(),
          },
          // No version check: the version may move while the orchestrator runs
          match: [eq('id', target.episodeId), is('deleted_at', null)],
        },
        jobCompletedWrite(target.episodeId, 'shot_list', {
          totalShots: rows.length,
          scenesProcessed: episode.scenes.length,
          totalDuration,
        }),
      ],
    });

    const reelCandidateScenes = reelScout?.topReelCandidates ?? [];

    log(
      `[Shot Generation] ${rows.length} shots across ${episode.scenes.length} scenes. ` +
        `Reel candidates: ${reelCandidateScenes.join(', ') || 'none'}`,
    );

    const result: CommitResult<ShotsCommitData> = {
      status: 'committed',
      data: {
        totalShots: rows.length,
        shotsCreated: rows.length,
        metadata: {
          totalDuration,
          shotTypes,
          scenesProcessed: episode.scenes.length,
        },
        reelCandidateScenes,
      },
      // The dedicated audio pass follows every shot list, as a child run in
      // the run's mode (FILM-1903)
      followOns: [
        {
          stage: 'audio_cues',
          target: {
            type: 'episode',
            id: target.episodeId,
            projectId: target.projectId,
            input: {
              kind: 'stage',
              target: {
                episodeId: target.episodeId,
                projectId: target.projectId,
                accountId: target.accountId,
                userId: target.userId,
              } satisfies AudioCuesTarget,
            },
          },
        },
      ],
    };

    return result;
  },
};

registerStage(shotsStage);
