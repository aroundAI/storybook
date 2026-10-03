import 'server-only';

import {
  type CheckError,
  type Ctx,
  type EpisodeContextLoader,
  type GenerationOrigin,
  type PartSpec,
  type ScreenplayScene,
  ScreenplaySceneSchema,
  ShotsTargetSchema,
  loadScreenplayInputs,
  scenePartKey,
  screenplayStage,
  shotsStage,
} from '@kit/generation';
import { SHOT_DURATION_LIMITS } from '@kit/prompt-engine/llm-job-payloads';
import { type SceneShot, SceneShotSchema } from '@kit/prompt-engine/schemas';
import { fetchAllRows } from '@kit/shared/pagination';

import { McpToolError } from '../../../errors';
import { type McpToolContext, defineTool } from '../../../registry';
import { type EpisodeRef, requireEpisodeInAccount } from '../read/scope';
import { compact, parseWith, refused } from '../validation';
import {
  type EditPlan,
  type EditStage,
  type ScreenplayDataLike,
  type StoredDialogueLine,
  planLineEdit,
  planSceneEdit,
  planShotEdit,
  sceneLines,
} from './plan';
import {
  EditDialogueLineInput,
  EditSceneInput,
  EditShotInput,
} from './schemas';

type Client = McpToolContext['principal']['supabase'];

/**
 * What applies an edit's plan. After FILM-1903's run layer and
 * `apply_generation_commit` (#567, #574) it opens an external run for the
 * stage on the episode at `targetVersion` and applies the plan in one
 * transaction, which re-checks the version, snapshots into
 * content_revisions and commits the run. Throws McpToolError
 * TARGET_CHANGED when the episode moved.
 */
export interface EditWriter {
  commit(
    request: EditCommitRequest,
    context: McpToolContext,
  ): Promise<EditCommitResult>;
}

export interface EditCommitRequest {
  stage: EditStage;
  /** The tool, recorded as the run's origin name */
  tool: 'edit_scene' | 'edit_shot' | 'edit_dialogue_line';
  accountId: string;
  projectId: string;
  episodeId: string;
  targetVersion: number;
  origin: GenerationOrigin;
  /** The writes, given the origin they stamp (with the run's id once open) */
  plan(origin: GenerationOrigin): EditPlan;
}

export interface EditCommitResult {
  /** The episode's version after the edit */
  version: number;
  runId: string | null;
  revisionId: string | null;
}

export interface EditToolDeps {
  writer: EditWriter;
  /** The worker's episode context loader, as the generation tools take it */
  episodeContext?: (client: Client) => EpisodeContextLoader;
  now?: () => Date;
}

const EDIT = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: true,
} as const;

type EditableEpisode = EpisodeRef & {
  version: number;
  screenplay_data: ScreenplayDataLike | null;
};

async function requireEpisodeAtVersion(
  context: McpToolContext,
  episodeId: string,
  version: number,
): Promise<EditableEpisode> {
  const episode = await requireEpisodeInAccount<EditableEpisode>(
    context.principal.supabase,
    context.accountId,
    episodeId,
    'id, version, screenplay_data',
  );

  if (episode.version !== version) {
    throw targetChanged(episodeId, version, episode.version);
  }

  return episode;
}

export function targetChanged(
  episodeId: string,
  version: number,
  currentVersion?: number,
) {
  return new McpToolError(
    'TARGET_CHANGED',
    'The episode changed since you read it. Call get_episode and retry with the new version.',
    {
      details: {
        episodeId,
        version,
        ...(currentVersion !== undefined ? { currentVersion } : {}),
      },
    },
  );
}

function rejected(errors: CheckError[]) {
  return new McpToolError('VALIDATION_FAILED', 'The edit was refused.', {
    details: { errors },
  });
}

function storedScenes(episode: EditableEpisode) {
  return (episode.screenplay_data?.scenes ?? []) as Array<
    Partial<ScreenplayScene>
  >;
}

function requireScene(episode: EditableEpisode, sceneNumber: number) {
  const scenes = storedScenes(episode);
  const scene = scenes.find((s) => s.number === sceneNumber);

  if (!scene) {
    throw new McpToolError(
      'NOT_FOUND',
      scenes.length === 0
        ? 'The episode has no screenplay yet.'
        : `The screenplay has no scene ${sceneNumber}.`,
      { details: { episodeId: episode.id, sceneNumber } },
    );
  }

  return { scene, total: scenes.length };
}

function scenePart(sceneNumber: number, total: number): PartSpec {
  return {
    key: `scene-${sceneNumber}`,
    index: sceneNumber - 1,
    total,
    label: `Scene ${sceneNumber} of ${total}`,
  };
}

function editOrigin(context: McpToolContext, now: Date): GenerationOrigin {
  return {
    kind: 'external',
    clientName: context.principal.clientName,
    at: now.toISOString(),
  };
}

function stageCtx(context: McpToolContext, deps: EditToolDeps): Ctx {
  const client = context.principal.supabase;

  return {
    client,
    accountId: context.accountId,
    userId: context.principal.userId,
    episodeContext: deps.episodeContext?.(client),
  };
}

/** The scene, validated as a screenplay part for its own number. */
async function checkScene(
  ctx: Ctx,
  episodeId: string,
  candidate: unknown,
  total: number,
  declared: { newCharacters?: string[]; newLocations?: string[] },
): Promise<ScreenplayScene> {
  const parsed = ScreenplaySceneSchema.safeParse(candidate);

  if (!parsed.success) {
    throw rejected(
      parsed.error.issues.map((issue) => ({
        path: ['scenes', 0, ...issue.path].join('.'),
        code: issue.code,
        message: issue.message,
      })),
    );
  }

  const errors = await screenplayStage.check(
    ctx,
    { episodeId },
    { scenes: [parsed.data], ...declared },
    scenePart(parsed.data.number, total),
  );

  if (errors.length > 0) throw rejected(errors);

  return parsed.data;
}

async function readLines(client: Client, episodeId: string) {
  return fetchAllRows<StoredDialogueLine>(
    (from, to) =>
      client
        .from('dialogue_lines')
        .select(
          'id, scene_number, sequence_number, language, text, character_asset_id, audio_url',
        )
        .eq('episode_id', episodeId)
        .order('id')
        .range(from, to) as unknown as PromiseLike<{
        data: StoredDialogueLine[] | null;
        error: { message: string } | null;
      }>,
    'dialogue_lines',
  );
}

function committed(result: EditCommitResult) {
  return {
    version: result.version,
    runId: result.runId,
    revisionId: result.revisionId,
  };
}

interface StoredShotRow {
  id: string;
  scene_number: number | null;
  shot_number: number | null;
  sequence_number: number;
  scene_description: string | null;
  duration_seconds: number;
  camera_direction: string | null;
  generation_metadata: Record<string, unknown> | null;
  transition_type: string | null;
  frame_strategy: string | null;
  primary_subject: unknown;
  first_frame_description: string | null;
  last_frame_description: string | null;
  location_area: string | null;
  location_environment_description: string | null;
}

/** A stored row as the shot the Shot Director wrote. */
function storedShot(row: StoredShotRow): Record<string, unknown> {
  const metadata = row.generation_metadata ?? {};

  return compact({
    shotNumber: row.shot_number ?? row.sequence_number,
    shotType: metadata.shotType,
    cameraDirection: row.camera_direction ?? undefined,
    description: row.scene_description ?? '',
    characters: metadata.characters ?? [],
    duration: row.duration_seconds,
    transitionType: row.transition_type ?? undefined,
    frameStrategy: row.frame_strategy ?? undefined,
    primarySubject: row.primary_subject ?? undefined,
    firstFrameDescription: row.first_frame_description,
    lastFrameDescription: row.last_frame_description,
    locationArea: row.location_area,
    locationEnvironmentDescription: row.location_environment_description,
    veoPrompt: metadata.veoPrompt,
    metadata: compact({
      location: metadata.location,
      timeOfDay: metadata.timeOfDay,
      mood: metadata.mood,
    }),
  });
}

export function createEditTools(resolveDeps: () => EditToolDeps) {
  const editSceneTool = defineTool({
    name: 'edit_scene',
    title: 'Edit scene',
    description:
      'Changes one screenplay scene: heading, location, time of day, description, action, estimated duration, or its whole dialogue. The edited scene is checked as the screenplay stage checks a generated one (known speakers and locations or declared new ones, no empty line, length caps), versioned on the episode (TARGET_CHANGED if it moved), snapshotted so it can be restored, and stamped as written over MCP. Dialogue rows follow: see the dialogue argument.',
    inputSchema: EditSceneInput,
    scope: 'studio:write',
    annotations: EDIT,
    async handler(input, context) {
      const deps = resolveDeps();
      const now = (deps.now ?? (() => new Date()))();
      const episode = await requireEpisodeAtVersion(
        context,
        input.episodeId,
        input.version,
      );
      const { scene: before, total } = requireScene(episode, input.sceneNumber);
      const origin = editOrigin(context, now);
      const ctx = stageCtx(context, deps);

      const {
        episodeId,
        version,
        sceneNumber,
        newCharacters,
        newLocations,
        ...patch
      } = input;
      const changes = compact(patch);

      if (Object.keys(changes).length === 0) {
        throw refused('Give at least one field of the scene to change.');
      }

      const after = await checkScene(
        ctx,
        episodeId,
        {
          ...before,
          ...changes,
          number: sceneNumber,
          generationOrigin: origin,
        },
        total,
        { newCharacters, newLocations },
      );

      const inputs = await loadScreenplayInputs(ctx, { episodeId });
      const lines = changes.dialogue
        ? await readLines(ctx.client, episodeId)
        : [];
      const sceneEdit = (stamp: GenerationOrigin) =>
        planSceneEdit({
          episodeId,
          screenplay: episode.screenplay_data ?? {},
          before,
          after: { ...after, generationOrigin: stamp },
          lines,
          characters: inputs.characters,
          origin: stamp,
          editedAt: now.toISOString(),
        });
      const { dialogue } = sceneEdit(origin);

      const result = await deps.writer.commit(
        {
          stage: 'screenplay_refinement',
          tool: 'edit_scene',
          accountId: context.accountId,
          projectId: episode.project.id,
          episodeId,
          targetVersion: version,
          origin,
          plan: (stamp) => sceneEdit(stamp).plan,
        },
        context,
      );

      return {
        text: `Scene ${sceneNumber} updated; the episode is at version ${result.version}.${dialogue.mode === 'rebuilt' ? ` Dialogue rebuilt: ${dialogue.linesWritten} lines, ${dialogue.voiceRendersInvalidated} voice renders and ${dialogue.translationsRemoved} translated lines dropped.` : ''}`,
        structuredContent: {
          episodeId,
          sceneNumber,
          scene: after,
          dialogue,
          ...committed(result),
        },
      };
    },
  });

  const editDialogueLineTool = defineTool({
    name: 'edit_dialogue_line',
    title: 'Edit dialogue line',
    description:
      "Changes one English dialogue line's text, speaker or parenthetical, in the screenplay and in the line's row together. The scene is re-checked as the screenplay stage checks it; a line that had a voice render goes back to pending. Versioned on the episode (TARGET_CHANGED), snapshotted, stamped as written over MCP. Translated lines are rewritten by the dialogue_translation stage, not here.",
    inputSchema: EditDialogueLineInput,
    scope: 'studio:write',
    annotations: EDIT,
    async handler(input, context) {
      const deps = resolveDeps();
      const now = (deps.now ?? (() => new Date()))();
      const episode = await requireEpisodeAtVersion(
        context,
        input.episodeId,
        input.version,
      );
      const ctx = stageCtx(context, deps);

      if (
        input.text === undefined &&
        input.character === undefined &&
        input.parenthetical === undefined
      ) {
        throw refused('Give the text, speaker or parenthetical to change.');
      }

      const lines = await readLines(ctx.client, input.episodeId);
      const row = lines.find((line) => line.id === input.dialogueLineId);

      if (!row) {
        throw new McpToolError(
          'NOT_FOUND',
          'No dialogue line with this id in the episode.',
          { details: { dialogueLineId: input.dialogueLineId } },
        );
      }

      if (row.language !== 'en') {
        throw refused(
          'This is a translated line; edit the English line, then run dialogue_translation again.',
          'dialogueLineId',
        );
      }

      const sceneNumber = row.scene_number ?? 0;
      const { scene, total } = requireScene(episode, sceneNumber);
      const rows = sceneLines(lines, sceneNumber);
      const index = rows.findIndex((r) => r.id === row.id);
      const stored = scene.dialogue ?? [];

      if (rows.length !== stored.length || stored[index]?.text !== row.text) {
        throw refused(
          `Scene ${sceneNumber}'s dialogue rows no longer match its screenplay; rewrite the scene with edit_scene.`,
          'dialogueLineId',
        );
      }

      const line = {
        ...stored[index]!,
        ...compact({ text: input.text, character: input.character }),
        ...(input.parenthetical !== undefined
          ? { parenthetical: input.parenthetical }
          : {}),
      };
      const origin = editOrigin(context, now);
      const after = await checkScene(
        ctx,
        input.episodeId,
        {
          ...scene,
          dialogue: stored.map((l, i) => (i === index ? line : l)),
          generationOrigin: origin,
        },
        total,
        {},
      );
      const inputs = await loadScreenplayInputs(ctx, {
        episodeId: input.episodeId,
      });

      const result = await deps.writer.commit(
        {
          stage: 'screenplay_refinement',
          tool: 'edit_dialogue_line',
          accountId: context.accountId,
          projectId: episode.project.id,
          episodeId: input.episodeId,
          targetVersion: input.version,
          origin,
          plan: (stamp) =>
            planLineEdit({
              episodeId: input.episodeId,
              screenplay: episode.screenplay_data ?? {},
              scene: { ...after, generationOrigin: stamp },
              row,
              line: { character: line.character, text: line.text },
              characters: inputs.characters,
              origin: stamp,
              editedAt: now.toISOString(),
            }),
        },
        context,
      );

      return {
        text: `Line ${row.sequence_number} (scene ${sceneNumber}) updated${row.audio_url ? '; its voice render is pending again' : ''}. The episode is at version ${result.version}.`,
        structuredContent: {
          episodeId: input.episodeId,
          dialogueLineId: row.id,
          sceneNumber,
          line,
          voiceRenderInvalidated: Boolean(row.audio_url),
          ...committed(result),
        },
      };
    },
  });

  const editShotTool = defineTool({
    name: 'edit_shot',
    title: 'Edit shot',
    description: `Changes one shot: description, duration (${SHOT_DURATION_LIMITS.min}-${SHOT_DURATION_LIMITS.max} s), shot type, camera, characters, location, time of day, mood, transition, frame strategy and descriptions, or any VEO prompt component. The edited shot is checked as the shots stage checks a generated one (known characters and locations, every VEO component present, a negative prompt), versioned on the episode (TARGET_CHANGED), snapshotted, stamped as written over MCP. The shot keeps its id, place, status and rendered media.`,
    inputSchema: EditShotInput,
    scope: 'studio:write',
    annotations: EDIT,
    async handler(input, context) {
      const deps = resolveDeps();
      const now = (deps.now ?? (() => new Date()))();
      const episode = await requireEpisodeAtVersion(
        context,
        input.episodeId,
        input.version,
      );
      const ctx = stageCtx(context, deps);

      const { data: row, error } = await ctx.client
        .from('shots')
        .select(
          'id, scene_number, shot_number, sequence_number, scene_description, duration_seconds, camera_direction, generation_metadata, transition_type, frame_strategy, primary_subject, first_frame_description, last_frame_description, location_area, location_environment_description',
        )
        .eq('id', input.shotId)
        .eq('episode_id', input.episodeId)
        .is('deleted_at', null)
        .maybeSingle();

      if (error) {
        throw new McpToolError('INTERNAL', 'Could not read the shot.');
      }

      if (!row) {
        throw new McpToolError(
          'NOT_FOUND',
          'No shot with this id in the episode.',
          { details: { shotId: input.shotId } },
        );
      }

      const stored = row as unknown as StoredShotRow;
      const base = storedShot(stored);
      const patch = compact({
        description: input.description,
        duration: input.durationSeconds,
        shotType: input.shotType,
        cameraDirection: input.cameraDirection,
        characters: input.characters,
        transitionType: input.transitionType,
        frameStrategy: input.frameStrategy,
        primarySubject: input.primarySubject,
        firstFrameDescription: input.firstFrameDescription,
        lastFrameDescription: input.lastFrameDescription,
        locationArea: input.locationArea,
        locationEnvironmentDescription: input.locationEnvironmentDescription,
      });
      const metadataPatch = compact({
        location: input.location,
        timeOfDay: input.timeOfDay,
        mood: input.mood,
      });

      if (
        Object.keys(patch).length === 0 &&
        Object.keys(metadataPatch).length === 0 &&
        !input.veoPrompt
      ) {
        throw refused('Give at least one field of the shot to change.');
      }

      const shot: SceneShot = parseWith(SceneShotSchema, {
        ...base,
        ...patch,
        metadata: { ...(base.metadata as object), ...metadataPatch },
        veoPrompt: {
          ...((base.veoPrompt as object | undefined) ?? {}),
          ...compact(input.veoPrompt ?? {}),
        },
      });

      const sceneNumber = stored.scene_number ?? 1;
      const scenes = storedScenes(episode);
      const target = ShotsTargetSchema.parse({
        episodeId: input.episodeId,
        projectId: episode.project.id,
        accountId: context.accountId,
        userId: context.principal.userId,
        shotDuration: { ...SHOT_DURATION_LIMITS },
      });
      const errors = await shotsStage.check(
        ctx,
        target,
        {
          kind: 'scene',
          sceneNumber,
          shots: [shot],
          sceneSummary: '',
          sceneViralScore: 1,
        },
        {
          key: scenePartKey(sceneNumber),
          index: scenes.findIndex((s) => s.number === sceneNumber) + 1,
          total: scenes.length + 1,
          label: `Scene ${sceneNumber}`,
        },
      );

      if (errors.length > 0) throw rejected(errors);

      const origin = editOrigin(context, now);
      const result = await deps.writer.commit(
        {
          stage: 'shots',
          tool: 'edit_shot',
          accountId: context.accountId,
          projectId: episode.project.id,
          episodeId: input.episodeId,
          targetVersion: input.version,
          origin,
          plan: (stamp) =>
            planShotEdit({
              episodeId: input.episodeId,
              shotId: input.shotId,
              shot,
              storedMetadata: stored.generation_metadata ?? {},
              origin: stamp,
              editedAt: now.toISOString(),
            }),
        },
        context,
      );

      return {
        text: `Shot ${stored.shot_number ?? stored.sequence_number} (scene ${sceneNumber}) updated; the episode is at version ${result.version}.`,
        structuredContent: {
          episodeId: input.episodeId,
          shotId: input.shotId,
          sceneNumber,
          shot,
          ...committed(result),
        },
      };
    },
  });

  return { editSceneTool, editDialogueLineTool, editShotTool };
}
