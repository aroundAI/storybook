/**
 * The `screenplay` stage (FILM-1901): a story becomes scenes with dialogue.
 *
 * Parts: one per planned scene (the story's estimated scene count, held to
 * the duration's range), then finalize. A part carries the scenes it
 * covers, so an external writer submits one scene per part while the
 * server orchestrator, which writes the whole screenplay in one pass, lays
 * its scenes across the parts. Commit flattens them in order.
 *
 * Commit owns what `handlers/screenplay-conversion.ts` wrote: episodes
 * .screenplay_data, status `storyboard`, the dialogue_lines rebuild and the
 * generation_jobs bookkeeping.
 */
import { z } from 'zod';

import screenplayConversion from '@kit/prompt-engine/prompts/story-generation/screenplay-conversion.json';
import { DialogueLineSchema, SceneSchema } from '@kit/prompt-engine/schemas';
import {
  type ContentScalingResult,
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
import { StageOutputRejected } from '../checks';
import { applyCommit, eq, is } from '../commit-plan';
import { jobCompletedWrite } from '../jobs';
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
import { mergeCharacterArcs } from './shared/character-arcs';
import {
  characterIdMap,
  dialogueRowsFromScenes,
  dialogueRebuildSteps,
} from './shared/dialogue-lines';
import { memoised } from './shared/memo';
import { checkSceneNumbering, checkScenes } from './shared/scene-checks';

const LOG = '[Screenplay Conversion]';

// ---------------------------------------------------------------------------
// Target and output
// ---------------------------------------------------------------------------

/** The episode, and the style choices the `screenplay-conversion` job carries. */
export const ScreenplayTargetSchema = z.object({
  episodeId: z.string().uuid(),
  dialogueStyle: z.string().optional(),
  contentStyle: z.string().optional(),
});
export type ScreenplayTarget = z.infer<typeof ScreenplayTargetSchema>;

export const ScreenplayAudioCueSchema = z.object({
  type: z.enum(['sfx', 'ambient', 'music']),
  prompt: z.string(),
  startOffset: z.number(),
  duration: z.number(),
  isLoopable: z.boolean().optional(),
});

/**
 * One scene as the screenplay-conversion prompt defines it, plus the fields
 * the orchestrator's scenes carry. `passthrough` keeps anything else the
 * model adds: the handler stored scenes as returned, and so does commit.
 */
export const ScreenplaySceneSchema = SceneSchema.extend({
  dialogue: z.array(DialogueLineSchema.passthrough()),
  action: z.array(z.string()).optional(),
  transitions: z.string().optional(),
  audioCues: z.array(ScreenplayAudioCueSchema.passthrough()).optional(),
  emotionalPeak: z.string().optional(),
  hookOut: z.string().optional(),
}).passthrough();
export type ScreenplayScene = z.infer<typeof ScreenplaySceneSchema>;

/**
 * One part's output: the scenes it covers, and the speakers and locations
 * it introduces. A speaker or location that is neither one of the
 * episode's nor declared here is rejected; a declared one is auto-created
 * by the asset-creation job from `screenplay_data.metadata`, as today.
 */
export const ScreenplayPartOutputSchema = z.object({
  scenes: z.array(ScreenplaySceneSchema),
  newCharacters: z.array(z.string()).optional(),
  newLocations: z.array(z.string()).optional(),
});
export type ScreenplayPartOutput = z.infer<typeof ScreenplayPartOutputSchema>;

// ---------------------------------------------------------------------------
// Inputs (what the handler read before calling the orchestrator)
// ---------------------------------------------------------------------------

const actBreakdownSchema = z
  .object({ act1: z.string(), act2: z.string(), act3: z.string() })
  .catch({ act1: '', act2: '', act3: '' });

const storyCharacterSchema = z
  .array(z.object({ name: z.string(), role: z.string(), arc: z.string() }))
  .catch([]);

export interface ScreenplayInputs {
  episode: {
    id: string;
    number: number;
    title: string;
    version: number;
    status: string;
    screenplayData: unknown;
  };
  /** The title, defused for a prompt */
  promptTitle: string;
  project: { id: string | null; genre: string; targetAudience: string };
  storyText: string;
  actBreakdown: { act1: string; act2: string; act3: string };
  tone: string;
  themes: string[];
  keyEvents: string[];
  targetDurationSeconds: number;
  contentStyle: ContentStyle;
  scaling: ContentScalingResult['screenplay'];
  plannedScenes: number;
  characters: Array<{ id: string; name: string }>;
  locations: Array<{ id: string; name: string }>;
  /** The locked-identity block with the story's arcs merged in; '' if none */
  charactersContext: string;
  characterNames: string;
  locationNames: string;
  recurringElementsContext: string;
  directionNotes?: string;
}

function requireEpisodeContext(ctx: Ctx, stage: string) {
  if (!ctx.episodeContext) {
    throw new Error(
      `${stage} needs ctx.episodeContext (the episode context loader)`,
    );
  }

  return ctx.episodeContext;
}

function assetLists(snapshot: EpisodeContextSnapshot, stage: string) {
  if (!snapshot.characterList || !snapshot.locationList) {
    throw new Error(
      `${stage} needs characterList and locationList from the episode context loader`,
    );
  }

  return {
    characters: snapshot.characterList,
    locations: snapshot.locationList,
  };
}

export function loadScreenplayInputs(
  ctx: Ctx,
  target: ScreenplayTarget,
): Promise<ScreenplayInputs> {
  return memoised(ctx, `screenplay:${target.episodeId}`, async () => {
    const { data: episode, error: episodeError } = await ctx.client
      .from('episodes')
      .select(
        `
            id, number, title, version, status, story_data, screenplay_data, target_duration_seconds,
            project:projects(id, account_id, metadata)
        `,
      )
      .eq('id', target.episodeId)
      .single()
      // Many-to-one embed: an object, not the array the untyped client infers.
      .overrideTypes<{
        project: { id: string; account_id: string; metadata: unknown } | null;
      }>();

    if (episodeError || !episode) {
      throw new Error(whyNoRow(episodeError, 'Episode not found'));
    }

    // Read for the model only (commit never writes story_data back):
    // defused once, here (KB-101)
    const storyData = sanitizeStrings(
      episode.story_data as Record<string, unknown> | null,
    );

    if (!storyData?.fullStory) {
      throw new Error('Episode must have a story generated first');
    }

    const snapshot = await requireEpisodeContext(ctx, 'screenplay')(
      target.episodeId,
      {},
    );
    const { characters, locations } = assetLists(snapshot, 'screenplay');

    const actBreakdown = actBreakdownSchema.parse(storyData.actBreakdown);
    const tone = z.string().catch('').parse(storyData.tone);
    const themes = z.array(z.string()).catch([]).parse(storyData.themes);
    const storyCharacters = storyCharacterSchema.parse(storyData.characters);
    const keyEvents = z.array(z.string()).catch([]).parse(storyData.keyEvents);

    if (!storyData.tone || !storyData.actBreakdown) {
      console.warn(
        `${LOG} Legacy episode missing enrichment fields ` +
          `(tone: ${!!storyData.tone}, actBreakdown: ${!!storyData.actBreakdown}). ` +
          `Proceeding with available data.`,
      );
    }

    const projectMetadata = sanitizeStrings(
      (episode.project?.metadata as Record<string, unknown>) || {},
    );

    const targetDurationSeconds =
      episode.target_duration_seconds ||
      (storyData.targetDuration as number | undefined) ||
      300;
    const contentStyle = (target.contentStyle ||
      storyData.contentStyle ||
      'dialogue-heavy') as ContentStyle;

    const scaling = calculateContentScaling({
      targetDurationSeconds,
      contentStyle,
    }).screenplay;

    const estimated = z
      .number()
      .int()
      .positive()
      .catch(Math.round((scaling.sceneCountMin + scaling.sceneCountMax) / 2))
      .parse(storyData.estimatedSceneCount);
    const plannedScenes = Math.min(
      scaling.sceneCountMax,
      Math.max(scaling.sceneCountMin, estimated),
    );

    console.log(
      `${LOG} Episode context: ${characters.length} characters, ${locations.length} locations, ` +
        `enrichment: tone=${!!tone}, acts=${!!actBreakdown.act1}, themes=${themes.length}, keyEvents=${keyEvents.length}`,
    );

    return {
      episode: {
        id: episode.id,
        number: episode.number ?? 1,
        title: episode.title,
        version: episode.version,
        status: episode.status,
        screenplayData: episode.screenplay_data,
      },
      promptTitle: sanitizeForPrompt(episode.title),
      project: {
        id: episode.project?.id ?? null,
        genre: (projectMetadata.genre as string) || 'general',
        targetAudience: (projectMetadata.targetAudience as string) || 'general',
      },
      storyText: storyData.fullStory as string,
      actBreakdown,
      tone,
      themes,
      keyEvents,
      targetDurationSeconds,
      contentStyle,
      scaling,
      plannedScenes,
      characters,
      locations,
      charactersContext: mergeCharacterArcs(
        snapshot.characters,
        storyCharacters,
      ),
      characterNames:
        characters.map((c) => c.name).join(', ') || 'No characters',
      locationNames:
        locations.map((l) => l.name).join(', ') || 'Various locations',
      recurringElementsContext: snapshot.recurringElements ?? '',
      directionNotes: snapshot.seasonDirectionNotes ?? undefined,
    };
  });
}

// ---------------------------------------------------------------------------
// Prompt variables (the Screenplay Director skill renders these)
// ---------------------------------------------------------------------------

export interface ScreenplayEnrichment {
  actBreakdown: { act1: string; act2: string; act3: string };
  tone: string;
  themes: string[];
  keyEvents: string[];
}

/**
 * The enrichment blocks the screenplay-conversion prompt takes as text:
 * the prompt engine does `{{var}}` replacement only, so the conditionals
 * live here. Shared with the Screenplay Director skill.
 */
export function composeScreenplayEnrichment(enrichment: ScreenplayEnrichment) {
  return {
    tone: enrichment.tone
      ? `**Tone & Emotional Register**: ${enrichment.tone}\nAll dialogue, parentheticals, and audio cues must reflect this tone. The tone is the emotional contract with the audience — not optional.`
      : '',
    act_breakdown: enrichment.actBreakdown.act1
      ? `**Three-Act Structure** (distribute scenes proportionally):\n` +
        `- Act 1 — Setup (~25% of scenes): ${enrichment.actBreakdown.act1}\n` +
        `- Act 2 — Confrontation (~50% of scenes): ${enrichment.actBreakdown.act2}\n` +
        `- Act 3 — Resolution (~25% of scenes): ${enrichment.actBreakdown.act3}\n\n` +
        `Scene breaks MUST align with act transitions. The shift from Act 1→2 should be a clear inciting incident. The shift from Act 2→3 should be the climax or turning point.`
      : '',
    themes:
      enrichment.themes.length > 0
        ? `**Thematic Emphasis**: ${enrichment.themes.join(', ')}\n` +
          `Reinforce these themes through dialogue subtext (characters talk AROUND the theme, not ABOUT it), visual action choices, and scene-level metaphor.`
        : '',
    key_events:
      enrichment.keyEvents.length > 0
        ? `**Mandatory Plot Beats** (these events MUST appear as scenes or within scenes):\n` +
          enrichment.keyEvents.map((e) => `- ${e}`).join('\n') +
          `\nDo not omit or significantly alter these events. They are structural anchors.`
        : '',
  };
}

export interface ScreenplayPromptParams {
  storyText: string;
  charactersContext: string;
  recurringElementsContext?: string;
  characterNames: string;
  locationNames: string;
  genre: string;
  targetAudience: string;
  targetDurationSeconds: number;
  contentStyle: ContentStyle;
  sceneCountMin: number;
  sceneCountMax: number;
  dialogueLinesPerSceneMin: number;
  dialogueLinesPerSceneMax: number;
  enrichment: ScreenplayEnrichment;
}

/** Every variable of `screenplay-conversion.json`, as the skill fills it. */
export function screenplayPromptVariables(params: ScreenplayPromptParams) {
  const minutesDuration = Math.round(params.targetDurationSeconds / 60);
  const avgSceneDuration = Math.round(
    params.targetDurationSeconds /
      ((params.sceneCountMin + params.sceneCountMax) / 2),
  );

  return {
    story: params.storyText,
    characters: params.charactersContext || 'No characters defined.',
    character_names: params.characterNames,
    location_names: params.locationNames,
    target_duration: params.targetDurationSeconds,
    duration_description: `${minutesDuration} minutes`,
    content_style: params.contentStyle,
    scene_count_min: params.sceneCountMin,
    scene_count_max: params.sceneCountMax,
    avg_scene_duration: avgSceneDuration,
    dialogue_lines_per_scene_min: params.dialogueLinesPerSceneMin,
    dialogue_lines_per_scene_max: params.dialogueLinesPerSceneMax,
    total_dialogue_lines_min:
      params.sceneCountMin * params.dialogueLinesPerSceneMin,
    total_dialogue_lines_max:
      params.sceneCountMax * params.dialogueLinesPerSceneMax,
    style: params.contentStyle === 'dialogue-heavy' ? 'natural' : 'visual',
    genre: params.genre,
    target_audience: params.targetAudience,
    recurring_element: params.recurringElementsContext ?? '',
    ...composeScreenplayEnrichment(params.enrichment),
  };
}

// ---------------------------------------------------------------------------
// Stage
// ---------------------------------------------------------------------------

/** What `brief.context` holds: the orchestrator's inputs, as data. */
export type ScreenplayBriefContext = Omit<ScreenplayInputs, 'episode'> & {
  episode: Omit<ScreenplayInputs['episode'], 'screenplayData'>;
  part: PartSpec;
};

function partKey(index: number) {
  return `scene-${index + 1}`;
}

export const screenplayStage: StageDefinition<
  ScreenplayTarget,
  ScreenplayPartOutput,
  ScreenplayCommitData
> = {
  key: 'screenplay',
  targetType: 'episode',
  targetSchema: ScreenplayTargetSchema,
  outputSchema: ScreenplayPartOutputSchema,
  jobTracking: {
    jobType: 'screenplay',
    reference: (target) => ({ type: 'episode', id: target.episodeId }),
  },

  async parts(ctx, target) {
    const inputs = await loadScreenplayInputs(ctx, target);
    const total = inputs.plannedScenes;

    return Array.from({ length: total }, (_, index) => ({
      key: partKey(index),
      index,
      total,
      label: `Scene ${index + 1} of ${total}`,
    }));
  },

  async prepare(ctx, target, part): Promise<Brief> {
    const inputs = await loadScreenplayInputs(ctx, target);
    const { episode, ...rest } = inputs;
    const minutes = Math.round(inputs.targetDurationSeconds / 60);

    const context: ScreenplayBriefContext = {
      ...rest,
      episode: {
        id: episode.id,
        number: episode.number,
        title: episode.title,
        version: episode.version,
        status: episode.status,
      },
      part,
    };

    return buildBrief({
      stage: 'screenplay',
      part,
      prompt: screenplayConversion as PromptFile,
      outputSchema: ScreenplayPartOutputSchema,
      variables: screenplayPromptVariables({
        storyText: inputs.storyText,
        charactersContext: inputs.charactersContext,
        recurringElementsContext: inputs.recurringElementsContext,
        characterNames: inputs.characterNames,
        locationNames: inputs.locationNames,
        genre: inputs.project.genre,
        targetAudience: inputs.project.targetAudience,
        targetDurationSeconds: inputs.targetDurationSeconds,
        contentStyle: inputs.contentStyle,
        sceneCountMin: inputs.scaling.sceneCountMin,
        sceneCountMax: inputs.scaling.sceneCountMax,
        dialogueLinesPerSceneMin: inputs.scaling.dialogueLinesPerSceneMin,
        dialogueLinesPerSceneMax: inputs.scaling.dialogueLinesPerSceneMax,
        enrichment: {
          actBreakdown: inputs.actBreakdown,
          tone: inputs.tone,
          themes: inputs.themes,
          keyEvents: inputs.keyEvents,
        },
      }),
      context: context as unknown as Record<string, unknown>,
      constraints: {
        thisPart: `scene ${part.index + 1} of ${part.total}; its number must be ${part.index + 1}`,
        sceneCount: {
          min: inputs.scaling.sceneCountMin,
          max: inputs.scaling.sceneCountMax,
          planned: inputs.plannedScenes,
        },
        dialogueLinesPerScene: {
          min: inputs.scaling.dialogueLinesPerSceneMin,
          max: inputs.scaling.dialogueLinesPerSceneMax,
        },
        totalDialogueLines: {
          min: inputs.scaling.totalDialogueLinesMin,
          max: inputs.scaling.totalDialogueLinesMax,
        },
        characters: inputs.characters.map((c) => c.name),
        locations: inputs.locations.map((l) => l.name),
        newNamesMustBeDeclared: ['newCharacters', 'newLocations'],
        timeOfDay: SceneSchema.shape.timeOfDay.options,
        noEmptyDialogue: true,
        sceneNumbering: 'contiguous from 1',
      },
      targetVersion: inputs.episode.version,
      rubricVariables: {
        context_hint: `Episode "${inputs.promptTitle}" — target: ${minutes} minutes, genre: ${inputs.project.genre}`,
        target_scene_count: `${inputs.scaling.sceneCountMin}-${inputs.scaling.sceneCountMax} scenes for ${minutes} minutes`,
      },
    });
  },

  async check(ctx, target, out, part): Promise<CheckError[]> {
    const inputs = await loadScreenplayInputs(ctx, target);

    const errors = checkScenes(out.scenes, {
      knownCharacters: inputs.characters.map((c) => c.name),
      knownLocations: inputs.locations.map((l) => l.name),
      declaredCharacters: out.newCharacters ?? [],
      declaredLocations: out.newLocations ?? [],
      path: 'scenes',
    });

    // Part i holds scene i+1 (and, for the last part, whatever follows);
    // commit checks the whole sequence again once every part is in.
    if (out.scenes.length > 0) {
      errors.push(...checkSceneNumbering(out.scenes, 'scenes', part.index + 1));
    }

    return errors;
  },

  async commit(ctx, run, target, outputs) {
    const inputs = await loadScreenplayInputs(ctx, target);
    const scenes = outputs.flatMap((output) => output.scenes);

    if (scenes.length === 0) {
      throw new Error('Screenplay Orchestrator failed: No scenes generated');
    }

    const numbering = checkSceneNumbering(scenes, 'scenes');

    if (numbering.length > 0) {
      throw new StageOutputRejected('screenplay', 'finalize', numbering);
    }

    return commitScreenplay(ctx, run, inputs, scenes);
  },
};

export interface ScreenplayCommitData {
  skipped: boolean;
  episodeTitle: string;
  scenes: ScreenplayScene[];
  screenplayData: Record<string, unknown> | null;
  dialogueLinesCreated: number;
  totalEstimatedDuration: number;
  generatedAt: string;
  episode: { id: string; status: string; version: number };
}

async function commitScreenplay(
  ctx: Ctx,
  run: GenerationRun,
  inputs: ScreenplayInputs,
  scenes: ScreenplayScene[],
): Promise<CommitResult<ScreenplayCommitData>> {
  const episodeId = inputs.episode.id;
  const costCents = 0; // Agent orchestrator tracks cost internally
  const generatedAt = new Date().toISOString();

  const uniqueLocations = [
    ...new Set(
      scenes
        .map((scene) => scene.location)
        .filter((loc): loc is string => Boolean(loc)),
    ),
  ];

  const uniqueCharacters = [
    ...new Set(
      scenes
        .flatMap((scene) => scene.dialogue || [])
        .map((line) => line.character)
        .filter((char): char is string => Boolean(char)),
    ),
  ];

  const totalEstimatedDuration = scenes.reduce(
    (sum, scene) => sum + (scene.estimatedDuration || 0),
    0,
  );

  const screenplayData = {
    scenes,
    generatedAt,
    generatedBy: {
      model: 'screenplay-orchestrator',
      provider: 'multi-agent',
      costCents,
    },
    totalDialogueLines: scenes.flatMap((s) => s.dialogue || []).length,
    estimatedDuration: totalEstimatedDuration,
    approvedAt: null,
    // Full metadata for episode header display
    metadata: {
      locations: uniqueLocations,
      characters: uniqueCharacters,
      totalScenes: scenes.length,
      estimatedDuration: totalEstimatedDuration,
    },
  };

  // Guard: skip the write if the episode was deleted during generation
  const { data: currentEpisode } = await ctx.client
    .from('episodes')
    .select('status, deleted_at, screenplay_data')
    .eq('id', episodeId)
    .single();

  if (!currentEpisode || currentEpisode.deleted_at) {
    console.warn(
      `${LOG} Episode was deleted during generation. Skipping write.`,
    );
    await applyCommit(ctx, {
      ops: [
        jobCompletedWrite(episodeId, 'screenplay', {
          skipped: true,
          reason: 'episode-deleted',
        }),
      ],
    });

    return {
      status: 'skipped',
      reason: 'episode-deleted',
      data: {
        skipped: true,
        episodeTitle: inputs.episode.title,
        scenes: [],
        screenplayData: null,
        dialogueLinesCreated: 0,
        totalEstimatedDuration: 0,
        generatedAt,
        episode: { id: episodeId, status: 'draft', version: 0 },
      },
    };
  }

  const update: Record<string, unknown> = {
    screenplay_data: screenplayData as unknown as Json,
    status: 'storyboard',
    updated_at: new Date().toISOString(),
  };

  if (ctx.originColumnsAvailable) {
    update.generation_origin = run.origin;
  }

  const dialogueLines = dialogueRowsFromScenes(
    episodeId,
    scenes,
    characterIdMap(inputs.characters),
  );

  // One transaction under a run: the screenplay (its content_revisions
  // snapshot with it), the dialogue rebuild and the job's completion
  const applied = await applyCommit(ctx, {
    ops: [
      {
        key: 'episode',
        op: 'update',
        table: 'episodes',
        values: update,
        // NOTE: No version filter — version may drift during orchestrator mid-run writes
        match: [eq('id', episodeId), is('deleted_at', null)],
        requireRows: true,
        returning: ['id', 'status', 'version'],
      },
      ...dialogueRebuildSteps(episodeId, dialogueLines),
      jobCompletedWrite(episodeId, 'screenplay', {
        model: 'screenplay-orchestrator',
        provider: 'multi-agent',
        costCents,
        scenesCreated: scenes.length,
        dialogueLinesCreated: dialogueLines.length,
      }),
    ],
  });

  const updatedEpisode = applied.results.episode![0] as {
    id: string;
    status: string;
    version: number;
  };

  console.log(
    `${LOG} Created ${scenes.length} scenes, ${dialogueLines.length} dialogue lines`,
  );

  return {
    status: 'committed',
    data: {
      skipped: false,
      episodeTitle: inputs.episode.title,
      scenes,
      screenplayData,
      dialogueLinesCreated: dialogueLines.length,
      totalEstimatedDuration,
      generatedAt,
      episode: {
        id: updatedEpisode.id,
        status: updatedEpisode.status,
        version: updatedEpisode.version,
      },
    },
  };
}

/**
 * Lays a whole screenplay across the stage's parts: one scene per part,
 * the remainder in the last. The server orchestrator writes every scene in
 * one pass; this is how its reply becomes part outputs. Speakers and
 * locations the episode does not have are declared new, which is what the
 * handler's metadata did for them.
 */
export function splitScreenplayIntoParts(
  scenes: ScreenplayScene[],
  partCount: number,
  known: {
    characters: ReadonlyArray<string>;
    locations: ReadonlyArray<string>;
  },
): ScreenplayPartOutput[] {
  const characters = new Set(known.characters.map((n) => n.toLowerCase()));
  const locations = new Set(known.locations.map((n) => n.toLowerCase()));
  const total = Math.max(partCount, 1);

  return Array.from({ length: total }, (_, index) => {
    const slice =
      index === total - 1
        ? scenes.slice(index)
        : scenes.slice(index, index + 1);

    const newCharacters = [
      ...new Set(
        slice
          .flatMap((scene) => scene.dialogue)
          .map((line) => line.character)
          .filter((name) => name && !characters.has(name.toLowerCase())),
      ),
    ];
    const newLocations = [
      ...new Set(
        slice
          .map((scene) => scene.location)
          .filter((name) => name && !locations.has(name.toLowerCase())),
      ),
    ];

    return {
      scenes: slice,
      ...(newCharacters.length > 0 ? { newCharacters } : {}),
      ...(newLocations.length > 0 ? { newLocations } : {}),
    };
  });
}

registerStage(screenplayStage);
