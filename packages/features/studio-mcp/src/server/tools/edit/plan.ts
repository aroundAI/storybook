/**
 * FILM-1909: a targeted edit (one scene, one shot, one dialogue line) as the
 * writes it makes, in the shape of FILM-1903's commit plan (#574,
 * `packages/features/generation/src/commit-plan.ts`): `apply_generation_commit`
 * checks the run and its target version, snapshots what the plan replaces
 * into content_revisions and applies it in one transaction. Pure: nothing
 * here reads or writes the database.
 *
 * `EditPlan` is the subset of `CommitPlan` an edit uses, written out here
 * because the plan type lands with #574; once it is on main this becomes
 * `import type { CommitPlan }`, and the shapes are already assignable.
 */
import {
  type DialogueLineRow,
  type GenerationOrigin,
  type ScreenplayScene,
  characterIdMap,
  dialogueRowsFromScenes,
} from '@kit/generation';
import { wholeShotSeconds } from '@kit/prompt-engine/llm-job-payloads';
import type { SceneShot } from '@kit/prompt-engine/schemas';

export type EditTable = 'episodes' | 'shots' | 'dialogue_lines';

export type EditFilter =
  | { column: string; op: 'eq'; value: unknown }
  | { column: string; op: 'is'; value: null };

export type EditWrite =
  | {
      table: EditTable;
      op: 'update';
      key?: string;
      values: Record<string, unknown>;
      match: EditFilter[];
      requireRows?: boolean;
    }
  | { table: 'dialogue_lines'; op: 'delete'; match: EditFilter[] }
  | { table: 'dialogue_lines'; op: 'insert'; rows: object[] };

export interface EditPlan {
  ops: EditWrite[];
}

/** The stage a run for the edit is opened under (generation_runs.stage). */
export type EditStage = 'screenplay_refinement' | 'shots';

const eq = (column: string, value: unknown): EditFilter => ({
  column,
  op: 'eq',
  value,
});

const isNull = (column: string): EditFilter => ({
  column,
  op: 'is',
  value: null,
});

/** One live episode row, at most: every edit writes it, so it bumps the version. */
function episodeUpdate(
  episodeId: string,
  values: Record<string, unknown>,
): EditWrite {
  return {
    table: 'episodes',
    op: 'update',
    key: 'episode',
    values,
    match: [eq('id', episodeId), isNull('deleted_at')],
    requireRows: true,
  };
}

// ---------------------------------------------------------------------------
// Screenplay: one scene, or one line of it
// ---------------------------------------------------------------------------

/** A stored dialogue_lines row of the episode, as an edit needs it. */
export interface StoredDialogueLine {
  id: string;
  scene_number: number | null;
  sequence_number: number;
  language: string;
  text: string;
  character_asset_id: string | null;
  audio_url: string | null;
}

export interface ScreenplayDataLike {
  scenes?: unknown[];
  metadata?: Record<string, unknown>;
  [key: string]: unknown;
}

/**
 * The screenplay with one scene replaced, and the totals the screenplay
 * commit derives from the scenes (`metadata.locations`, `characters`,
 * `totalScenes`, `estimatedDuration`, `totalDialogueLines`) recomputed.
 */
export function screenplayWithScene(
  screenplay: ScreenplayDataLike,
  scene: ScreenplayScene,
  editedAt: string,
): ScreenplayDataLike {
  const scenes = (screenplay.scenes ?? []).map((stored) =>
    (stored as { number?: unknown }).number === scene.number ? scene : stored,
  ) as Array<Partial<ScreenplayScene>>;

  const locations = [
    ...new Set(
      scenes.map((s) => s.location).filter((l): l is string => Boolean(l)),
    ),
  ];
  const characters = [
    ...new Set(
      scenes
        .flatMap((s) => s.dialogue ?? [])
        .map((line) => line.character)
        .filter((c): c is string => Boolean(c)),
    ),
  ];
  const estimatedDuration = scenes.reduce(
    (sum, s) => sum + (s.estimatedDuration || 0),
    0,
  );

  return {
    ...screenplay,
    scenes,
    totalDialogueLines: scenes.flatMap((s) => s.dialogue ?? []).length,
    estimatedDuration,
    metadata: {
      ...(screenplay.metadata ?? {}),
      locations,
      characters,
      totalScenes: scenes.length,
      estimatedDuration,
    },
    lastEditedAt: editedAt,
  };
}

export type DialogueChange =
  | { mode: 'unchanged' }
  | { mode: 'in_place'; linesUpdated: number; voiceRendersInvalidated: number }
  | {
      mode: 'rebuilt';
      linesWritten: number;
      voiceRendersInvalidated: number;
      translationsRemoved: number;
    };

interface LineEdit {
  row: StoredDialogueLine;
  character: string;
  text: string;
}

/** The update one stored line takes, as the audio studio's text edit does. */
function lineUpdate(
  edit: LineEdit,
  characters: Map<string, string>,
  origin: GenerationOrigin,
): EditWrite {
  const values: Record<string, unknown> = {
    text: edit.text,
    character_asset_id: characters.get(edit.character.toLowerCase()) ?? null,
    generation_origin: origin,
  };

  // updateDialogueText: a line with audio needs it rendered again
  if (edit.row.audio_url) values.status = 'pending';

  return {
    table: 'dialogue_lines',
    op: 'update',
    values,
    match: [eq('id', edit.row.id)],
    requireRows: true,
  };
}

function sameLine(
  a: { character?: unknown; text?: unknown },
  b: { character?: unknown; text?: unknown },
) {
  return a.character === b.character && a.text === b.text;
}

/** The English rows of one scene, in line order. */
export function sceneLines(
  lines: ReadonlyArray<StoredDialogueLine>,
  sceneNumber: number,
): StoredDialogueLine[] {
  return lines
    .filter((l) => l.language === 'en' && l.scene_number === sceneNumber)
    .sort((a, b) => a.sequence_number - b.sequence_number);
}

export interface SceneEditPlanInput {
  episodeId: string;
  screenplay: ScreenplayDataLike;
  /** The stored scene the edit replaces */
  before: Partial<ScreenplayScene>;
  /** The validated scene after the edit, origin stamped */
  after: ScreenplayScene;
  /** Every dialogue_lines row of the episode, any language */
  lines: ReadonlyArray<StoredDialogueLine>;
  characters: ReadonlyArray<{ id: string; name: string }>;
  origin: GenerationOrigin;
  editedAt: string;
}

/**
 * One scene, replaced. The screenplay is rewritten with the scene in place;
 * its dialogue rows follow the screenplay:
 *
 * - lines unchanged: no row is touched, so no render is lost;
 * - the same number of lines, and the rows match the stored scene: each
 *   changed line's row is updated in place (a voiced one goes back to
 *   pending, as an edit in the audio studio does);
 * - otherwise the episode's lines are rebuilt as the screenplay commit
 *   rebuilds them (every row deleted, the English lines inserted numbered
 *   from 1), because sequence numbers are unique per episode and language
 *   and a scene that gains or loses a line moves every line after it.
 */
export function planSceneEdit(input: SceneEditPlanInput): {
  plan: EditPlan;
  dialogue: DialogueChange;
} {
  const screenplay = screenplayWithScene(
    input.screenplay,
    input.after,
    input.editedAt,
  );
  const ops: EditWrite[] = [
    episodeUpdate(input.episodeId, {
      screenplay_data: screenplay,
      updated_at: input.editedAt,
    }),
  ];

  const before = input.before.dialogue ?? [];
  const after = input.after.dialogue;
  const unchanged =
    before.length === after.length &&
    before.every((line, index) => sameLine(line, after[index]!));

  if (unchanged) {
    return { plan: { ops }, dialogue: { mode: 'unchanged' } };
  }

  const characters = characterIdMap(input.characters);
  const rows = sceneLines(input.lines, input.after.number);
  const inPlace =
    before.length === after.length &&
    rows.length === before.length &&
    rows.every((row, index) => row.text === before[index]!.text);

  if (inPlace) {
    const edits = after
      .map((line, index) => ({
        row: rows[index]!,
        character: line.character,
        text: line.text,
        changed: !sameLine(line, before[index]!),
      }))
      .filter((edit) => edit.changed);

    ops.push(
      ...edits.map((edit) => lineUpdate(edit, characters, input.origin)),
    );

    return {
      plan: { ops },
      dialogue: {
        mode: 'in_place',
        linesUpdated: edits.length,
        voiceRendersInvalidated: edits.filter((e) => e.row.audio_url).length,
      },
    };
  }

  const rebuilt: Array<DialogueLineRow & { generation_origin: unknown }> =
    dialogueRowsFromScenes(
      input.episodeId,
      screenplay.scenes as ScreenplayScene[],
      characters,
    ).map((row) => ({ ...row, generation_origin: input.origin }));

  ops.push(
    {
      table: 'dialogue_lines',
      op: 'delete',
      match: [eq('episode_id', input.episodeId)],
    },
    ...(rebuilt.length > 0
      ? [
          {
            table: 'dialogue_lines' as const,
            op: 'insert' as const,
            rows: rebuilt,
          },
        ]
      : []),
  );

  return {
    plan: { ops },
    dialogue: {
      mode: 'rebuilt',
      linesWritten: rebuilt.length,
      voiceRendersInvalidated: input.lines.filter((l) => l.audio_url).length,
      translationsRemoved: input.lines.filter((l) => l.language !== 'en')
        .length,
    },
  };
}

export interface LineEditPlanInput {
  episodeId: string;
  screenplay: ScreenplayDataLike;
  /** The validated scene with the line replaced, origin stamped */
  scene: ScreenplayScene;
  row: StoredDialogueLine;
  line: { character: string; text: string };
  characters: ReadonlyArray<{ id: string; name: string }>;
  origin: GenerationOrigin;
  editedAt: string;
}

/** One line: the screenplay's copy and its row, together. */
export function planLineEdit(input: LineEditPlanInput): EditPlan {
  return {
    ops: [
      episodeUpdate(input.episodeId, {
        screenplay_data: screenplayWithScene(
          input.screenplay,
          input.scene,
          input.editedAt,
        ),
        updated_at: input.editedAt,
      }),
      lineUpdate(
        { row: input.row, ...input.line },
        characterIdMap(input.characters),
        input.origin,
      ),
    ],
  };
}

// ---------------------------------------------------------------------------
// Shots: one shot
// ---------------------------------------------------------------------------

/**
 * The columns of one shot as the shots commit writes them
 * (`buildShotRows`), without the ones an edit leaves alone: the shot's
 * place (scene, numbers), its status and its Reel Scout flags.
 */
export function shotColumns(
  shot: SceneShot,
  storedMetadata: Record<string, unknown>,
) {
  return {
    scene_description: shot.description,
    prompt: shot.veoPrompt.fullPrompt || shot.description,
    duration_seconds: wholeShotSeconds(shot.duration),
    camera_direction: shot.cameraDirection ?? null,
    generation_metadata: {
      ...storedMetadata,
      shotType: shot.shotType,
      location: shot.metadata.location,
      timeOfDay: shot.metadata.timeOfDay,
      mood: shot.metadata.mood,
      characters: shot.characters ?? [],
      veoPrompt: shot.veoPrompt,
    },
    transition_type: shot.transitionType ?? null,
    frame_strategy: shot.frameStrategy ?? null,
    primary_subject: shot.primarySubject ?? null,
    first_frame_description: shot.firstFrameDescription ?? null,
    last_frame_description: shot.lastFrameDescription ?? null,
    location_area: shot.locationArea ?? null,
    location_environment_description:
      shot.locationEnvironmentDescription ?? null,
  };
}

export interface ShotEditPlanInput {
  episodeId: string;
  shotId: string;
  shot: SceneShot;
  storedMetadata: Record<string, unknown>;
  origin: GenerationOrigin;
  editedAt: string;
}

/**
 * One shot's row, in place: its id, place in the sequence, status and
 * rendered media stay (as the visual studio's shot edit keeps them). The
 * episode is touched too, so its version moves and a concurrent edit or
 * run on the episode sees TARGET_CHANGED.
 */
export function planShotEdit(input: ShotEditPlanInput): EditPlan {
  return {
    ops: [
      {
        table: 'shots',
        op: 'update',
        key: 'shot',
        values: {
          ...shotColumns(input.shot, input.storedMetadata),
          generation_origin: input.origin,
        },
        match: [
          eq('id', input.shotId),
          eq('episode_id', input.episodeId),
          isNull('deleted_at'),
        ],
        requireRows: true,
      },
      episodeUpdate(input.episodeId, { updated_at: input.editedAt }),
    ],
  };
}
